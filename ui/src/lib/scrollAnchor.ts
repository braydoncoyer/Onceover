import { DIFFS_TAG_NAME } from '@pierre/diffs';

/**
 * A spot in the stack to hold still while the files under it change: the
 * first code line under the file headers, with the next few cards as
 * fallbacks in case that file goes away.
 */
export interface ScrollAnchor {
  cards: Array<{ id: string; offset: number }>;
  line: { type: string; number: number; text: string; offset: number } | null;
}

/** Where the stack is now, or null when it's at the very top, which stays put on its own. */
export function captureAnchor(root: HTMLElement): ScrollAnchor | null {
  if (root.scrollTop <= 0) return null;
  const rootTop = root.getBoundingClientRect().top;
  // The first line of code a reader sees sits under a stuck file header.
  const header = parseFloat(getComputedStyle(root).getPropertyValue('--size-file-header')) || 0;
  const y = rootTop + header + 1;

  const cards = [...root.querySelectorAll<HTMLElement>('[data-file-card]')];
  const index = cards.findIndex((card) => card.getBoundingClientRect().bottom > y);
  if (index === -1) return null;
  const following = cards.slice(index, index + 4).map((card) => ({
    id: card.id,
    offset: card.getBoundingClientRect().top - rootTop,
  }));

  let line: ScrollAnchor['line'] = null;
  const first = cards[index];
  if (first.getBoundingClientRect().top <= y) {
    const row = rowsOf(first).find((rect) => rect.box.bottom > y);
    if (row) {
      line = { type: row.type, number: row.number, text: row.text, offset: row.box.top - rootTop };
    }
  }
  return { cards: following, line };
}

/** Scrolls the stack so the anchor is back where it was. Returns how far it moved. */
export function restoreAnchor(root: HTMLElement, anchor: ScrollAnchor): number {
  const rootTop = root.getBoundingClientRect().top;
  let delta: number | null = null;

  const first = anchor.cards[0];
  const card = first && document.getElementById(first.id);
  if (anchor.line && card && root.contains(card)) {
    const { line } = anchor;
    // The same line of code, nearest its old number, since lines above it may have moved it.
    const match = rowsOf(card)
      .filter((row) => row.type === line.type && row.text === line.text)
      .sort((a, b) => Math.abs(a.number - line.number) - Math.abs(b.number - line.number))[0];
    if (match) delta = match.box.top - rootTop - line.offset;
  }
  if (delta === null) {
    for (const { id, offset } of anchor.cards) {
      const node = document.getElementById(id);
      if (!node || !root.contains(node)) continue;
      delta = node.getBoundingClientRect().top - rootTop - offset;
      break;
    }
  }
  if (delta === null || Math.abs(delta) < 0.5) return 0;
  const before = root.scrollTop;
  // Instant, whatever the stack's own scroll-behavior says: this should go unnoticed.
  root.scrollTo({ top: before + delta, behavior: 'instant' });
  return root.scrollTop - before;
}

/** Pierre draws lines in a shadow root, one element per line with its number and kind. */
function rowsOf(card: HTMLElement) {
  const shadow = card.querySelector(DIFFS_TAG_NAME)?.shadowRoot;
  if (!shadow) return [];
  return [...shadow.querySelectorAll<HTMLElement>('[data-line][data-line-type]')]
    .map((row) => ({
      type: row.dataset.lineType ?? '',
      number: Number(row.dataset.line),
      text: row.textContent ?? '',
      box: row.getBoundingClientRect(),
    }))
    .filter((row) => row.box.height > 0)
    .sort((a, b) => a.box.top - b.box.top);
}
