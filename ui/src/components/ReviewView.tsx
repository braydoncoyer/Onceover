import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { changeBlocks, flashBlock, scrollBehavior } from '../lib/changes';
import { reviewMarkdown, type ReviewComment } from '../lib/comments';
import { copyText } from '../lib/clipboard';
import { useShortcuts } from '../lib/keys';
import { compareFiles, isEmptyDelta, type FilesDelta, type LiveStatus } from '../lib/live';
import { captureAnchor, restoreAnchor, type ScrollAnchor } from '../lib/scrollAnchor';
import type { ReviewFile, ReviewMeta } from '../lib/types';
import { useCommentState } from '../lib/useCommentState';
import type { DiffStyle } from '../theme/diffs';
import { AppHeader, type DoneResult } from './AppHeader';
import { CommentActionsContext, ReviewerContext, type Draft } from './Comments';
import { FileCard } from './FileCard';
import { FileFinder } from './FileFinder';
import { FileRail } from './FileRail';
import { ShortcutsHelp } from './ShortcutsHelp';
import { UndoToast } from './UndoToast';
import { UpdateToast } from './UpdateToast';
import { SkeletonCard, SkeletonRail } from './SkeletonCard';
import s from './ReviewView.module.css';

interface ReviewViewProps {
  meta: ReviewMeta;
  files: ReviewFile[];
  /** Shown in place of the stack when there are no files. */
  empty?: ReactNode;
  initialViewed?: string[];
  initialDiffStyle?: DiffStyle;
  initialRailCollapsed?: boolean;
  initialFile?: string;
  /** Shows skeletons in place of the files, while a new base's diff loads. */
  loading?: boolean;
  onPickBase?: (base: string | null) => Promise<void>;
  /** Called with every viewed file id after each change, to save them. */
  onViewedChange?: (viewed: string[]) => void;
  /** The keyboard hint under the rail. */
  railHint?: boolean;
  /** Whether edits show up on their own. Without it (the playground), no live status shows. */
  live?: LiveStatus;
  /** Bumped each time a refresh lands. */
  synced?: number;
  /** Files to show as just updated on the first render, for the playground. */
  initialUpdated?: string[];
  initialComments?: ReviewComment[];
  initialNote?: string;
  /** Called with every comment and the note after each change, to save them. */
  onCommentsChange?: (comments: ReviewComment[], note: string) => void;
  /** Saves the copied review beside the store. Resolves with the path to show, or null if it couldn't. */
  onSaveReview?: (markdown: string) => Promise<string | null>;
}

const NO_COMMENTS: ReviewComment[] = [];
const NO_DRAFTS: Draft[] = [];

/** How long the stack holds its place while changed cards settle (unfolding, drawing), in ms. */
const ANCHOR_HOLD_MS = 600;
/** How long an updated card has to be on screen before it counts as seen, in ms. */
const SEEN_AFTER_MS = 1500;

/** Lines of context kept above a change that N or P jumps to. */
const CHANGE_CONTEXT_LINES = 3;

