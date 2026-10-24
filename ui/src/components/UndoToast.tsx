import { useEffect, useState } from 'react';
import { MOD_LABEL } from '../lib/keys';
import { Kbd } from './ui';
import s from './UpdateToast.module.css';

/** How long the way back stays on offer, in ms. */
const SHOW_MS = 6000;

/** A note that something was thrown away, with a way to bring it back. */
export function UndoToast({ message, onUndo, onDone }: { message: string; onUndo: () => void; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered) return;
    const timer = window.setTimeout(() => setLeaving(true), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [hovered]);

  return (
    <div className={s.anchor}>
      <div
        className={`${s.toast} ${leaving ? s.leaving : ''}`}
        role="status"
        onAnimationEnd={(event) => {
          if (leaving && event.target === event.currentTarget) onDone();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button type="button" className={s.body} onClick={onUndo} title={`Undo (${MOD_LABEL}Z)`}>
          <span className={s.message}>{message}</span>
          <span className={s.action}>
            Undo
            <Kbd cap>{MOD_LABEL === '⌘' ? '⌘Z' : 'Ctrl Z'}</Kbd>
          </span>
        </button>
      </div>
    </div>
  );
}
