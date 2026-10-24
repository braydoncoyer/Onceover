import { watch, type FSWatcher } from 'chokidar';
import { basename, relative, sep } from 'node:path';
import { runGit } from '../git/exec.ts';
import type { RepoInfo } from '../git/index.ts';

/** Quiet time after the last change before a rebuild, in ms. */
export const DEBOUNCE_MS = 250;
/** Longest a rebuild waits while changes keep landing, so a busy agent still shows up within a second. */
export const MAX_WAIT_MS = 1000;

export interface RepoWatcher {
  /** Resolves once the first scan is done and every change from then on is seen. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export interface WatchOptions {
  /** Called once per burst of changes, after it settles. */
  onChange: () => void;
  /** Called when the watcher fails, for example when the system runs out of file watches. */
  onError?: (error: Error) => void;
  debounceMs?: number;
  maxWaitMs?: number;
}

/**
 * Watches everything that can change the diff: the work tree (minus ignored
 * paths), HEAD and the index in this worktree's git dir, and the refs in the
 * shared git dir, so commits, staging, branch switches and a moved base all
 * count. Only reads; Onceover's own files under `<git-dir>/onceover/` are
 * never watched, so saving a review doesn't trigger a rebuild.
 */
export function watchRepo(repo: RepoInfo, options: WatchOptions): RepoWatcher {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  let timer: NodeJS.Timeout | undefined;
  let firstAt = 0;
  let closed = false;

  const fire = () => {
    clearTimeout(timer);
    timer = undefined;
    firstAt = 0;
    if (!closed) options.onChange();
  };
  const changed = () => {
    if (closed) return;
    const now = Date.now();
    if (!firstAt) firstAt = now;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now)));
  };

  let failed = false;
  const onError = (error: unknown) => {
    // Report the first failure only; the watchers keep whatever they could set up.
    if (failed || closed) return;
    failed = true;
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  // Git's own files. Allow-listed, so objects, logs and Onceover's state are skipped.
  const gitPaths = new Set([repo.gitDir, repo.commonDir]);
  const gitWatcher = watch([...gitPaths], {
    ignoreInitial: true,
    ignored: (path) => !isGitPathWatched(repo, path),
  });
  gitWatcher.on('all', changed).on('error', onError);

  // The work tree, rebuilt when an ignore file changes so newly ignored or
  // unignored folders are picked up.
  let tree: FSWatcher | null = null;
  let treeReady: Promise<void> = Promise.resolve();
  const startTree = async () => {
    const ignored = await listIgnored(repo).catch(() => new Set<string>());
    if (closed) return;
    const next = watch(repo.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (path) => isTreePathIgnored(repo.root, path, ignored),
    });
    next.on('all', (_event, path) => {
      if (isIgnoreFile(repo.root, path)) void restartTree();
      changed();
    });
    next.on('error', onError);
    const previous = tree;
    tree = next;
    await previous?.close();
    await new Promise<void>((resolve) => next.once('ready', resolve));
  };
  let restarting: Promise<void> | null = null;
  const restartTree = () => {
    restarting ??= startTree().finally(() => {
      restarting = null;
    });
    return restarting;
  };
  treeReady = restartTree();

  const ready = Promise.all([new Promise<void>((resolve) => gitWatcher.once('ready', resolve)), treeReady]).then(
    () => undefined,
  );

  return {
    ready,
    async close() {
      closed = true;
      clearTimeout(timer);
      await restarting?.catch(() => {});
      await Promise.all([gitWatcher.close(), tree?.close()]);
    },
  };
}

/** HEAD and the index of this worktree, and every ref (loose or packed) in the shared git dir. */
function isGitPathWatched(repo: RepoInfo, path: string): boolean {
  if (path === repo.gitDir || path === repo.commonDir) return true;
  const own = relative(repo.gitDir, path);
  if (own === 'HEAD' || own === 'index') return true;
  const shared = relative(repo.commonDir, path);
  if (shared === 'packed-refs') return true;
  return (shared === 'refs' || shared.startsWith(`refs${sep}`)) && !shared.endsWith('.lock');
}

function isTreePathIgnored(root: string, path: string, ignored: Set<string>): boolean {
  const rel = relative(root, path);
  if (rel === '') return false;
  const parts = rel.split(sep);
  // Any repo's git dir, the main checkout's or a nested repo's.
  if (parts.includes('.git')) return true;
  let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (ignored.has(prefix)) return true;
  }
  return false;
}

function isIgnoreFile(root: string, path: string): boolean {
  return basename(path) === '.gitignore' && !relative(root, path).startsWith('..');
}

/**
 * Untracked paths git ignores, with whole ignored folders (like
 * `node_modules`) listed once, so the watcher never walks into them.
 */
async function listIgnored(repo: RepoInfo): Promise<Set<string>> {
  const { stdout } = await runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], {
    cwd: repo.root,
  });
  const paths = new Set<string>();
  for (const entry of stdout.toString('utf8').split('\0')) {
    if (entry) paths.add(entry.replace(/\/$/, ''));
  }
  return paths;
}