export function ReviewView({
  meta,
  files,
  empty,
  initialViewed = [],
  initialDiffStyle = 'unified',
  initialRailCollapsed = false,
  initialFile,
  loading = false,
  onPickBase,
  onViewedChange,
  railHint = true,
  live,
  synced = 0,
  initialUpdated = [],
  initialComments = NO_COMMENTS,
  initialNote = '',
  onCommentsChange,
  onSaveReview,
}: ReviewViewProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(initialDiffStyle);
  const [viewed, setViewed] = useState<Set<string>>(() => new Set(initialViewed));
  const [manualCollapsed, setManualCollapsed] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [railCollapsed, setRailCollapsed] = useState(initialRailCollapsed);
  const [currentId, setCurrentId] = useState(files[0]?.id ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  /** Set while a jump scrolls, so the scroll doesn't pick a different current file. */
  const jumping = useRef(false);
  /** The last change N or P landed on, and where the stack was scrolled to then. */
  const lastChange = useRef<{ index: number; scrollTop: number } | null>(null);
  /** Files that changed since the reader last saw them. */
  const [updated, setUpdated] = useState<Set<string>>(() => new Set(initialUpdated));
  /** Bumped per file each time it changes, to replay its card's highlight. */
  const [pulses, setPulses] = useState<Record<string, number>>({});
  /** What the last few refreshes changed, shown in a toast until it times out. */
  const [notice, setNotice] = useState<(FilesDelta & { id: number }) | null>(null);
  const anchor = useRef<ScrollAnchor | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [done, setDone] = useState<DoneResult | null>(null);

  /** Unfolds a card so a comment box on it can be seen. */
  const openFile = useCallback((id: string) => {
    setManualCollapsed((prev) => (prev[id] === false ? prev : { ...prev, [id]: false }));
  }, []);
  const review = useCommentState({ files, initialComments, initialNote, onOpenFile: openFile });
  const { comments, note, drafts } = review;

  // A refresh brought new files. Settle it before the new list paints: a
  // changed file loses its viewed mark and unfolds, and the stack notes where
  // it was so it can hold that spot once the new cards are drawn.
  const [shownFiles, setShownFiles] = useState(files);
  if (files !== shownFiles) {
    const delta = compareFiles(shownFiles, files);
    setShownFiles(files);
    if (!isEmptyDelta(delta)) {
      const stale = new Set([...delta.changed, ...delta.removed]);
      const fresh = [...delta.changed, ...delta.added];
      setViewed((prev) => ([...prev].some((id) => stale.has(id)) ? new Set([...prev].filter((id) => !stale.has(id))) : prev));
      setManualCollapsed((prev) => {
        const next = { ...prev };
        for (const id of delta.changed) delete next[id];
        return next;
      });
      setUpdated((prev) => {
        const next = new Set([...prev, ...fresh]);
        for (const id of delta.removed) next.delete(id);
        return next;
      });
      setPulses((prev) => {
        const next = { ...prev };
        for (const id of fresh) next[id] = (next[id] ?? 0) + 1;
        return next;
      });
      setNotice((prev) => ({
        id: (prev?.id ?? 0) + 1,
        changed: union(prev?.changed, delta.changed),
        added: union(prev?.added, delta.added),
        removed: union(prev?.removed, delta.removed),
      }));
      if (!files.some((file) => file.id === currentId)) {
        const index = shownFiles.findIndex((file) => file.id === currentId);
        setCurrentId(files[Math.min(Math.max(index, 0), files.length - 1)]?.id ?? '');
      }
      lastChange.current = null;
    }
    // Reading the stack now, before the new cards replace it, is the only way to know where it was.
    anchor.current = scrollRef.current ? captureAnchor(scrollRef.current) : null;
  }

  // Hold the stack's place while the new cards draw and changed ones unfold,
  // until the reader scrolls on their own.
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const held = anchor.current;
    anchor.current = null;
    if (!root || !held) return;
    restoreAnchor(root, held);
    let frame = 0;
    const until = performance.now() + ANCHOR_HOLD_MS;
    const hold = () => {
      restoreAnchor(root, held);
      if (performance.now() < until) frame = requestAnimationFrame(hold);
    };
    frame = requestAnimationFrame(hold);
    const release = () => cancelAnimationFrame(frame);
    const events = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;
    for (const type of events) window.addEventListener(type, release, { passive: true, once: true });
    return () => {
      release();
      for (const type of events) window.removeEventListener(type, release);
    };
  }, [files]);

  // Generated files don't count toward viewed progress or the line totals.
  const reviewable = useMemo(() => files.filter((file) => file.status !== 'generated'), [files]);
  const totals = useMemo(
    () =>
      reviewable.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [reviewable],
  );
  const commentsByPath = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const comment of comments) {
      if (comment.path === null) continue;
      map.set(comment.path, [...(map.get(comment.path) ?? []), comment]);
    }
    return map;
  }, [comments]);
  const commentCounts = useMemo(
    () => new Map([...commentsByPath].map(([path, list]) => [path, list.length])),
    [commentsByPath],
  );
  const draftsByFile = useMemo(() => {
    const map = new Map<string, Draft[]>();
    for (const draft of drafts) map.set(draft.fileId, [...(map.get(draft.fileId) ?? []), draft]);
    return map;
  }, [drafts]);

  // Save after each change, not on the first render.
  const savedComments = useRef({ comments, note });
  useEffect(() => {
    if (savedComments.current.comments === comments && savedComments.current.note === note) return;
    savedComments.current = { comments, note };
    onCommentsChange?.(comments, note);
  }, [comments, note, onCommentsChange]);

  const viewedCount = useMemo(() => reviewable.filter((file) => viewed.has(file.id)).length, [reviewable, viewed]);
  const isCollapsed = useCallback((id: string) => manualCollapsed[id] ?? viewed.has(id), [manualCollapsed, viewed]);

  // Save after each change, not on the first render.
  const savedViewed = useRef(viewed);
  useEffect(() => {
    if (savedViewed.current === viewed) return;
    savedViewed.current = viewed;
    onViewedChange?.([...viewed]);
  }, [viewed, onViewedChange]);

  const markSeen = useCallback((id: string) => {
    setUpdated((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // An updated card counts as seen once it's been on screen for a moment.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || updated.size === 0) return;
    const timers = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id.replace(/^file-/, '');
          // Half the card, or enough of a tall one to read.
          const seen =
            entry.isIntersecting &&
            (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= root.clientHeight * 0.4);
          if (seen && !timers.has(id)) {
            timers.set(id, window.setTimeout(() => markSeen(id), SEEN_AFTER_MS));
          } else if (!seen && timers.has(id)) {
            window.clearTimeout(timers.get(id));
            timers.delete(id);
          }
        }
      },
      { root, threshold: [0, 0.1, 0.25, 0.4, 0.5, 0.75, 1] },
    );
    for (const id of updated) {
      const card = document.getElementById(`file-${id}`);
      if (card) observer.observe(card);
    }
    return () => {
      observer.disconnect();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [updated, markSeen]);

  /** Puts a card's header at the top of the stack. */
  const scrollToCard = useCallback((id: string, behavior: ScrollBehavior = scrollBehavior()) => {
    const root = scrollRef.current;
    const card = document.getElementById(`file-${id}`);
    if (!root || !card) return;
    const margin = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
    const top = root.scrollTop + card.getBoundingClientRect().top - root.getBoundingClientRect().top - margin;
    if (Math.abs(top - root.scrollTop) < 1) return;
    jumping.current = true;
    root.scrollTo({ top, behavior });
  }, []);

  /**
   * Folds a file that's just been marked viewed. If its header was stuck to
   * the top, the stack first moves back to the card's start, so folding leaves
   * the next file right under it instead of jumping past it.
   */
  const setFileViewed = useCallback(
    (id: string, isViewed: boolean) => {
      if (isViewed) {
        const root = scrollRef.current;
        const card = document.getElementById(`file-${id}`);
        if (root && card && card.getBoundingClientRect().top < root.getBoundingClientRect().top) {
          scrollToCard(id, 'instant');
        }
      }
      setViewed((prev) => {
        const next = new Set(prev);
        if (isViewed) next.add(id);
        else next.delete(id);
        return next;
      });
      if (isViewed) markSeen(id);
      setManualCollapsed((prev) => ({ ...prev, [id]: isViewed }));
      lastChange.current = null;
    },
    [scrollToCard, markSeen],
  );

  const select = useCallback(
    (id: string) => {
      lastChange.current = null;
      setCurrentId(id);
      scrollToCard(id);
    },
    [scrollToCard],
  );

  useEffect(() => {
    if (!initialFile) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`file-${initialFile}`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [initialFile]);

  // Highlight the file whose header is at the top of the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      if (jumping.current) return;
      const top = root.getBoundingClientRect().top;
      let current = files[0]?.id ?? '';
      for (const file of files) {
        const node = document.getElementById(`file-${file.id}`);
        if (node && node.getBoundingClientRect().top - top <= 48) current = file.id;
      }
      setCurrentId(current);
    };
    // A jump ends when its scroll does, or as soon as the reader takes over.
    const release = () => {
      jumping.current = false;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', release);
    root.addEventListener('wheel', release, { passive: true });
    root.addEventListener('pointerdown', release);
    root.addEventListener('touchstart', release, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', release);
      root.removeEventListener('wheel', release);
      root.removeEventListener('pointerdown', release);
      root.removeEventListener('touchstart', release);
    };
  }, [files]);

  const stepFile = useCallback(
    (step: 1 | -1) => {
      const index = files.findIndex((file) => file.id === currentId);
      const next = files[Math.min(files.length - 1, Math.max(0, index + step))];
      if (next) select(next.id);
    },
    [files, currentId, select],
  );

  /** Jumps to the next file that changed since it was last seen, after the current one. */
  const nextUpdated = useCallback(() => {
    if (updated.size === 0) return;
    const index = files.findIndex((file) => file.id === currentId);
    const order = [...files.slice(index + 1), ...files.slice(0, index + 1)];
    const next = order.find((file) => updated.has(file.id));
    if (next) select(next.id);
    setNotice(null);
  }, [files, currentId, updated, select]);

  /** Scrolls to the next or previous run of changed lines, across files, and flashes it. */
  const stepChange = useCallback(
    (step: 1 | -1) => {
      const root = scrollRef.current;
      if (!root) return;
      const blocks = changeBlocks(root);
      if (blocks.length === 0) return;
      const rootTop = root.getBoundingClientRect().top;
      const header = parseFloat(getComputedStyle(root).getPropertyValue('--size-file-header')) || 0;
      const line = parseFloat(getComputedStyle(root).getPropertyValue('--leading-code')) || 0;
      const anchor = rootTop + header + line * CHANGE_CONTEXT_LINES;

      // Where the stack hasn't moved since the last jump (say, at the very
      // bottom, where it can't scroll further), step from that change instead
      // of from the scroll position.
      let index: number;
      const last = lastChange.current;
      const settled = last && (jumping.current || Math.abs(last.scrollTop - root.scrollTop) < 2);
      if (last && settled && last.index < blocks.length) {
        index = last.index + step;
      } else if (step === 1) {
        index = blocks.findIndex((block) => block.top > anchor + 2);
      } else {
        index = blocks.findLastIndex((block) => block.top < anchor - 2);
      }
      const block = blocks[index];
      if (!block) return;

      const max = root.scrollHeight - root.clientHeight;
      const target = Math.min(max, Math.max(0, root.scrollTop + block.top - anchor));
      lastChange.current = { index, scrollTop: target };
      const card = block.card.id.replace(/^file-/, '');
      setCurrentId(card);
      jumping.current = Math.abs(target - root.scrollTop) >= 1;
      root.scrollTo({ top: target, behavior: scrollBehavior() });
      flashBlock(block, s.flash);
    },
    [],
  );

  const toggleCollapsed = useCallback(
    (id: string) => {
      lastChange.current = null;
      setManualCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? viewed.has(id)) }));
    },
    [viewed],
  );

  /**
   * Done reviewing: copies the review as one block for Claude Code and saves
   * it beside the review store. Comments stay until cleared.
   */
  const finishReview = useCallback(() => {
    const written = comments.filter((comment) => comment.path !== null && comment.body.trim());
    const unsaved = drafts.filter((draft) => draft.body.trim()).length;
    setReviewOpen(false);
    if (written.length === 0 && !note.trim()) {
      setDone({ kind: 'empty', unsaved });
      return;
    }
    const markdown = reviewMarkdown({ branch: meta.branch, base: meta.base, note, comments: written, files });
    // The clipboard only takes text during the key press or click, so copy first.
    const copying = copyText(markdown);
    const base = { markdown, count: written.length, unsaved, saved: null };
    setDone({ kind: 'copied', copied: true, ...base });
    void copying.then((copied) => {
      if (!copied) setDone((prev) => (prev?.kind === 'copied' && prev.markdown === markdown ? { ...prev, copied } : prev));
    });
    void onSaveReview?.(markdown).then((saved) =>
      setDone((prev) => (prev?.kind === 'copied' && prev.markdown === markdown ? { ...prev, saved } : prev)),
    );
  }, [comments, drafts, note, meta.branch, meta.base, files, onSaveReview]);

  /** Scrolls to a comment, unfolding its card first, and flashes it. */
  const revealComment = useCallback(
    (comment: ReviewComment) => {
      const file = files.find((item) => item.path === comment.path);
      if (!file) return;
      openFile(file.id);
      setCurrentId(file.id);
      // Give the card a frame to unfold before measuring.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const node = document.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(comment.id)}"]`);
          if (!node) {
            scrollToCard(file.id);
            return;
          }
          jumping.current = true;
          node.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
          node.classList.remove(s.flashComment);
          void node.offsetWidth;
          node.classList.add(s.flashComment);
        }),
      );
    },
    [files, openFile, scrollToCard],
  );

  const current = files.find((file) => file.id === currentId);
  const dialogOpen = finderOpen || helpOpen || pickerOpen;
  useShortcuts(
    [
      { key: 'j', run: () => stepFile(1) },
      { key: 'k', run: () => stepFile(-1) },
      { key: 'n', run: () => stepChange(1) },
      { key: 'p', run: () => stepChange(-1) },
      {
        key: 'v',
        run: () => current && current.status !== 'generated' && setFileViewed(current.id, !viewed.has(current.id)),
      },
      { key: 'z', run: () => current && toggleCollapsed(current.id) },
      { key: 'u', run: nextUpdated },
      { key: 's', run: () => setDiffStyle((style) => (style === 'unified' ? 'split' : 'unified')) },
      { key: '[', run: () => setRailCollapsed((value) => !value) },
      { key: 'b', run: () => onPickBase && setPickerOpen(true) },
      { key: 'k', mod: true, run: () => setFinderOpen(true) },
      { key: '/', run: () => setFinderOpen(true) },
      { key: '?', run: () => setHelpOpen(true) },
      {
        key: 'c',
        run: () => {
          if (review.focusLatest()) return;
          if (current) review.context.startDraft(current.id, null);
        },
      },
      { key: 'z', mod: true, shift: false, run: () => review.undo && (review.undo.restore(), review.setUndo(null)) },
    ],
    !loading && !dialogOpen && files.length > 0,
  );
  // Done reviewing works from anywhere, a comment box included.
  useShortcuts([{ key: 'Enter', mod: true, shift: true, whileTyping: true, run: finishReview }], !loading && !finderOpen && !helpOpen);

  return (
    <>
      <AppHeader
        meta={meta}
        additions={totals.additions}
        deletions={totals.deletions}
        viewed={viewedCount}
        total={reviewable.length}
        comments={comments}
        files={files}
        note={note}
        onNoteChange={review.setNote}
        onRevealComment={revealComment}
        onClearComments={review.clearAll}
        reviewOpen={reviewOpen}
        onReviewOpenChange={setReviewOpen}
        done={done}
        onDone={finishReview}
        onDoneClose={() => setDone(null)}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        onPickBase={onPickBase}
        pickerOpen={pickerOpen}
        onPickerOpenChange={setPickerOpen}
        live={live}
        synced={synced}
      />
      <div className={s.body} aria-busy={loading || undefined}>
        {loading ? (
          <div className={s.railSkeleton}>
            <SkeletonRail />
          </div>
        ) : files.length > 0 && (
          <FileRail
            files={files}
            currentId={currentId}
            viewed={viewed}
            updated={updated}
            commentCounts={commentCounts}
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailCollapsed((value) => !value)}
            onSelect={select}
            onShowShortcuts={() => setHelpOpen(true)}
            hint={railHint}
          />
        )}
        <ReviewerContext.Provider value={meta.reviewer ?? null}>
        <CommentActionsContext.Provider value={review.context}>
        <main ref={scrollRef} className={s.scroll} data-scroll-root>
          <div className={s.stack}>
            {loading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
            {!loading && files.length === 0 && empty}
            {!loading && files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                diffStyle={diffStyle}
                viewed={viewed.has(file.id)}
                collapsed={isCollapsed(file.id)}
                revealed={revealed.has(file.id)}
                updated={updated.has(file.id)}
                pulse={pulses[file.id] ?? 0}
                comments={commentsByPath.get(file.path) ?? NO_COMMENTS}
                drafts={draftsByFile.get(file.id) ?? NO_DRAFTS}
                onViewedChange={(value) => setFileViewed(file.id, value)}
                onToggleCollapsed={() => toggleCollapsed(file.id)}
                onReveal={() => setRevealed((prev) => new Set(prev).add(file.id))}
              />
            ))}
          </div>
          <div className={s.fade} aria-hidden="true" />
          {review.undo && (
            <UndoToast
              key={review.undo.id}
              message={review.undo.message}
              onUndo={() => {
                review.undo?.restore();
                review.setUndo(null);
              }}
              onDone={() => review.setUndo(null)}
            />
          )}
          {notice && !review.undo && (
            <UpdateToast
              delta={notice}
              version={notice.id}
              files={files}
              canJump={updated.size > 0}
              onJump={nextUpdated}
              onDone={() => setNotice(null)}
            />
          )}
        </main>
        </CommentActionsContext.Provider>
        </ReviewerContext.Provider>
      </div>

      {finderOpen && (
        <FileFinder
          files={files}
          viewed={viewed}
          currentId={currentId}
          onPick={select}
          onClose={() => setFinderOpen(false)}
        />
      )}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}

function union(a: string[] = [], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}
