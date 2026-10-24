import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

// Keep the machine's own git config (signing, hooks, default branch) out of
// every repo the tests make, and out of the module under test.
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'onceover-test-')));
const globalConfig = join(sandbox, 'gitconfig');
writeFileSync(
  globalConfig,
  ['[user]', '\tname = Test', '\temail = test@example.com', '[init]', '\tdefaultBranch = main', '[commit]', '\tgpgsign = false', ''].join('\n'),
);
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_') && !key.startsWith('GIT_CONFIG')) delete process.env[key];
}
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));

let counter = 0;

/** A fresh folder under the test sandbox. */
export function tempDir(name = 'dir'): string {
  const dir = join(sandbox, `${name}-${++counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class TestRepo {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** A new repo on `main` with one commit, or no commits when `files` is empty. */
  static init(files: Record<string, string | Buffer> = { 'README.md': '# test\n' }): TestRepo {
    const repo = new TestRepo(tempDir('repo'));
    repo.git('init', '--quiet');
    if (Object.keys(files).length > 0) {
      repo.write(files);
      repo.commitAll('Initial commit');
    }
    return repo;
  }

  /** Clones `origin` so `origin/HEAD` and `origin/main` exist. */
  static clone(origin: TestRepo): TestRepo {
    const dir = tempDir('clone');
    execFileSync('git', ['clone', '--quiet', origin.dir, dir], { stdio: 'pipe' });
    return new TestRepo(dir);
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  }

  path(path: string): string {
    return join(this.dir, path);
  }

  write(files: Record<string, string | Buffer>): this {
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(this.path(path)), { recursive: true });
      writeFileSync(this.path(path), contents);
    }
    return this;
  }

  read(path: string): string {
    return readFileSync(this.path(path), 'utf8');
  }

  remove(path: string): this {
    unlinkSync(this.path(path));
    return this;
  }

  chmod(path: string, mode: number): this {
    chmodSync(this.path(path), mode);
    return this;
  }

  symlink(target: string, path: string): this {
    symlinkSync(target, this.path(path));
    return this;
  }

  commitAll(message: string): string {
    this.git('add', '--all');
    this.git('commit', '--quiet', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }
}

/**
 * Every file under `dir` with its size, mtime and a hash of its bytes, so a
 * test can prove nothing in a repo (its index, refs, objects or work tree)
 * was written.
 */
export function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        files.set(`${relative(dir, full)}/`, 'dir');
        walk(full);
      } else if (entry.isFile()) {
        const stat = statSync(full);
        const hash = createHash('sha1').update(readFileSync(full)).digest('hex');
        files.set(relative(dir, full), `${stat.size} ${stat.mtimeMs} ${hash}`);
      } else {
        files.set(relative(dir, full), entry.isSymbolicLink() ? 'symlink' : 'other');
      }
    }
  };
  walk(dir);
  return files;
}
