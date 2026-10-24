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
  /** Changes whenever the file's diff does, so a viewed mark can tell it's stale. */
  version?: string;
  diff?: FileDiffMetadata;
  /** Over the large-file threshold, so the diff waits behind a Load diff button. */
  large?: boolean;
  /** Binary files, and generated files that are also binary. Null on the side where the file doesn't exist. */
  size?: { before: number | null; after: number | null };
  /** A generated file that's binary, so its revealed body shows sizes rather than lines. */
  binary?: boolean;
  /** Some of the changes aren't committed yet. Shown as a badge. */
  uncommitted?: boolean;
  /** Old and new git modes, when they differ: `100644 → 100755`, or a file turned into a symlink. */
  mode?: { before: string; after: string };
  /** A submodule pointer: the commits it moved between. Null on the side where it doesn't exist. */
  submodule?: { before: string | null; after: string | null };
}

export interface ReviewMeta {
  repo: string;
  /** Branch name, or the short SHA on a detached HEAD. */
  branch: string;
  /** HEAD isn't on a branch, so `branch` is a short SHA. */
  detached?: boolean;
  base: string;
  /** The base detection picks, offered in the picker to go back to. */
  defaultBase?: string | null;
  mergeBase: string;
}

/** Line counts mean nothing for binaries and submodules, and +0 -0 is noise. */
export function hasLineCounts(file: ReviewFile): boolean {
  if (file.status === 'binary' || file.binary || file.size || file.submodule) return false;
  return file.additions + file.deletions > 0;
}
