import type { ReviewFile } from './types.ts';

/** How the page keeps up with the repo. */
export type LiveStatus =
  /** Watching: edits show up on their own. */
  | 'live'
  /** Lost the server; the page reconnects when it's back. */
  | 'offline'
  /** The server is up but couldn't watch the repo. */
  | 'paused';

/** What changed between two versions of the file list. */
export interface FilesDelta {
  /** Files whose diff changed: their viewed mark no longer holds. */
  changed: string[];
  added: string[];
  removed: string[];
}

export function compareFiles(prev: ReviewFile[], next: ReviewFile[]): FilesDelta {
  const before = new Map(prev.map((file) => [file.id, file]));
  const after = new Set(next.map((file) => file.id));
  const changed: string[] = [];
  const added: string[] = [];
  for (const file of next) {
    const old = before.get(file.id);
    if (!old) added.push(file.id);
    else if (old.version !== file.version) changed.push(file.id);
  }
  const removed = prev.filter((file) => !after.has(file.id)).map((file) => file.id);
  return { changed, added, removed };
}

export function isEmptyDelta(delta: FilesDelta): boolean {
  return delta.changed.length + delta.added.length + delta.removed.length === 0;
}

/**
 * Keeps the previous object for every file that's the same in both lists, so
 * cards whose diff didn't move aren't drawn again.
 */
export function reuseUnchanged(prev: ReviewFile[], next: ReviewFile[]): ReviewFile[] {
  const before = new Map(prev.map((file) => [file.id, file]));
  return next.map((file) => {
    const old = before.get(file.id);
    const same =
      old &&
      old.version === file.version &&
      old.status === file.status &&
      old.origin === file.origin &&
      old.uncommitted === file.uncommitted &&
      old.prevPath === file.prevPath;
    return same ? old : file;
  });
}
