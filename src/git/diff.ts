import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitError, gitText, runGit } from './exec.ts';
import type { RepoInfo } from './repo.ts';

/** Where a file's changes live, relative to the merge-base. */
export type ChangeOrigin = 'committed' | 'uncommitted' | 'new';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'type-changed';

export interface ChangedFile {
  /** Path in the work tree. For a deleted file, the path it had. */
  path: string;
  /** The old path of a renamed file. */
  prevPath?: string;
  status: ChangeStatus;
  /** How alike a renamed file's old and new contents are, 0 to 100. */
  similarity?: number;
  /** The badge to show: `new` for an untracked file, else `uncommitted` if any change isn't committed yet. */
  origin: ChangeOrigin;
  /** Every place this file's changes live, since a committed file can also have uncommitted edits. */
  origins: ChangeOrigin[];
  binary: boolean;
  /** A lockfile, a minified file or a file marked `linguist-generated`. */
  generated: boolean;
  /** A submodule pointer rather than a file. */
  submodule: boolean;
  /** Git file modes like `100644`, null on the side where the file doesn't exist. */
  oldMode: string | null;
  newMode: string | null;
  additions: number;
  deletions: number;
  /** Git's unified diff for this file alone, starting at its `diff --git` line. */
  patch: string;
  /** Contents at the merge-base. Null when the file is new, binary or a submodule. */
  oldContents: string | null;
  /** Contents on disk now. Null when the file is deleted, binary or a submodule. */
  newContents: string | null;
  /** Sizes in bytes, null on the side where the file doesn't exist. */
  oldSize: number | null;
  newSize: number | null;
}

const NO_MODE = '000000';
const SUBMODULE_MODE = '160000';
const SYMLINK_MODE = '120000';

/**
 * Config that would change the shape of git's output. Pinned so a user's
 * global settings can't break parsing.
 */
const STABLE_CONFIG = [
  '-c', 'core.quotePath=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'diff.relative=false',
  '-c', 'core.splitIndex=false',
];

const DIFF_FLAGS = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative'];

/**
 * Every file that differs between `mergeBase` and the work tree: committed,
 * staged and unstaged changes plus untracked files, with old and new contents.
 *
 * Read-only. Untracked files are diffed through a throwaway copy of the index
 * in the OS temp folder, where they're marked intent-to-add. That puts them in
 * the same `git diff` as everything else, so a file moved with plain `mv`
 * shows as a rename instead of a deletion and an unrelated new file. The
 * repo's own index is only ever read.
 */
export async function getChangedFiles(repo: RepoInfo, mergeBase: string): Promise<ChangedFile[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readChangedFiles(repo, mergeBase);
    } catch (error) {
      // An agent editing files while git runs can make the separate git calls
      // disagree, or remove an untracked file before it's marked. Try again.
      const retry = error instanceof GitError || error instanceof OutOfSyncError;
      if (!retry || attempt === 3) throw error;
    }
  }
}

class OutOfSyncError extends Error {}

async function readChangedFiles(repo: RepoInfo, mergeBase: string): Promise<ChangedFile[]> {
  const cwd = repo.root;
  const untracked = await listUntracked(cwd);
  const scratch = untracked.length > 0 ? await indexWithUntracked(repo, untracked) : null;

  try {
    const env = scratch?.env;
    const diff = (flags: string[]) =>
      runGit([...STABLE_CONFIG, 'diff', ...DIFF_FLAGS, ...flags, mergeBase, '--'], { cwd, env });

    const [raw, numstat, patch, committed, uncommitted] = await Promise.all([
      diff(['--raw', '-z', '--no-abbrev']),
      diff(['--numstat', '-z']),
      diff(['--src-prefix=a/', '--dst-prefix=b/']),
      nameSet(cwd, [mergeBase, 'HEAD']),
      nameSet(cwd, ['HEAD']),
    ]);

    const entries = parseRaw(raw.stdout);
    const counts = parseNumstat(numstat.stdout);
    const patches = splitPatch(patch.stdout.toString('utf8'));
    if (counts.length !== entries.length || patches.length !== entries.length) {
      throw new OutOfSyncError(
        `git diff output didn't line up: ${entries.length} files, ${counts.length} counts, ${patches.length} patches`,
      );
    }

    const untrackedSet = new Set(untracked);
    const generated = await generatedSet(
      cwd,
      entries.map((entry) => entry.path),
    );

    const files = entries.map((entry, i): ChangedFile => {
      const count = counts[i];
      const submodule = entry.oldMode === SUBMODULE_MODE || entry.newMode === SUBMODULE_MODE;
      const paths = entry.prevPath ? [entry.path, entry.prevPath] : [entry.path];
      const isNew = untrackedSet.has(entry.path);

      const origins: ChangeOrigin[] = [];
      if (paths.some((path) => committed.has(path))) origins.push('committed');
      if (isNew || paths.some((path) => uncommitted.has(path))) origins.push('uncommitted');
      if (isNew && entry.status === 'added') origins.push('new');

      return {
        path: entry.path,
        ...(entry.prevPath ? { prevPath: entry.prevPath, similarity: entry.similarity } : {}),
        status: entry.status,
        origin: origins.includes('new') ? 'new' : origins.includes('uncommitted') ? 'uncommitted' : 'committed',
        origins,
        binary: count.binary,
        generated: generated.has(entry.path),
        submodule,
        oldMode: entry.oldMode === NO_MODE ? null : entry.oldMode,
        newMode: entry.newMode === NO_MODE ? null : entry.newMode,
        additions: count.additions,
        deletions: count.deletions,
        patch: patches[i],
        oldContents: null,
        newContents: null,
        oldSize: null,
        newSize: null,
      };
    });

    await loadContents(cwd, files, entries);
    return files;
  } finally {
    if (scratch) await rm(scratch.dir, { recursive: true, force: true });
  }
}

