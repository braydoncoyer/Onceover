import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import s from './Dialog.module.css';

/**
 * A modal panel near the top of the window, over a dimmed page. Escape or a
 * click outside closes it, and focus goes back where it was.
 */
export function Dialog({
  label,
  onClose,
  onKeyDown,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first field, else the panel itself.
    (panel?.querySelector<HTMLElement>('input') ?? panel)?.focus();
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  return createPortal(
    <div className={s.backdrop} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={className ? `${s.panel} ${className}` : s.panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          onKeyDown?.(event);
          // Keys pressed here never reach the page's shortcuts.
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
