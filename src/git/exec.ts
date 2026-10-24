import { spawn } from 'node:child_process';

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export interface GitOptions {
  cwd: string;
  /** Written to git's stdin, then closed. */
  input?: string | Buffer;
  /** Extra environment, applied on top of the cleaned process environment. */
  env?: Record<string, string>;
  /** Exit codes that count as success. Defaults to 0 only. */
  okCodes?: number[];
}

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], code: number, stderr: string) {
    super(`git ${args.join(' ')} failed (${code}): ${stderr.trim() || 'no output'}`);
    this.name = 'GitError';
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Variables that would point git at another repo, index or work tree than the
 * one we resolved. Inherited ones are dropped (a git hook or an editor can set
 * them), so every call sees only the repo found from `cwd`.
 */
const REPO_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
];

function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of REPO_ENV) delete env[key];
  return {
    ...env,
    // Never take the index lock or write a refreshed index back, which
    // `git status` and friends otherwise do opportunistically.
    GIT_OPTIONAL_LOCKS: '0',
    // Treat every path we pass as a literal name, never a glob.
    GIT_LITERAL_PATHSPECS: '1',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    ...extra,
  };
}

/** Runs git and collects its output as raw bytes. */
export function runGit(args: string[], options: GitOptions): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: gitEnv(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? -1,
      };
      if ((options.okCodes ?? [0]).includes(result.code)) resolve(result);
      else reject(new GitError(args, result.code, result.stderr));
    });
    // git may exit before reading all of stdin (for example on a bad flag).
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}

/** Runs git and returns stdout as text with the trailing newline removed. */
export async function gitText(args: string[], options: GitOptions): Promise<string> {
  const { stdout } = await runGit(args, options);
  return stdout.toString('utf8').replace(/\n$/, '');
}

/** Runs git and returns trimmed stdout, or null when git exits non-zero. */
export async function gitTry(args: string[], options: GitOptions): Promise<string | null> {
  try {
    return (await gitText(args, options)).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}