async function listUntracked(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  // A trailing slash marks a nested repo, which git won't diff as a file.
  return splitNul(stdout).filter((path) => !path.endsWith('/'));
}

/**
 * Copies the index to a temp folder and marks `untracked` intent-to-add in the
 * copy. `git add -N` also stores the empty blob, so objects go to a temp
 * folder too, with the repo's own objects readable as an alternate.
 */
async function indexWithUntracked(repo: RepoInfo, untracked: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'onceover-'));
  const index = join(dir, 'index');
  try {
    const objects = resolve(repo.root, await gitText(['rev-parse', '--git-path', 'objects'], { cwd: repo.root }));
    await mkdir(join(dir, 'objects'));
    const env = {
      GIT_INDEX_FILE: index,
      GIT_OBJECT_DIRECTORY: join(dir, 'objects'),
      // A colon separates entries here, so a path containing one is quoted.
      GIT_ALTERNATE_OBJECT_DIRECTORIES: /[:"]/.test(objects) ? JSON.stringify(objects) : objects,
    };
    try {
      const source = join(repo.gitDir, 'index');
      const { atime, mtime } = await stat(source);
      await copyFile(source, index);
      // Git trusts an entry whose file looks unchanged unless the file is at
      // least as new as the index ("racily clean"). A fresh copy would look
      // newer than an edit made in the same second, hiding that edit.
      await utimes(index, atime, mtime);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // No index yet (a fresh worktree can lack one): start from HEAD's tree.
      await runGit(['read-tree', 'HEAD'], { cwd: repo.root, env });
    }
    await runGit(
      [...STABLE_CONFIG, 'add', '--intent-to-add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      { cwd: repo.root, env, input: untracked.join('\0') },
    );
    return { dir, env };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Paths changed between two points, both sides of renames listed. */
async function nameSet(cwd: string, revs: string[]): Promise<Set<string>> {
  const { stdout } = await runGit(
    [...STABLE_CONFIG, 'diff', '--name-only', '--no-renames', '-z', '--no-ext-diff', '--no-relative', ...revs, '--'],
    { cwd },
  );
  return new Set(splitNul(stdout));
}

interface RawEntry {
  path: string;
  prevPath?: string;
  status: ChangeStatus;
  similarity?: number;
  oldMode: string;
  newMode: string;
  oldSha: string;
}

const STATUS: Record<string, ChangeStatus> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'type-changed',
  U: 'modified',
};

/** Parses `git diff --raw -z`: `:oldmode newmode oldsha newsha status\0path\0[newpath\0]`. */
export function parseRaw(output: Buffer): RawEntry[] {
  const fields = splitNul(output);
  const entries: RawEntry[] = [];
  for (let i = 0; i < fields.length; ) {
    const [oldMode, newMode, oldSha, , statusField] = fields[i++].slice(1).split(' ');
    const letter = statusField[0];
    const status = STATUS[letter] ?? 'modified';
    if (letter === 'R') {
      const prevPath = fields[i++];
      const path = fields[i++];
      entries.push({ path, prevPath, status, similarity: Number(statusField.slice(1)), oldMode, newMode, oldSha });
    } else if (letter === 'C') {
      // Copies only show up with -C, which we don't pass. Shown as a new file if they ever do.
      i++;
      entries.push({ path: fields[i++], status: 'added', oldMode: NO_MODE, newMode, oldSha });
    } else {
      entries.push({ path: fields[i++], status, oldMode, newMode, oldSha });
    }
  }
  return entries;
}

interface Count {
  additions: number;
  deletions: number;
  binary: boolean;
}

/** Parses `git diff --numstat -z`. Renames read `adds\tdels\t\0old\0new\0`, binary files `-\t-\t`. */
export function parseNumstat(output: Buffer): Count[] {
  const fields = splitNul(output);
  const counts: Count[] = [];
  for (let i = 0; i < fields.length; ) {
    const [additions, deletions, path] = fields[i++].split('\t');
    if (path === '') i += 2;
    const binary = additions === '-';
    counts.push({
      additions: binary ? 0 : Number(additions),
      deletions: binary ? 0 : Number(deletions),
      binary,
    });
  }
  return counts;
}

/**
 * Splits a multi-file patch at each `diff --git` header. Content lines always
 * start with a space, `+`, `-`, `@` or `\`, and git quotes any path with a
 * newline in it, so a header can't appear inside a file's patch.
 */
export function splitPatch(patch: string): string[] {
  if (!patch) return [];
  const parts = patch.split(/\n(?=diff --git )/);
  return parts.map((part, i) => (i < parts.length - 1 ? `${part}\n` : part));
}

const GENERATED_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'uv.lock',
  'Podfile.lock',
  'Package.resolved',
  'go.sum',
]);

