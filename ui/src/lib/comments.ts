import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import type { ReviewComment } from '../../../src/server/api.ts';
import type { ReviewFile } from './types.ts';

export type { ReviewComment } from '../../../src/server/api.ts';

/*
 * Line comments: turning a selection into a comment, finding its code again
 * after the agent edits the file, and writing the review out for Claude.
 * Pure functions over the diff, so they run in tests as well as the page.
 */

/** Which file a comment's line numbers count in: the file on disk now, or the base's copy. */
export type CommentSide = 'new' | 'old';

/** Where a line comment sits: first and last line on one side, inclusive. */
export interface LineAnchor {
  side: CommentSide;
  start: number;
  end: number;
}

/** Lines of context kept above and below a comment, for finding it again. */
const CONTEXT_LINES = 2;

/** One row of the unified diff: its old and new line numbers, where it has them. */
interface Row {
  type: 'context' | 'deletion' | 'addition';
  old?: number;
  new?: number;
}

/** Every row of every hunk, top to bottom, as the unified view draws them. */
function hunkRows(diff: FileDiffMetadata): Row[] {
  const rows: Row[] = [];
  for (const hunk of diff.hunks) {
    let old = hunk.deletionStart;
    let next = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++) rows.push({ type: 'context', old: old++, new: next++ });
      } else {
        for (let i = 0; i < content.deletions; i++) rows.push({ type: 'deletion', old: old++ });
        for (let i = 0; i < content.additions; i++) rows.push({ type: 'addition', new: next++ });
      }
    }
  }
  return rows;
}

/** A line's text without its newline. */
const clean = (line: string) => line.replace(/\r?\n$/, '');

/**
 * The lines of one side of a file, by line number (index 0 is line 1). A
 * diff built from whole files has every line; one built from a patch alone
 * only has the lines its hunks show, and the rest are left undefined.
 */
export function sideLines(diff: FileDiffMetadata, side: CommentSide): Array<string | undefined> {
  const source = side === 'new' ? diff.additionLines : diff.deletionLines;
  if (!diff.isPartial) return source.map(clean);
  const lines: Array<string | undefined> = [];
  for (const hunk of diff.hunks) {
    let old = hunk.deletionStart;
    let next = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      const context = content.type === 'context';
      const olds = context ? content.lines : content.deletions;
      const news = context ? content.lines : content.additions;
      if (side === 'old') {
        for (let i = 0; i < olds; i++) lines[old + i - 1] = clean(diff.deletionLines[content.deletionLineIndex + i]);
      } else {
        for (let i = 0; i < news; i++) lines[next + i - 1] = clean(diff.additionLines[content.additionLineIndex + i]);
      }
      old += olds;
      next += news;
    }
  }
  return lines;
}

/**
 * Where an old line sits in the file now: the first new line after it. A
 * removed line has no number of its own in the new file, so this is how a
 * selection that runs from removed lines into added ones gets its range.
 */
function newPositionOf(diff: FileDiffMetadata, oldLine: number): number {
  let position = 1;
  for (const row of hunkRows(diff)) {
    if (row.old !== undefined && row.old >= oldLine) return row.new ?? position;
    if (row.new !== undefined) position = row.new + 1;
  }
  return oldLine - (diff.hunks.reduce((sum, hunk) => sum + hunk.deletionCount - hunk.additionCount, 0));
}

/**
 * The comment range for a selection in Pierre's terms. Both ends on one side
 * keep that side. A selection that runs from removed lines into added or
 * unchanged ones counts on the file as it is now, since that's what Claude
 * will edit, and covers the new lines between its ends.
 */
export function anchorFromSelection(diff: FileDiffMetadata, range: SelectedLineRange): LineAnchor | null {
  const startSide = toSide(range.side);
  const endSide = toSide(range.endSide ?? range.side);
  if (startSide === endSide) {
    const [start, end] = range.start <= range.end ? [range.start, range.end] : [range.end, range.start];
    return start > 0 ? { side: startSide, start, end } : null;
  }
  const oldEnd = startSide === 'old' ? range.start : range.end;
  const newEnd = startSide === 'new' ? range.start : range.end;
  const position = newPositionOf(diff, oldEnd);
  // Removed lines draw above the added lines that replace them, so the old
  // end is the top unless the new end sits above where the old line was.
  const [start, end] = newEnd >= position ? [position, newEnd] : [newEnd, position - 1];
  if (start > end || start < 1) return { side: 'old', start: oldEnd, end: oldEnd };
  return { side: 'new', start, end };
}

export function toSide(side: SelectedLineRange['side']): CommentSide {
  return side === 'deletions' ? 'old' : 'new';
}

