// The JSON the server sends and takes. Shared with the UI as types only.
import type { BaseInfo, ChangedFile } from '../git/index.ts';

export interface MetaResponse {
  /** Repo name, shared by every worktree of the repo. */
  repo: string;
  /** Current branch, or null on a detached HEAD. */
  branch: string | null;
  /** Short SHA of HEAD, shown in place of the branch when detached. */
  shortHead: string;
  head: string;
  base: BaseInfo;
  /** The base detection would pick, offered in the base picker to go back to. Null when none is found. */
  defaultBase: string | null;
  mergeBase: string;
  /** This worktree's folder. */
  worktree: string;
  isLinkedWorktree: boolean;
}

export interface DiffResponse {
  /** HEAD and merge-base the diff was built from, so the page can tell when it's stale. */
  head: string;
  mergeBase: string;
  files: ChangedFile[];
}

export interface BranchesResponse {
  /** Short names like `main`, sorted by most recent commit first. */
  local: string[];
  /** Short names like `origin/main`, without symbolic refs like `origin/HEAD`. */
  remote: string[];
}

/** Body of `PUT /api/base`. A null base goes back to the detected one. */
export interface BaseRequest {
  base: string | null;
}

export interface ReviewComment {
  id: string;
  /** `null` for a file-level comment. A general note has no path either. */
  path: string | null;
  side: 'new' | 'old' | null;
  /** First and last line, 1-based and inclusive. Null for a file or general comment. */
  start: number | null;
  end: number | null;
  /** The exact text of the commented lines, for finding them again after a change. */
  text: string[];
  /** A couple of lines before and after, also for re-anchoring. */
  before: string[];
  after: string[];
  body: string;
  outdated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the page saves for one branch and base. */
export interface ReviewState {
  /** Paths marked viewed. */
  viewed: string[];
  /**
   * The version of each viewed file when it was marked, set by the page. A
   * file whose version has moved on since is no longer viewed.
   */
  viewedVersions: Record<string, string>;
  comments: ReviewComment[];
  /** The note for the whole review, by the Done button. */
  note: string;
}

export interface ReviewResponse extends ReviewState {
  branch: string;
  base: string;
}

/** Every error the API returns has this shape. */
export interface ApiError {
  error: {
    code: 'base-not-found' | 'no-merge-base' | 'bad-request' | 'not-found' | 'forbidden' | 'internal';
    message: string;
    /** Bases looked for, for `base-not-found`. */
    tried?: string[];
  };
}

/** Sent as `data:` on the event stream. */
export type ServerEvent =
  /** First event on every connection. A new `server` id means the page should reload its data. */
  | {
      type: 'hello';
      server: string;
      /** False when the server couldn't watch the repo, so edits won't show up on their own. */
      watching: boolean;
    }
  /**
   * The diff, the branch or the base changed since the last event. Sent once
   * per burst of edits, only when the result differs, with a fresh diff
   * already built and waiting at `/api/diff`.
   */
  | { type: 'changed'; version: string }
  /** The watcher stopped working (for example, out of file watches). Edits need a reload to show. */
  | { type: 'watching'; watching: false; reason: string };
