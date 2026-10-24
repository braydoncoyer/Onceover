import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { GitError, gitText, gitTry } from './exec.ts';

export interface RepoInfo {
  /** Top of the work tree we're in. In a linked worktree, that worktree's folder. */
  root: string;
  /** Repo name, taken from the main checkout so linked worktrees share it. */
  name: string;
  /** This work tree's git dir (`.git`, or `.git/worktrees/<name>` in a linked worktree). */
  gitDir: string;
  /** The git dir shared by every worktree: refs, objects and config live here. */
  commonDir: string;
  /** True inside a linked worktree made with `git worktree add`. */
  isLinkedWorktree: boolean;
  /** Current branch name, or null on a detached HEAD. */
  branch: string | null;
  /** Full SHA of HEAD. */
  head: string;
  /** Abbreviated SHA of HEAD, for showing in place of a detached branch name. */
  shortHead: string;
}

export class NotAGitRepoError extends Error {
  readonly cwd: string;

  constructor(cwd: string) {
    super(`Not inside a git work tree: ${cwd}`);
    this.name = 'NotAGitRepoError';
    this.cwd = cwd;
  }
}

export class NoCommitsError extends Error {
  constructor(root: string) {
    super(`This branch has no commits yet, so there's nothing to compare: ${root}`);
    this.name = 'NoCommitsError';
  }
}

/** Finds the repo or linked worktree that contains `cwd`. Read-only. */
export async function findRepo(cwd: string = process.cwd()): Promise<RepoInfo> {
  let root: string;
  try {
    root = await gitText(['rev-parse', '--show-toplevel'], { cwd });
  } catch (error) {
    if (error instanceof GitError) throw new NotAGitRepoError(cwd);
    throw error;
  }
  if (!root) throw new NotAGitRepoError(cwd);

  const [dirs, branch, head] = await Promise.all([
    gitText(['rev-parse', '--git-dir', '--git-common-dir'], { cwd: root }),
    gitTry(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root }),
    gitTry(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: root }),
  ]);
  if (!head) throw new NoCommitsError(root);

  const [gitDirRaw, commonDirRaw] = dirs.split('\n');
  const gitDir = absolute(root, gitDirRaw);
  const commonDir = absolute(root, commonDirRaw);
  const shortHead = await gitText(['rev-parse', '--short', head], { cwd: root });

  return {
    root,
    name: repoName(commonDir),
    gitDir,
    commonDir,
    isLinkedWorktree: gitDir !== commonDir,
    branch: branch || null,
    head,
    shortHead,
  };
}

function absolute(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

/** `/code/onceover/.git` → `onceover`, and a bare `/code/onceover.git` → `onceover`. */
function repoName(commonDir: string): string {
  const base = basename(commonDir);
  if (base === '.git') return basename(dirname(commonDir));
  return base.replace(/\.git$/, '');
}
