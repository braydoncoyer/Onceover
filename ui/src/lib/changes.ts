import { DIFFS_TAG_NAME } from '@pierre/diffs';

/** One run of changed lines in a file, measured in viewport pixels. */
export interface ChangeBlock {
  card: HTMLElement;
  top: number;
  bottom: number;
  /** The block's top within its card, which holds however the stack scrolls. */
  offset: number;
  /** The rows' left and right edges within the card, so a flash covers the lines and not the gutter. */
  left: number;
  right: number;
}

/**
 * Every run of added and removed lines in the open file cards, top to bottom.
 * Folded cards are skipped. Pierre draws lines in a shadow root, so this reads
 * them from there; in the split layout both columns' rows merge into one run.
 */
export function changeBlocks(root: HTMLElement): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  for (const card of root.querySelectorAll<HTMLElement>('[data-file-card]:not([data-collapsed])')) {
    const host = card.querySelector<HTMLElement>(DIFFS_TAG_NAME);
    const shadow = host?.shadowRoot;
    if (!host || !shadow) continue;
    const cardBox = card.getBoundingClientRect();
    // The tint starts at the diff's edge, line numbers included, as the line backgrounds do.
    const left = host.getBoundingClientRect().left - cardBox.left;
    const rows = [...shadow.querySelectorAll<HTMLElement>('[data-line][data-line-type^="change-"]')]
      .map((row) => row.getBoundingClientRect())
      .filter((rect) => rect.height > 0)
      .sort((a, b) => a.top - b.top);
    let current: ChangeBlock | null = null;
    for (const rect of rows) {
      if (current && rect.top <= current.bottom + 1) {
        current.bottom = Math.max(current.bottom, rect.bottom);
        current.right = Math.max(current.right, rect.right - cardBox.left);
      } else {
        current = {
          card,
          top: rect.top,
          bottom: rect.bottom,
          offset: rect.top - cardBox.top,
          left,
          right: rect.right - cardBox.left,
        };
        blocks.push(current);
      }
    }
  }
  return blocks;
}

/** Briefly tints a run of lines, so a jump shows where it landed. */
export function flashBlock(block: ChangeBlock, className: string) {
  const flash = document.createElement('div');
  flash.className = className;
  flash.setAttribute('aria-hidden', 'true');
  flash.style.top = `${block.offset}px`;
  flash.style.height = `${block.bottom - block.top}px`;
  flash.style.left = `${block.left}px`;
  flash.style.width = `${block.right - block.left}px`;
  block.card.querySelector('[data-flash]')?.remove();
  flash.dataset.flash = '';
  block.card.append(flash);
  flash.addEventListener('animationend', () => flash.remove(), { once: true });
  // In case the animation never runs, as in a hidden tab, clear it on a timer too.
  window.setTimeout(() => flash.remove(), 1200);
}

/** Smooth scrolling, unless the reader asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
