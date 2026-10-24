import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { anchorFromSelection, inHunks, isLineComment, toSelectionSide, type LineAnchor, type ReviewComment } from '../lib/comments';
import type { ReviewFile } from '../lib/types';
import { diffHostStyle, diffOptions, type DiffStyle } from '../theme/diffs';
import { CommentThread, useCommentActions, type Draft, type ThreadItems } from './Comments';

/** The comments and boxes on one spot of a file: the last line of their range, on one side. */
export interface LineGroup extends ThreadItems {
  key: string;
  side: 'additions' | 'deletions';
  line: number;
}

/** Where a line comment or box sits: its comment's place, or the box's own lines. */
function placeOf(item: ReviewComment | Draft, comments: Map<string, ReviewComment>): LineAnchor | null {
  if ('fileId' in item) {
    if (item.editing) {
      const comment = comments.get(item.editing);
      return comment && isLineComment(comment) ? comment : null;
    }
    return item.anchor;
  }
  return isLineComment(item) ? item : null;
}

/**
 * Groups a file's line comments and boxes by the line they hang under. Boxes
 * that edit a saved comment travel with it.
 */
export function groupByLine(comments: ReviewComment[], drafts: Draft[]): LineGroup[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const groups = new Map<string, LineGroup>();
  const groupFor = (anchor: LineAnchor) => {
    const side = toSelectionSide(anchor.side);
    const key = `${side}:${anchor.end}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, side, line: anchor.end, comments: [], drafts: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const comment of comments) {
    const place = placeOf(comment, byId);
    if (place) groupFor(place).comments.push(comment);
  }
  for (const draft of drafts) {
    const place = placeOf(draft, byId);
    if (place) groupFor(place).drafts.push(draft);
  }
  for (const group of groups.values()) group.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...groups.values()];
}

/**
 * Line groups whose lines aren't drawn: inside folded context, or in a file
 * whose diff isn't shown at all. They show atop the file instead, so no
 * comment is ever hidden. `hidden` is what the drawn diff reported; before it
 * has, the hunks are a good guess.
 */
export function offViewGroups(file: ReviewFile, groups: LineGroup[], hidden: Set<string> | null, showsDiff: boolean): LineGroup[] {
  if (!showsDiff || !file.diff) return groups;
  return groups.filter((group) => {
    if (hidden) return hidden.has(group.key);
    return !inHunks(file.diff!, { side: group.side === 'deletions' ? 'old' : 'new', start: group.line, end: group.line });
  });
}

/** Where another comment on a group's thread goes: the lines of its newest comment. */
export function groupAnchor(group: LineGroup): LineAnchor | null {
  const last = group.comments.at(-1);
  if (last && isLineComment(last)) return { side: last.side, start: last.start, end: last.end };
  return group.drafts.find((draft) => draft.anchor)?.anchor ?? null;
}

const slotName = (group: Pick<LineGroup, 'side' | 'line'>) => `annotation-${group.side}-${group.line}`;

/** Pierre's annotations for a space-separated list of group keys (`side:line`). */
export function annotationsAt(places: string): DiffLineAnnotation<string>[] {
  if (!places) return [];
  return places.split(' ').map((key) => {
    const [side, line] = key.split(':');
    return { side: side as LineGroup['side'], lineNumber: Number(line), metadata: key };
  });
}

interface CommentedDiffProps {
  file: ReviewFile & { diff: NonNullable<ReviewFile['diff']> };
  diffStyle: DiffStyle;
  groups: LineGroup[];
  /** Groups the diff has no place for, since their lines are folded away. */
  hidden: Set<string> | null;
  onHiddenChange: (hidden: Set<string>) => void;
  className?: string;
}

/**
 * The diff, with line comments pinned under their lines. Clicking or dragging
 * across line numbers, or the + in the gutter, opens a comment box on those
 * lines straight away.
 */
export function CommentedDiff({ file, diffStyle, groups, hidden, onHiddenChange, className }: CommentedDiffProps) {
  const actions = useCommentActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const fileRef = useRef(file);
  fileRef.current = file;
  /** The lines being dragged across, before the box opens. */
  const [dragging, setDragging] = useState<SelectedLineRange | null>(null);

  // Handlers read the latest props through refs, so the options object stays
  // the same between renders and Pierre doesn't redraw the file.
  const options = useMemo(
    () => ({
      ...diffOptions<string>(diffStyle),
      enableLineSelection: true,
      enableGutterUtility: true,
      lineHoverHighlight: 'number' as const,
      onGutterUtilityClick: () => {},
      onLineSelectionStart: (range: SelectedLineRange | null) => setDragging(range),
      onLineSelectionChange: (range: SelectedLineRange | null) => setDragging(range),
      // Only a finished click or drag opens a box. (Pierre also reports the
      // selection it's handed back, which mustn't open one.)
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        setDragging(null);
        const current = fileRef.current;
        const anchor = range && current.diff ? anchorFromSelection(current.diff, range) : null;
        if (anchor) actionsRef.current.startDraft(current.id, anchor);
        else actionsRef.current.dropEmptyDraft(current.id);
      },
    }),
    [diffStyle],
  );

  // The newest box opened on lines keeps them highlighted while it's open.
  const open = useMemo(() => {
    let latest: Draft | null = null;
    for (const group of groups) for (const draft of group.drafts) if (!draft.editing && draft.anchor) latest = draft;
    return latest?.anchor ?? null;
  }, [groups]);
  const selectedLines: SelectedLineRange | null =
    dragging ??
    (open && { start: open.start, end: open.end, side: toSelectionSide(open.side), endSide: toSelectionSide(open.side) });

  // Pierre throws away and redraws every line of the file whenever it's handed
  // a new list of annotations. Typing in a box changes the groups on each
  // keystroke but not where they sit, so the list is rebuilt only when a spot
  // is added or removed. The boxes themselves still update, as React children.
  const places = groups.map((group) => group.key).join(' ');
  const annotations = useMemo<DiffLineAnnotation<string>[]>(() => annotationsAt(places), [places]);
  const byKey = new Map(groups.map((group) => [group.key, group]));

  // Pierre only draws a place for comments on lines it shows. Check which
  // groups it left out, once it has drawn, so they can show atop the file.
  const hostRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const reportRef = useRef(onHiddenChange);
  reportRef.current = onHiddenChange;
  const lastHidden = useRef<string | null>(null);
  const readHidden = useCallback(() => {
    const root = hostRef.current?.querySelector('diffs-container')?.shadowRoot;
    // Nothing is drawn until the first lines are, so don't report until then.
    if (!root || !root.querySelector('[data-line]')) return;
    const slots = new Set([...root.querySelectorAll('slot[name^="annotation-"]')].map((slot) => slot.getAttribute('name')));
    const missing = groupsRef.current.filter((group) => !slots.has(slotName(group))).map((group) => group.key);
    const signature = missing.sort().join('|');
    if (signature === lastHidden.current) return;
    lastHidden.current = signature;
    reportRef.current(new Set(missing));
  }, []);
  useEffect(() => {
    const root = hostRef.current?.querySelector('diffs-container')?.shadowRoot;
    if (!root) return;
    readHidden();
    const observer = new MutationObserver(readHidden);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [readHidden]);
  // Pierre places new comments as it renders, before this runs.
  useEffect(readHidden, [annotations, readHidden]);

  return (
    <div ref={hostRef} className={className}>
      <FileDiff<string>
        fileDiff={file.diff}
        options={options}
        style={diffHostStyle}
        lineAnnotations={annotations}
        selectedLines={selectedLines}
        renderAnnotation={(annotation) => {
          const group = annotation.metadata ? byKey.get(annotation.metadata) : undefined;
          // A group shown atop the file isn't drawn here too.
          if (!group || hidden?.has(group.key)) return null;
          return <CommentThread comments={group.comments} drafts={group.drafts} fileId={file.id} anchor={groupAnchor(group)} />;
        }}
        disableWorkerPool
      />
    </div>
  );
}
