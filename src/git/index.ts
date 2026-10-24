import { detectBase, findMergeBase, type BaseInfo } from './base.ts';
import { getChangedFiles, type ChangedFile } from './diff.ts';
import { findRepo, type RepoInfo } from './repo.ts';

export { BaseNotFoundError, FALLBACK_BASES, NoMergeBaseError, detectBase, findMergeBase } from './base.ts';
export type { BaseInfo } from './base.ts';
export { getChangedFiles } from './diff.ts';
export type { ChangeOrigin, ChangeStatus, ChangedFile } from './diff.ts';
export { GitError } from './exec.ts';
export { NoCommitsError, NotAGitRepoError, findRepo } from './repo.ts';
export type { RepoInfo } from './repo.ts';

export interface Review {
  repo: RepoInfo;
  base: BaseInfo;
  /** Full SHA of the commit where HEAD left the base. */
  mergeBase: string;
  files: ChangedFile[];
}

export interface ReviewOptions {
  /** Folder to start from. Defaults to the current folder. */
  cwd?: string;
  /** Branch or ref to compare against, used exactly as given. Detected when left out. */
  base?: string;
}

/** Everything the branch in `cwd` would ship, compared to where it left its base. Read-only. */
export async function loadReview(options: ReviewOptions = {}): Promise<Review> {
  const repo = await findRepo(options.cwd);
  const base = await detectBase(repo, options.base);
  const mergeBase = await findMergeBase(repo, base);
  const files = await getChangedFiles(repo, mergeBase);
  return { repo, base, mergeBase, files };
}
