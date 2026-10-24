import { diffWordsWithSpace } from 'diff';

/** A changed run inside a line: start offset and length, in UTF-16 units. */
export type WordSpan = [start: number, length: number];

export interface WordSpans {
  deletion: WordSpan[];
  addition: WordSpan[];
}

/**
 * Past this share of a line's visible characters changing, the line gets no
 * pills: it was rewritten, and pills on most of it are only noise. The line
 * tint already says it changed.
 */
const MAX_CHANGED_SHARE = 0.6;

/**
 * The words that changed between a removed line and the added line paired
 * with it, as pills that hug the words like Linear's: runs split only by
 * spaces read as one pill, and no pill starts or ends on whitespace.
 * Null when there's nothing worth marking.
 *
 * Pierre calls this in place of its own word-alt pass (see the
 * `pierreWordPills` plugin in vite.config.ts).
 */
export function wordSpans(before: string, after: string): WordSpans | null {
  const deletion: WordSpan[] = [];
  const addition: WordSpan[] = [];
  let oldOffset = 0;
  let newOffset = 0;
  for (const part of diffWordsWithSpace(before, after)) {
    const length = part.value.length;
    if (part.removed) {
      deletion.push([oldOffset, length]);
      oldOffset += length;
    } else if (part.added) {
      addition.push([newOffset, length]);
      newOffset += length;
    } else {
      oldOffset += length;
      newOffset += length;
    }
  }

  const spans = { deletion: tidy(before, deletion), addition: tidy(after, addition) };
  if (spans.deletion.length === 0 && spans.addition.length === 0) return null;
  if (changedShare(before, spans.deletion) > MAX_CHANGED_SHARE) return null;
  if (changedShare(after, spans.addition) > MAX_CHANGED_SHARE) return null;
  return spans;
}

/** Joins runs that only whitespace separates, then trims whitespace off both ends of each. */
function tidy(line: string, spans: WordSpan[]): WordSpan[] {
  const joined: WordSpan[] = [];
  for (const [start, length] of spans) {
    const last = joined.at(-1);
    if (last && /^\s*$/.test(line.slice(last[0] + last[1], start))) {
      last[1] = start + length - last[0];
    } else {
      joined.push([start, length]);
    }
  }

  const trimmed: WordSpan[] = [];
  for (const [start, length] of joined) {
    const text = line.slice(start, start + length);
    const lead = text.length - text.trimStart().length;
    const kept = text.trim().length;
    if (kept > 0) trimmed.push([start + lead, kept]);
  }
  return trimmed;
}

function changedShare(line: string, spans: WordSpan[]): number {
  const visible = (text: string) => text.replace(/\s/g, '').length;
  const total = visible(line);
  if (total === 0) return 0;
  const changed = spans.reduce((sum, [start, length]) => sum + visible(line.slice(start, start + length)), 0);
  return changed / total;
}
