import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BaseNotFoundError, NoCommitsError, NotAGitRepoError, detectBase, findRepo } from './git/index.ts';
import { openBrowser } from './server/open.ts';
import { PortInUseError, startServer } from './server/server.ts';

const HELP = `Review everything this branch would ship, in your browser.

Usage: onceover [options]

Options:
  --base <branch>   Compare against this branch instead of the detected base
  --port <number>   Serve on this port (default: a free port, the same one each run when possible)
  --no-open         Don't open the browser
  -h, --help        Show this help
  -v, --version     Show the version

Run it anywhere inside a git repo or linked worktree. Read-only: it never
changes your index, work tree or refs.`;

/** How long to wait for a tab from an earlier run to reconnect before opening a new one. */
const REUSE_WAIT_MS = 1500;

export interface CliOptions {
  base?: string;
  port?: number;
  open: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

export function parseCliArgs(args: string[]): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      allowNegative: true,
      options: {
        base: { type: 'string' },
        port: { type: 'string' },
        open: { type: 'boolean', default: true },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message.replace(/\. To specify a positional argument.*$/s, '.'));
  }

  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!/^\d+$/.test(values.port) || port < 1 || port > 65535) {
      throw new UsageError(`--port needs a number from 1 to 65535, got "${values.port}".`);
    }
  }
  const base = values.base?.trim();
  if (values.base !== undefined && !base) throw new UsageError('--base needs a branch name.');

  return { base, port, open: values.open, help: values.help, version: values.version };
}

/**
 * The port a worktree gets by default. The same folder gets the same port
 * each run, so a tab left open from an earlier run reconnects on its own.
 */
export function preferredPort(root: string): number {
  const hash = createHash('sha1').update(root).digest().readUInt32BE(0);
  return 47100 + (hash % 800);
}

const here = dirname(fileURLToPath(import.meta.url));

/** The built UI, from a checkout (`src/` next to `dist/ui`) or a build (`dist/node` next to `dist/ui`). */
function findUiDir(): string {
  const candidates = [join(here, '..', 'dist', 'ui'), join(here, '..', 'ui')];
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? candidates[0];
}

function version(): string {
  for (const path of [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')]) {
    if (!existsSync(path)) continue;
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; version?: string };
    if (pkg.name === '@braydoncoyer/onceover') return pkg.version ?? '0.0.0';
  }
  return '0.0.0';
}

const dim = (text: string) => (process.stdout.isTTY ? `\x1b[2m${text}\x1b[22m` : text);
const bold = (text: string) => (process.stdout.isTTY ? `\x1b[1m${text}\x1b[22m` : text);

function fail(message: string): never {
  process.stderr.write(`onceover: ${message}\n`);
  process.exit(1);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    if (error instanceof UsageError) fail(`${error.message}\nRun onceover --help for usage.`);
    throw error;
  }
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (options.version) {
    process.stdout.write(`${version()}\n`);
    return;
  }

  let repo;
  try {
    repo = await findRepo(process.cwd());
  } catch (error) {
    if (error instanceof NotAGitRepoError) fail('not inside a git repo. Run it from a repo or worktree.');
    if (error instanceof NoCommitsError) fail("this branch has no commits yet, so there's nothing to compare.");
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail("couldn't run git. Is it installed?");
    throw error;
  }

  // A --base that doesn't exist is a typo to fix now. A base that can't be
  // detected is left to the page, which explains what was tried.
  if (options.base) {
    try {
      await detectBase(repo, options.base);
    } catch (error) {
      if (!(error instanceof BaseNotFoundError)) throw error;
      fail(`couldn't find a branch or commit named "${options.base}".`);
    }
  }

  let server;
  try {
    server = await startServer({
      repo,
      base: options.base,
      uiDir: findUiDir(),
      port: options.port,
      preferredPort: preferredPort(repo.root),
    });
  } catch (error) {
    if (error instanceof PortInUseError) fail(`port ${error.port} is in use. Pick another with --port.`);
    throw error;
  }

  const branch = repo.branch ?? repo.shortHead;
  const baseLabel = (await server.currentBase()) ?? 'no base found';
  process.stdout.write(
    `\n  ${bold('onceover')}  ${repo.name} ${dim('·')} ${branch} ${dim('→')} ${baseLabel}\n` +
      `  ${server.url}\n\n` +
      `  ${dim('Press Ctrl+C to stop.')}\n\n`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (options.open) {
    const reused = await server.waitForPage(REUSE_WAIT_MS);
    if (reused) {
      process.stdout.write(`  ${dim('Reconnected to the tab that was already open.')}\n\n`);
    } else if (!(await openBrowser(server.url))) {
      process.stdout.write(`  ${dim("Couldn't open a browser. Open the link above.")}\n\n`);
    }
  }
}

export function run(): void {
  main().catch((error: unknown) => {
    process.stderr.write(`onceover: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}

// `node src/cli.ts` in a checkout. The installed command goes through bin/onceover.js.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) run();
