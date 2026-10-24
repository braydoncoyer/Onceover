import { useEffect, useRef } from 'react';

/** ⌘ on a Mac, Ctrl everywhere else. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

/** A key, with ⌘ (or Ctrl off a Mac) when `mod` is set. */
export interface Shortcut {
  key: string;
  mod?: boolean;
  run: () => void;
}

/** Typing in a field never triggers a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select');
}

/**
 * Page-wide single-key shortcuts. Ignored while typing, while another modifier
 * is held, and while `enabled` is false (an open menu has the keyboard).
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTyping(event.target)) return;
      const mod = isMac ? event.metaKey : event.ctrlKey;
      const other = isMac ? event.ctrlKey : event.metaKey;
      if (event.altKey || other) return;
      const shortcut = latest.current.find(
        (item) => item.key === event.key && Boolean(item.mod) === mod,
      );
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
