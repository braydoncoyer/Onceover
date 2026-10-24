import { useCallback, useMemo, useRef, useState } from 'react';
import type { CommentActions, Draft } from '../components/Comments';
import { createComment, newCommentId, reanchorAll, type LineAnchor, type ReviewComment } from './comments';
import type { ReviewFile } from './types';

/** Something just thrown away, and how to bring it back. */
export interface Undo {
  id: number;
  message: string;
  restore: () => void;
}

const sameAnchor = (a: LineAnchor | null, b: LineAnchor | null) =>
  a === b || (a !== null && b !== null && a.side === b.side && a.start === b.start && a.end === b.end);

/**
 * The review's comments, its overall note and the comment boxes open on the
 * page. Comments follow their code each time the files change.
 */
export function useCommentState({
  files,
  initialComments,
  initialNote,
  onOpenFile,
}: {
  files: ReviewFile[];
  initialComments: ReviewComment[];
  initialNote: string;
  /** Unfolds a file's card so a box opened on it can be seen. */
  onOpenFile: (fileId: string) => void;
}) {
  const [comments, setComments] = useState(() => reanchorAll(initialComments, files));
  const [note, setNote] = useState(initialNote);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [focus, setFocus] = useState<CommentActions['focus']>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoCount = useRef(0);

  // Read through refs, so the actions keep one identity and cards don't redraw.
  const filesRef = useRef(files);
  filesRef.current = files;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const noteRef = useRef(note);
  noteRef.current = note;
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;

  // A refresh brought new files: find each comment's code again.
  const [seenFiles, setSeenFiles] = useState(files);
  if (files !== seenFiles) {
    setSeenFiles(files);
    setComments((prev) => reanchorAll(prev, files));
  }

  const focusOn = useCallback((id: string) => setFocus((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 })), []);

  const offerUndo = useCallback((message: string, restore: () => void) => {
    undoCount.current += 1;
    setUndo({ id: undoCount.current, message, restore });
  }, []);

  const actions = useMemo<Omit<CommentActions, 'focus'>>(
    () => ({
      startDraft(fileId, anchor) {
        openRef.current(fileId);
        const open = draftsRef.current.find(
          (draft) => draft.fileId === fileId && !draft.editing && sameAnchor(draft.anchor, anchor),
        );
        if (open) {
          focusOn(open.id);
          return;
        }
        const draft: Draft = { id: newCommentId(), fileId, anchor, body: '', editing: null };
        // A new selection replaces an untouched box on other lines of the same file.
        setDrafts((prev) => [
          ...prev.filter((other) => !(anchor && other.fileId === fileId && other.anchor && !other.editing && !other.body.trim())),
          draft,
        ]);
        focusOn(draft.id);
      },
      changeDraft(id, body) {
        setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, body } : draft)));
      },
      cancelDraft(id) {
        const draft = draftsRef.current.find((item) => item.id === id);
        if (!draft) return;
        setDrafts((prev) => prev.filter((item) => item.id !== id));
        const original = draft.editing ? commentsRef.current.find((comment) => comment.id === draft.editing)?.body : '';
        if (draft.body.trim() && draft.body !== original) {
          offerUndo(draft.editing ? 'Edit discarded' : 'Comment discarded', () => {
            setDrafts((prev) => [...prev.filter((item) => item.id !== id), draft]);
            focusOn(draft.id);
          });
        }
      },
      dropEmptyDraft(fileId) {
        setDrafts((prev) => {
          const last = prev.findLast((draft) => draft.fileId === fileId && draft.anchor && !draft.editing);
          return last && !last.body.trim() ? prev.filter((draft) => draft !== last) : prev;
        });
      },
      saveDraft(id) {
        const draft = draftsRef.current.find((item) => item.id === id);
        if (!draft || !draft.body.trim()) return;
        const body = draft.body.trim();
        if (draft.editing) {
          const now = new Date().toISOString();
          setComments((prev) => prev.map((comment) => (comment.id === draft.editing ? { ...comment, body, updatedAt: now } : comment)));
        } else {
          const file = filesRef.current.find((item) => item.id === draft.fileId);
          if (!file) return;
          setComments((prev) => [...prev, createComment(file, draft.anchor, body)]);
        }
        setDrafts((prev) => prev.filter((item) => item.id !== id));
      },
      editComment(commentId) {
        const open = draftsRef.current.find((draft) => draft.editing === commentId);
        if (open) {
          focusOn(open.id);
          return;
        }
        const comment = commentsRef.current.find((item) => item.id === commentId);
        if (!comment) return;
        const file = filesRef.current.find((item) => item.path === comment.path);
        if (!file) return;
        openRef.current(file.id);
        const draft: Draft = { id: newCommentId(), fileId: file.id, anchor: null, body: comment.body, editing: comment.id };
        setDrafts((prev) => [...prev, draft]);
        focusOn(draft.id);
      },
      deleteComment(commentId) {
        const index = commentsRef.current.findIndex((item) => item.id === commentId);
        if (index === -1) return;
        const comment = commentsRef.current[index];
        setComments((prev) => prev.filter((item) => item.id !== commentId));
        setDrafts((prev) => prev.filter((draft) => draft.editing !== commentId));
        offerUndo('Comment deleted', () =>
          setComments((prev) => (prev.some((item) => item.id === commentId) ? prev : [...prev.slice(0, index), comment, ...prev.slice(index)])),
        );
      },
    }),
    [focusOn, offerUndo],
  );

  /** Clears every comment, open box and the note, with a way back. */
  const clearAll = useCallback(() => {
    const saved = { comments: commentsRef.current, drafts: draftsRef.current, note: noteRef.current };
    if (saved.comments.length === 0 && saved.drafts.length === 0 && !saved.note) return;
    setComments([]);
    setDrafts([]);
    setNote('');
    offerUndo('Comments cleared', () => {
      setComments(saved.comments);
      setDrafts(saved.drafts);
      setNote(saved.note);
    });
  }, [offerUndo]);

  /** Focuses the newest open box, if any. Returns whether there was one. */
  const focusLatest = useCallback(() => {
    const last = draftsRef.current.at(-1);
    if (last) focusOn(last.id);
    return Boolean(last);
  }, [focusOn]);

  const context = useMemo<CommentActions>(() => ({ ...actions, focus }), [actions, focus]);

  return { comments, note, setNote, drafts, context, undo, setUndo, clearAll, focusLatest };
}