export function toSelectionSide(side: CommentSide | null): 'additions' | 'deletions' {
  return side === 'old' ? 'deletions' : 'additions';
}

/** The text and context of an anchor, captured so the code can be found again later. */
export function captureLines(diff: FileDiffMetadata, anchor: LineAnchor): Pick<ReviewComment, 'text' | 'before' | 'after'> {
  const lines = sideLines(diff, anchor.side);
  const take = (from: number, to: number) => {
    const out: string[] = [];
    for (let n = Math.max(1, from); n <= Math.min(lines.length, to); n++) out.push(lines[n - 1] ?? '');
    return out;
  };
  return {
    text: take(anchor.start, anchor.end),
    before: take(anchor.start - CONTEXT_LINES, anchor.start - 1),
    after: take(anchor.end + 1, anchor.end + CONTEXT_LINES),
  };
}

export function newCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A new comment on lines of a file, or on the whole file when `anchor` is null. */
export function createComment(file: ReviewFile, anchor: LineAnchor | null, body: string, now = new Date()): ReviewComment {
  const stamp = now.toISOString();
  const captured = anchor && file.diff ? captureLines(file.diff, anchor) : { text: [], before: [], after: [] };
  return {
    id: newCommentId(),
    path: file.path,
    side: anchor?.side ?? null,
    start: anchor?.start ?? null,
    end: anchor?.end ?? null,
    ...captured,
    body,
    outdated: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** A line comment, as opposed to one on a whole file or the whole review. */
export function isLineComment(comment: ReviewComment): comment is ReviewComment & { side: CommentSide; start: number; end: number } {
  return comment.side !== null && comment.start !== null && comment.end !== null;
}

/**
 * Finds a comment's code again after its file changed. Lines that still sit
 * where they were keep their place. Lines that moved are found by their text,
 * preferring the spot whose surrounding lines match best, then the one
 * nearest the old place. Code that's gone leaves the comment where it was,
 * marked outdated. A removed line that's no longer removed is outdated too,
 * since what the comment was about isn't in the change any more.
 *
 * Returns the same object when nothing changed.
 */
export function reanchor(comment: ReviewComment, file: ReviewFile | undefined): ReviewComment {
  if (!isLineComment(comment)) return comment;
  const diff = file?.diff;
  if (!diff || comment.text.length === 0) return withPlace(comment, comment.start, comment.end, !diff || comment.outdated);
  const lines = sideLines(diff, comment.side);
  const length = comment.text.length;
  const at = (start: number, loose: boolean) =>
    comment.text.every((line, i) => {
      const actual = lines[start - 1 + i];
      return actual !== undefined && (loose ? actual.trim() === line.trim() : actual === line);
    });

  let found: number | null = null;
  for (const loose of [false, true]) {
    if (at(comment.start, loose)) {
      found = comment.start;
      break;
    }
    let best: { start: number; score: number; distance: number } | null = null;
    for (let start = 1; start + length - 1 <= lines.length; start++) {
      if (!at(start, loose)) continue;
      const score = contextScore(lines, start, start + length - 1, comment);
      const distance = Math.abs(start - comment.start);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { start, score, distance };
      }
    }
    if (best) {
      found = best.start;
      break;
    }
  }

  if (found === null) return withPlace(comment, comment.start, comment.end, true);
  const end = found + length - 1;
  const stillRemoved = comment.side === 'new' || isRemoved(diff, found, end);
  return withPlace(comment, found, end, !stillRemoved);
}

function withPlace(comment: ReviewComment, start: number, end: number, outdated: boolean): ReviewComment {
  if (comment.start === start && comment.end === end && comment.outdated === outdated) return comment;
  return { ...comment, start, end, outdated };
}

/** How many of the saved context lines match around a candidate spot. */
function contextScore(lines: Array<string | undefined>, start: number, end: number, comment: ReviewComment): number {
  let score = 0;
  comment.before.forEach((line, i) => {
    if (lines[start - 1 - comment.before.length + i] === line) score++;
  });
  comment.after.forEach((line, i) => {
    if (lines[end + i] === line) score++;
  });
  return score;
}

/** Whether every old line from `start` to `end` is a removed line in the diff. */
function isRemoved(diff: FileDiffMetadata, start: number, end: number): boolean {
  const removed = new Set<number>();
  for (const row of hunkRows(diff)) if (row.type === 'deletion' && row.old !== undefined) removed.add(row.old);
  for (let n = start; n <= end; n++) if (!removed.has(n)) return false;
  return true;
}

/** Re-anchors every comment against the current files. Returns the same list when nothing moved. */
export function reanchorAll(comments: ReviewComment[], files: ReviewFile[]): ReviewComment[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  let changed = false;
  const next = comments.map((comment) => {
    if (comment.path === null) return comment;
    const updated = reanchor(comment, byPath.get(comment.path));
    if (updated !== comment) changed = true;
    return updated;
  });
  return changed ? next : comments;
}

/** Whether a line comment's lines are drawn by default: inside one of the diff's hunks. */
export function inHunks(diff: FileDiffMetadata, anchor: LineAnchor): boolean {
  return diff.hunks.some((hunk) => {
    const start = anchor.side === 'new' ? hunk.additionStart : hunk.deletionStart;
    const count = anchor.side === 'new' ? hunk.additionCount : hunk.deletionCount;
    return anchor.end >= start && anchor.end < start + count;
  });
}

/** `Line 81`, `Lines 79–82`, with `removed` for old-side comments. */
export function lineLabel(comment: Pick<ReviewComment, 'side' | 'start' | 'end'>): string {
  if (comment.start === null || comment.end === null) return 'File';
  const range = comment.start === comment.end ? `${comment.start}` : `${comment.start}–${comment.end}`;
  const lines = comment.start === comment.end ? 'line' : 'lines';
  return comment.side === 'old' ? `Removed ${lines} ${range}` : `${capitalize(lines)} ${range}`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Comments in the order the review reads: by file as the stack shows them, file comments first, then by line. */
export function sortComments(comments: ReviewComment[], files: ReviewFile[]): ReviewComment[] {
  const order = new Map(files.map((file, i) => [file.path, i]));
  const rank = (comment: ReviewComment) => order.get(comment.path ?? '') ?? files.length;
  const line = (comment: ReviewComment) => {
    if (comment.start === null) return -1;
    if (comment.side === 'old' && comment.path !== null) {
      const diff = files.find((file) => file.path === comment.path)?.diff;
      if (diff) return newPositionOf(diff, comment.start) - 0.5;
    }
    return comment.start;
  };
  return [...comments].sort(
    (a, b) => rank(a) - rank(b) || (a.path ?? '').localeCompare(b.path ?? '') || line(a) - line(b) || a.createdAt.localeCompare(b.createdAt),
  );
}

export interface ReviewSummary {
  branch: string;
  base: string;
  note: string;
  comments: ReviewComment[];
  files: ReviewFile[];
}

/**
 * The block Done reviewing copies for Claude Code. Line numbers count in the
 * file as it is on disk now; a removed line gives the line it sat under, and
 * says it was removed. Each line comment quotes its code (the first and last
 * line of a long range) so Claude can find it even if lines have moved.
 */
export function reviewMarkdown({ branch, base, note, comments, files }: ReviewSummary): string {
  const sorted = sortComments(
    comments.filter((comment) => comment.path !== null && comment.body.trim()),
    files,
  );
  const count = `${sorted.length} ${sorted.length === 1 ? 'comment' : 'comments'}`;
  const out = [`Review of ${branch} against ${base} (${count})`];
  if (note.trim()) out.push('', `Overall: ${indentRest(note.trim(), '')}`);
  const byPath = new Map(files.map((file) => [file.path, file]));

  sorted.forEach((comment, i) => {
    const number = `${i + 1}. `;
    const pad = ' '.repeat(number.length);
    out.push('', `${number}${location(comment, byPath.get(comment.path!))}`);
    for (const line of quote(comment.text)) out.push(`${pad}> ${line}`.trimEnd());
    out.push(indentRest(comment.body.trim(), pad, true));
  });
  return `${out.join('\n')}\n`;
}

function location(comment: ReviewComment, file: ReviewFile | undefined): string {
  const path = comment.path!;
  if (!isLineComment(comment)) return `${path} (whole file)`;
  const notes: string[] = [];
  let lines: string;
  if (comment.side === 'old') {
    // Where the removed code was, counted in the file as it is now.
    const at = file?.diff ? Math.max(1, newPositionOf(file.diff, comment.start) - 1) : comment.start;
    lines = `${at}`;
    notes.push(comment.start === comment.end ? 'removed line' : 'removed lines');
  } else {
    lines = comment.start === comment.end ? `${comment.start}` : `${comment.start}-${comment.end}`;
  }
  if (comment.outdated) notes.push('outdated: this code has changed since the comment');
  return `${path}:${lines}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

/** The lines to quote: all of a short range, the first and last of a long one. */
function quote(text: string[]): string[] {
  const lines = text.map((line) => line.trim());
  if (lines.length <= 2) return lines.filter(Boolean);
  return [lines[0], '…', lines[lines.length - 1]];
}

/** Indents every line of a multi-line text, or every line after the first. */
function indentRest(text: string, pad: string, all = false): string {
  return text
    .split('\n')
    .map((line, i) => (all || i > 0 ? `${pad}${line}`.trimEnd() : line))
    .join('\n');
}