function looksGenerated(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return GENERATED_NAMES.has(name) || /\.min\.(js|mjs|cjs|css)$/.test(name);
}

/** Lockfiles and minified files, plus `linguist-generated` in `.gitattributes`, which can also turn them off. */
async function generatedSet(cwd: string, paths: string[]): Promise<Set<string>> {
  const result = new Set(paths.filter(looksGenerated));
  if (paths.length === 0) return result;
  const { stdout } = await runGit(['check-attr', '-z', '--stdin', 'linguist-generated'], {
    cwd,
    input: paths.join('\0'),
  });
  const fields = splitNul(stdout);
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [path, , value] = fields.slice(i, i + 3);
    if (value === 'set' || value === 'true') result.add(path);
    else if (value === 'unset' || value === 'false') result.delete(path);
  }
  return result;
}

/** Fills in contents and sizes: old blobs from git in one batch, new files from disk. */
async function loadContents(cwd: string, files: ChangedFile[], entries: RawEntry[]): Promise<void> {
  const textBlobs: string[] = [];
  const binaryBlobs: string[] = [];
  files.forEach((file, i) => {
    if (file.oldMode === null || file.submodule) return;
    (file.binary ? binaryBlobs : textBlobs).push(entries[i].oldSha);
  });

  const [text, sizes] = await Promise.all([
    catFile(cwd, '--batch', textBlobs),
    catFile(cwd, '--batch-check', binaryBlobs),
  ]);

  await Promise.all(
    files.map(async (file, i) => {
      if (file.submodule) return;
      const sha = entries[i].oldSha;
      if (file.oldMode !== null) {
        const blob = (file.binary ? sizes : text).get(sha);
        if (blob) {
          file.oldSize = blob.size;
          if (!file.binary) file.oldContents = blob.contents.toString('utf8');
        }
      }
      if (file.status !== 'deleted' && file.newMode !== null) {
        const disk = await readWorkTree(cwd, file.path, file.newMode === SYMLINK_MODE);
        if (disk) {
          file.newSize = disk.length;
          if (!file.binary) file.newContents = disk.toString('utf8');
        }
      }
    }),
  );
}

/** Reads a file as git sees it: a symlink's contents are its target. */
async function readWorkTree(cwd: string, path: string, symlink: boolean): Promise<Buffer | null> {
  const full = join(cwd, path);
  try {
    if (symlink || (await lstat(full)).isSymbolicLink()) return Buffer.from(await readlink(full));
    return await readFile(full);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw error;
  }
}

interface Blob {
  size: number;
  contents: Buffer;
}

/** Reads many objects through one `git cat-file` process. */
async function catFile(cwd: string, mode: '--batch' | '--batch-check', shas: string[]): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  const unique = [...new Set(shas)];
  if (unique.length === 0) return blobs;

  const { stdout } = await runGit(['cat-file', mode], { cwd, input: `${unique.join('\n')}\n` });
  let at = 0;
  for (const sha of unique) {
    const end = stdout.indexOf(0x0a, at);
    const header = stdout.toString('utf8', at, end).split(' ');
    at = end + 1;
    if (header[1] === 'missing' || header.length < 3) continue;
    const size = Number(header[2]);
    if (mode === '--batch') {
      blobs.set(sha, { size, contents: stdout.subarray(at, at + size) });
      at += size + 1;
    } else {
      blobs.set(sha, { size, contents: Buffer.alloc(0) });
    }
  }
  return blobs;
}

function splitNul(output: Buffer): string[] {
  const text = output.toString('utf8');
  if (!text) return [];
  const fields = text.split('\0');
  if (fields[fields.length - 1] === '') fields.pop();
  return fields;
}
