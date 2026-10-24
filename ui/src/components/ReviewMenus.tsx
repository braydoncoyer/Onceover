import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { lineLabel, sortComments, type ReviewComment } from '../lib/comments';
import { MOD_LABEL } from '../lib/keys';
import { splitPath } from '../lib/path';
import type { ReviewFile } from '../lib/types';
import { IconCheck, IconComment, IconCopy, IconWarning } from './Icons';
import { Button, Kbd } from './ui';
import s from './ReviewMenus.module.css';

/** What Done reviewing did, shown under its button until dismissed. */
export type DoneResult =
  | { kind: 'empty'; unsaved: number }
  | {
      kind: 'copied';
      markdown: string;
      count: number;
      /** Whether the clipboard took it. */
      copied: boolean;
      /** Where `last-review.md` was saved, once it has been. */
      saved: string | null;
      /** Comment boxes with text that weren't saved, so aren't in the copy. */
      unsaved: number;
    };

const DONE_LABEL = MOD_LABEL === '⌘' ? '⌘⇧↵' : 'Ctrl ⇧ ↵';

/** Closes a popover on a click outside `root`, or on Escape. */
function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close.current();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, root]);
}

interface CommentsMenuProps {
  comments: ReviewComment[];
  files: ReviewFile[];
  note: string;
  onNoteChange: (note: string) => void;
  onReveal: (comment: ReviewComment) => void;
  onClear: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The comment count in the header. Opens the note for the whole review and
 * every comment in reading order; picking one scrolls to it.
 */
export function CommentsMenu({ comments, files, note, onNoteChange, onReveal, onClear, open, onOpenChange }: CommentsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useDismiss(open, rootRef, () => onOpenChange(false));
  const sorted = sortComments(comments, files);
  const hasNote = Boolean(note.trim());

  useEffect(() => {
    if (open) noteRef.current?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    const field = noteRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [note, open]);

  return (
    <div ref={rootRef} className={s.root}>
      <Button
        variant="ghost"
        className={`${s.trigger} ${open ? s.triggerOpen : ''}`}
        title="Comments and review note"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        <IconComment />
        <span className={s.count}>{comments.length}</span>
        {hasNote && <span className={s.noteDot} aria-label="Has a review note" />}
      </Button>

      {open && (
        <div className={`${s.panel} ${s.reviewPanel}`} role="dialog" aria-label="Comments and review note">
          <label className={s.noteSection}>
            <span className={s.sectionTitle}>Note for the whole review</span>
            <textarea
              ref={noteRef}
              className={s.note}
              value={note}
              rows={2}
              placeholder="Anything that isn't about one line, like what to tackle first"
              onChange={(event) => onNoteChange(event.target.value)}
            />
          </label>

          <div className={s.listHead}>
            <span className={s.sectionTitle}>
              Comments <span className={s.sectionCount}>{comments.length}</span>
            </span>
            {(comments.length > 0 || hasNote) && (
              <Button variant="ghost" size="sm" className={s.clear} onClick={onClear}>
                Clear all
              </Button>
            )}
          </div>

          {sorted.length === 0 ? (
            <p className={s.empty}>
              Click a line number to comment on it, drag for a range, or press <Kbd cap>C</Kbd> to comment on the
              file you're on.
            </p>
          ) : (
            <ul className={s.list}>
              {sorted.map((comment) => (
                <li key={comment.id}>
                  <button
                    type="button"
                    className={s.row}
                    onClick={() => {
                      onOpenChange(false);
                      onReveal(comment);
                    }}
                  >
                    <span className={s.rowHead}>
                      <span className={s.rowFile}>{splitPath(comment.path ?? '').name}</span>
                      <span className={s.rowLines}>{lineLabel(comment)}</span>
                      {comment.outdated && <span className={s.outdated}>Outdated</span>}
                    </span>
                    <span className={s.rowBody}>{comment.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface DoneMenuProps {
  result: DoneResult | null;
  onDone: () => void;
  onClose: () => void;
  onClear: () => void;
}

/** The Done reviewing button, and what it did: copied, saved, and a way to clear comments. */
export function DoneMenu({ result, onDone, onClose, onClear }: DoneMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(result !== null, rootRef, onClose);

  return (
    <div ref={rootRef} className={s.root}>
      <Button variant="primary" title={`Done reviewing (${DONE_LABEL})`} onClick={onDone} aria-expanded={result !== null}>
        Done reviewing
        <Kbd>{DONE_LABEL}</Kbd>
      </Button>
      {result && (
        <div className={`${s.panel} ${s.donePanel}`} role="dialog" aria-label="Review copied">
          {result.kind === 'empty' ? (
            <Status icon={<IconComment />} title="Nothing to send yet">
              {result.unsaved > 0
                ? 'Save your open comment first, then press Done again.'
                : 'Comment on a line, a file or the whole review, then press Done again.'}
            </Status>
          ) : (
            <>
              {result.copied ? (
                <Status icon={<IconCheck />} tone="success" title="Review copied">
                  {result.count > 0
                    ? `${plural(result.count, 'comment')}, ready to paste into Claude Code.`
                    : 'Your note is ready to paste into Claude Code.'}
                </Status>
              ) : (
                <Status icon={<IconWarning />} tone="warning" title="Couldn't copy the review">
                  The browser didn't allow it. Copy it again, or select the text below.
                </Status>
              )}
              {result.unsaved > 0 && (
                <p className={s.notice}>
                  {result.unsaved === 1
                    ? "An open comment box isn't saved, so it isn't included."
                    : `${result.unsaved} open comment boxes aren't saved, so they aren't included.`}
                </p>
              )}
              <pre className={s.preview} tabIndex={0} aria-label="The copied review">
                {result.markdown}
              </pre>
              <div className={s.footer}>
                <span className={s.saved} title={result.saved ?? undefined}>
                  {result.saved && (
                    <>
                      Also saved to <code className={s.path}>{result.saved}</code>
                    </>
                  )}
                </span>
                {!result.copied && (
                  <Button variant="secondary" size="sm" onClick={onDone}>
                    <IconCopy size="var(--size-icon-sm)" />
                    Copy again
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  Clear comments
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Status({
  icon,
  title,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: 'success' | 'warning';
  children: ReactNode;
}) {
  return (
    <div className={s.status}>
      <span className={`${s.statusIcon} ${tone ? s[tone] : ''}`}>{icon}</span>
      <span className={s.statusText}>
        <strong className={s.statusTitle}>{title}</strong>
        <span className={s.statusBody}>{children}</span>
      </span>
    </div>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
