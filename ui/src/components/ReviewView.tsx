import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { changeBlocks, flashBlock, scrollBehavior } from '../lib/changes';
import { useShortcuts } from '../lib/keys';
import type { ReviewFile, ReviewMeta } from '../lib/types';
import type { DiffStyle } from '../theme/diffs';
import { AppHeader } from './AppHeader';
import { FileCard } from './FileCard';
import { FileFinder } from './FileFinder';
import { FileRail } from './FileRail';
import { ShortcutsHelp } from './ShortcutsHelp';
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
}

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

  // Generated files don't count toward viewed progress or the line totals.
  const reviewable = useMemo(() => files.filter((file) => file.status !== 'generated'), [files]);
  const totals = useMemo(
    () =>
      reviewable.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
          comments: sum.comments + file.comments,
        }),
        { additions: 0, deletions: 0, comments: 0 },
      ),
    [reviewable],
  );
  const viewedCount = useMemo(() => reviewable.filter((file) => viewed.has(file.id)).length, [reviewable, viewed]);
  const isCollapsed = useCallback((id: string) => manualCollapsed[id] ?? viewed.has(id), [manualCollapsed, viewed]);

  // Save after each change, not on the first render.
  const savedViewed = useRef(viewed);
  useEffect(() => {
    if (savedViewed.current === viewed) return;
    savedViewed.current = viewed;
    onViewedChange?.([...viewed]);
  }, [viewed, onViewedChange]);

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
      setManualCollapsed((prev) => ({ ...prev, [id]: isViewed }));
      lastChange.current = null;
    },
    [scrollToCard],
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
      { key: 's', run: () => setDiffStyle((style) => (style === 'unified' ? 'split' : 'unified')) },
      { key: '[', run: () => setRailCollapsed((value) => !value) },
      { key: 'b', run: () => onPickBase && setPickerOpen(true) },
      { key: 'k', mod: true, run: () => setFinderOpen(true) },
      { key: '/', run: () => setFinderOpen(true) },
      { key: '?', run: () => setHelpOpen(true) },
    ],
    !loading && !dialogOpen && files.length > 0,
  );

  return (
    <>
      <AppHeader
        meta={meta}
        additions={totals.additions}
        deletions={totals.deletions}
        viewed={viewedCount}
        total={reviewable.length}
        comments={totals.comments}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        onPickBase={onPickBase}
        pickerOpen={pickerOpen}
        onPickerOpenChange={setPickerOpen}
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
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailCollapsed((value) => !value)}
            onSelect={select}
            onShowShortcuts={() => setHelpOpen(true)}
            hint={railHint}
          />
        )}
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
                onViewedChange={(value) => setFileViewed(file.id, value)}
                onToggleCollapsed={() => toggleCollapsed(file.id)}
                onReveal={() => setRevealed((prev) => new Set(prev).add(file.id))}
              />
            ))}
          </div>
          <div className={s.fade} aria-hidden="true" />
        </main>
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
