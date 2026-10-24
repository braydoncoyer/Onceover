import { gitTry } from './exec.ts';
import type { RepoInfo } from './repo.ts';

export interface BaseInfo {
  /** The base as shown to the user, like `origin/main`. */
  ref: string;
  /** Commit the base points at. */
  sha: string;
  /**
   * How the base was chosen: the `--base` flag, the base picked in the page
   * this run, the base saved from an earlier run, or detection.
   */
  source: 'option' | 'picked' | 'saved' | 'origin-head' | 'fallback';
}

/** Bases tried in order when `origin/HEAD` isn't set. Remote refs first, since local `main` is often stale. */
export const FALLBACK_BASES = ['origin/main', 'origin/master', 'main', 'master'] as const;

export class BaseNotFoundError extends Error {
  /** Every ref that was looked for, in order. */
  readonly tried: string[];

  constructor(tried: string[]) {
    super(`Couldn't find a base branch. Tried ${tried.join(', ')}.`);
    this.name = 'BaseNotFoundError';
    this.tried = tried;
  }
}

export class NoMergeBaseError extends Error {
  readonly base: string;

  constructor(base: string) {
    super(`HEAD and ${base} have no commit in common.`);
    this.name = 'NoMergeBaseError';
    this.base = base;
  }
}

/**
 * Picks the branch to compare against: `base` when given (the `--base` flag or
 * the base saved for this repo), else `origin/HEAD`, else the first of
 * `origin/main`, `origin/master`, `main` and `master` that exists. Never fetches.
 */
export async function detectBase(repo: RepoInfo, base?: string): Promise<BaseInfo> {
  const cwd = repo.root;

  if (base) {
    const sha = base.startsWith('-') ? null : await resolveCommit(cwd, base);
    if (!sha) throw new BaseNotFoundError([base]);
    return { ref: base, sha, source: 'option' };
  }

  const tried: string[] = [];
  const originHead = await gitTry(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd });
  if (originHead) {
    const ref = originHead.replace(/^refs\/remotes\//, '');
    tried.push(ref);
    const sha = await resolveCommit(cwd, originHead);
    if (sha) return { ref, sha, source: 'origin-head' };
  } else {
    tried.push('origin/HEAD');
  }

  for (const ref of FALLBACK_BASES) {
    if (tried.includes(ref)) continue;
    tried.push(ref);
    const full = ref.startsWith('origin/') ? `refs/remotes/${ref}` : `refs/heads/${ref}`;
    const sha = await resolveCommit(cwd, full);
    if (sha) return { ref, sha, source: 'fallback' };
  }

  throw new BaseNotFoundError(tried);
}

/** The commit where HEAD left the base. Diffing from here keeps newer base commits out of the view. */
export async function findMergeBase(repo: RepoInfo, base: BaseInfo): Promise<string> {
  const sha = await gitTry(['merge-base', base.sha, repo.head], { cwd: repo.root });
  if (!sha) throw new NoMergeBaseError(base.ref);
  return sha;
}

function resolveCommit(cwd: string, rev: string): Promise<string | null> {
  return gitTry(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { cwd });
}
