import { useEffect, useState } from 'react';
import type { FilesDelta } from '../lib/live';
import { splitPath } from '../lib/path';
import type { ReviewFile } from '../lib/types';
import { Kbd } from './ui';
import s from './UpdateToast.module.css';

/** How long the toast stays after the last change it reports, in ms. */
const SHOW_MS = 4000;

interface UpdateToastProps {
  /** Everything changed since the toast appeared. */
  delta: FilesDelta;
  /** Bumped with each refresh it reports, which keeps it up a while longer. */
  version: number;
  files: ReviewFile[];
  /** Some updated file is still unseen, so U and a click jump to it. */
  canJump: boolean;
  onJump: () => void;
  onDone: () => void;
  /** Drawn in place and kept up, for the playground. */
  inline?: boolean;
}

/** A quiet note at the bottom of the stack saying what the agent just changed. */
export function UpdateToast({ delta, version, files, canJump, onJump, onDone, inline }: UpdateToastProps) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setLeaving(false);
    if (hovered || inline) return;
    const timer = window.setTimeout(() => setLeaving(true), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [version, hovered]);

  const message = describe(delta, files);
  const content = (
    <>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.message}>{message}</span>
      {canJump && (
        <span className={s.action}>
          Show
          <Kbd cap>U</Kbd>
        </span>
      )}
    </>
  );

  return (
    <div className={inline ? s.inline : s.anchor}>
      <div
        className={`${s.toast} ${leaving ? s.leaving : ''}`}
        role="status"
        onAnimationEnd={(event) => {
          if (leaving && event.target === event.currentTarget) onDone();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {canJump ? (
          <button type="button" className={s.body} onClick={onJump} title="Show the next updated file (U)">
            {content}
          </button>
        ) : (
          <span className={s.body}>{content}</span>
        )}
      </div>
    </div>
  );
}

/** `useRideHistory.ts changed`, `New file StatusCard.tsx`, or `3 files changed` for a mix. */
function describe(delta: FilesDelta, files: ReviewFile[]) {
  const total = delta.changed.length + delta.added.length + delta.removed.length;
  const name = (id: string) => splitPath(files.find((file) => file.id === id)?.path ?? id).name;
  if (total === 1) {
    if (delta.added.length) {
      return (
        <>
          New file <strong>{name(delta.added[0])}</strong>
        </>
      );
    }
    if (delta.removed.length) {
      return (
        <>
          <strong>{splitPath(delta.removed[0]).name}</strong> removed
        </>
      );
    }
    return (
      <>
        <strong>{name(delta.changed[0])}</strong> changed
      </>
    );
  }
  const parts = [`${total} files changed`];
  if (delta.added.length) parts.push(`${delta.added.length} new`);
  if (delta.removed.length) parts.push(`${delta.removed.length} removed`);
  return (
    <>
      <strong>{parts[0]}</strong>
      {parts.length > 1 && <span className={s.extra}>{parts.slice(1).join(', ')}</span>}
    </>
  );
}
