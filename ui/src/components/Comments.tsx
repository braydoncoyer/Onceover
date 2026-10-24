import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { scrollBehavior } from '../lib/changes';
import { lineLabel, type LineAnchor, type ReviewComment } from '../lib/comments';
import { MOD_LABEL, isMac } from '../lib/keys';
import { fullTime, initials, relativeTime, useNow } from '../lib/time';
import { IconPencil, IconTrash } from './Icons';
import { Button, Kbd } from './ui';
import s from './Comments.module.css';

/** A comment being written: new on lines or a file, or an edit of a saved one. */
export interface Draft {
  id: string;
  fileId: string;
  /** Null for a comment on the whole file. */
  anchor: LineAnchor | null;
  body: string;
  /** The saved comment this edits, if any. */
  editing: string | null;
}

/** What comment boxes and cards can do, shared from the review down to each thread. */
export interface CommentActions {
  /** Opens a box on lines of a file, or on the whole file when `anchor` is null. */
  startDraft: (fileId: string, anchor: LineAnchor | null) => void;
  changeDraft: (id: string, body: string) => void;
  cancelDraft: (id: string) => void;
  /** Closes a file's newest box on lines if nothing's been written in it, as when its lines are unselected. */
  dropEmptyDraft: (fileId: string) => void;
  saveDraft: (id: string) => void;
  editComment: (commentId: string) => void;
  deleteComment: (commentId: string) => void;
  /** The box that should take the keyboard, bumped each time it's asked to. */
  focus: { id: string; tick: number } | null;
}

const noop = () => {};
export const CommentActionsContext = createContext<CommentActions>({
  startDraft: noop,
  changeDraft: noop,
  cancelDraft: noop,
  dropEmptyDraft: noop,
  saveDraft: noop,
  editComment: noop,
  deleteComment: noop,
  focus: null,
});

export const useCommentActions = () => useContext(CommentActionsContext);

/** Saved comments and open boxes that share one spot: the same lines, or the top of a file. */
export interface ThreadItems {
  comments: ReviewComment[];
  drafts: Draft[];
}

/** Who's writing the review, for the name and avatar on their comments. Null when git doesn't know. */
export const ReviewerContext = createContext<string | null>(null);

const useReviewer = () => useContext(ReviewerContext) ?? 'You';

/**
 * The comments under a line (or atop a file), as one card: saved comments in
 * the order they were written, then a row to add another, or the box being
 * written in. A comment being edited turns into a box in its own place.
 */
export function CommentThread({
  comments,
  drafts,
  fileId,
  anchor,
  placement = 'line',
}: ThreadItems & {
  /** The file the thread is on, for its add-another row. */
  fileId: string;
  /** Where another comment on this thread goes: these lines, or the whole file when null. */
  anchor: LineAnchor | null;
  placement?: 'line' | 'file';
}) {
  const { startDraft } = useCommentActions();
  const editing = new Map(drafts.filter((draft) => draft.editing).map((draft) => [draft.editing, draft]));
  const fresh = drafts.filter((draft) => !draft.editing);
  return (
    <div className={`${s.thread} ${placement === 'file' ? s.fileThread : ''}`} data-comment-thread>
      <div className={s.card}>
        {comments.map((comment) => {
          const draft = editing.get(comment.id);
          return draft ? (
            <CommentComposer key={comment.id} draft={draft} label={labelFor(comment, placement)} tone={toneFor(comment)} />
          ) : (
            <CommentItem key={comment.id} comment={comment} placement={placement} />
          );
        })}
        {fresh.map((draft) => (
          <CommentComposer key={draft.id} draft={draft} label={labelFor(draft.anchor, placement)} tone={toneFor(draft.anchor)} />
        ))}
        {comments.length > 0 && fresh.length === 0 && <AddRow onClick={() => startDraft(fileId, anchor)} />}
      </div>
    </div>
  );
}

function labelFor(target: Pick<ReviewComment, 'side' | 'start' | 'end'> | LineAnchor | null, placement: 'line' | 'file'): string {
  if (!target || target.start === null) return 'Whole file';
  const label = lineLabel(target);
  // A line comment shown atop its file (its lines aren't drawn) says it's off to the side.
  return placement === 'file' ? `${label}, not in view` : label;
}

type Tone = 'added' | 'removed' | 'file' | 'outdated';

/** A comment's pill takes the color of what it points at: kept or new lines, removed lines, or the whole file. */
function toneFor(target: Pick<ReviewComment, 'side' | 'start'> | LineAnchor | null): Tone {
  if (!target || target.start === null) return 'file';
  return target.side === 'old' ? 'removed' : 'added';
}

