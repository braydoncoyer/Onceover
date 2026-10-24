import type { FileDiffMetadata } from '@pierre/diffs';

// What the review screen renders, whether from the playground fixtures or the server.

/** Where a file's changes live, relative to the merge-base. */
export type ChangeOrigin = 'committed' | 'uncommitted' | 'new';

export interface ReviewFile {
  id: string;
  path: string;
  prevPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary' | 'generated';
  origin: ChangeOrigin;
  additions: number;
  deletions: number;
  comments: number;
  diff?: FileDiffMetadata;
  /** Over the large-file threshold, so the diff waits behind a Load diff button. */
  large?: boolean;
  /** Binary files only. */
  size?: { before: number; after: number };
}

export interface ReviewMeta {
  repo: string;
  /** Branch name, or the short SHA on a detached HEAD. */
  branch: string;
  base: string;
  mergeBase: string;
}