/** A small round mark with the reviewer's initials. */
function Avatar({ name, muted = false }: { name: string; muted?: boolean }) {
  return (
    <span className={`${s.avatar} ${muted ? s.avatarMuted : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function Pill({ tone, children, title }: { tone: Tone; children: string; title?: string }) {
  return (
    <span className={s.pill} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

function CommentItem({ comment, placement }: { comment: ReviewComment; placement: 'line' | 'file' }) {
  const { editComment, deleteComment } = useCommentActions();
  const reviewer = useReviewer();
  const now = useNow();
  const edited = comment.updatedAt !== comment.createdAt;
  return (
    <article className={`${s.comment} ${comment.outdated ? s.outdated : ''}`} data-comment-id={comment.id}>
      <header className={s.meta}>
        <Avatar name={reviewer} />
        <span className={s.author}>{reviewer}</span>
        <time className={s.time} dateTime={comment.createdAt} title={fullTime(edited ? comment.updatedAt : comment.createdAt)}>
          {relativeTime(comment.createdAt, now)}
          {edited ? ' · edited' : ''}
        </time>
        {comment.outdated ? (
          <Pill tone="outdated" title="The code this pointed at has changed or is gone">
            Outdated
          </Pill>
        ) : null}
        <Pill tone={comment.outdated ? 'file' : toneFor(comment)}>{labelFor(comment, placement)}</Pill>
        <span className={s.actions}>
          <Button variant="ghost" size="sm" iconOnly title="Edit comment" aria-label="Edit comment" onClick={() => editComment(comment.id)}>
            <IconPencil size="var(--size-icon-xs)" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            title="Delete comment"
            aria-label="Delete comment"
            className={s.delete}
            onClick={() => deleteComment(comment.id)}
          >
            <IconTrash size="var(--size-icon-xs)" />
          </Button>
        </span>
      </header>
      {comment.outdated && comment.text.length > 0 && (
        <pre className={s.quote}>
          <code>{comment.text.length > 2 ? [comment.text[0], '…', comment.text.at(-1)].join('\n') : comment.text.join('\n')}</code>
        </pre>
      )}
      <p className={s.body} onDoubleClick={() => editComment(comment.id)}>
        {comment.body}
      </p>
    </article>
  );
}

/** The row under a thread's comments that opens a box for another one. */
function AddRow({ onClick }: { onClick: () => void }) {
  const reviewer = useReviewer();
  return (
    <button type="button" className={s.addRow} onClick={onClick}>
      <Avatar name={reviewer} muted />
      <span className={s.addLabel}>Add another comment</span>
    </button>
  );
}

/** A box to write a comment in. Grows with its text; ⌘↵ saves, Esc cancels. */
export function CommentComposer({ draft, label, tone }: { draft: Draft; label: string; tone: Tone }) {
  const { changeDraft, cancelDraft, saveDraft, focus } = useCommentActions();
  const reviewer = useReviewer();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Tracked here, not with :focus-within, which Chromium can miss on a box
  // Pierre has slotted into its diff.
  const [focused, setFocused] = useState(false);
  const empty = !draft.body.trim();

  // Grow with the text, up to a point.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [draft.body]);

  // A box just opened takes the keyboard, and comes into view if it's off screen.
  useEffect(() => {
    if (focus?.id !== draft.id) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
    // Pierre slots the box under its line as it draws, so scroll on the next frame.
    const frame = requestAnimationFrame(() =>
      field.closest('[data-comment-composer]')?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focus, draft.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelDraft(draft.id);
    } else if (event.key === 'Enter' && mod && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!empty) saveDraft(draft.id);
    }
  };

  return (
    <div
      className={s.composer}
      data-comment-composer
      data-focused={focused || undefined}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className={s.compose}>
        <Avatar name={reviewer} />
        <textarea
          ref={fieldRef}
          className={s.field}
          value={draft.body}
          rows={1}
          placeholder={draft.editing ? 'Edit your comment' : 'Leave a comment for Claude'}
          aria-label={`Comment on ${label.toLowerCase()}`}
          onChange={(event) => changeDraft(draft.id, event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <footer className={s.footer}>
        <Pill tone={tone}>{label}</Pill>
        <span className={s.buttons}>
          <Button variant="ghost" size="sm" onClick={() => cancelDraft(draft.id)} title="Cancel (Esc)">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            className={s.save}
            disabled={empty}
            onClick={() => saveDraft(draft.id)}
            title={`${draft.editing ? 'Save' : 'Comment'} (${MOD_LABEL}↵)`}
          >
            {draft.editing ? 'Save' : 'Comment'}
            <Kbd>{MOD_LABEL === '⌘' ? '⌘↵' : 'Ctrl ↵'}</Kbd>
          </Button>
        </span>
      </footer>
    </div>
  );
}
