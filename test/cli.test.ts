import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { UsageError, parseCliArgs, preferredPort } from '../src/cli.ts';
import { TestRepo, tempDir } from './helpers/repo.ts';

const bin = fileURLToPath(new URL('../bin/onceover.js', import.meta.url));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the command in `cwd` and waits for it to exit. */
function run(cwd: string, args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('parseCliArgs', () => {
  it('defaults to the detected base, a free port and opening the browser', () => {
    assert.deepEqual(parseCliArgs([]), { base: undefined, port: undefined, open: true, help: false, version: false });
  });

  it('reads --base, --port and --no-open', () => {
    assert.deepEqual(parseCliArgs(['--base', 'dev', '--port=5000', '--no-open']), {
      base: 'dev',
      port: 5000,
      open: false,
      help: false,
      version: false,
    });
  });

  it('turns away bad ports, empty bases, unknown flags and stray arguments', () => {
    for (const args of [['--port', 'abc'], ['--port', '0'], ['--port', '70000'], ['--port', '50.5'], ['--base', ' '], ['--nope'], ['main']]) {
      assert.throws(() => parseCliArgs(args), UsageError, args.join(' '));
    }
  });
});

describe('preferredPort', () => {
  it('gives the same folder the same port, in a quiet range', () => {
    assert.equal(preferredPort('/code/app'), preferredPort('/code/app'));
    for (const root of ['/a', '/code/app', '/code/app-2', '/Users/me/work/onceover']) {
      const port = preferredPort(root);
      assert.ok(port >= 47100 && port < 47900, `${root} → ${port}`);
    }
  });
});

describe('onceover command', () => {
  it('exits with one line outside a git repo, without serving', async () => {
    const result = await run(tempDir('plain'), ['--no-open']);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'onceover: not inside a git repo. Run it from a repo or worktree.\n');
  });

  it('exits with one line when --base names nothing', async () => {
    const repo = TestRepo.init();
    const result = await run(repo.dir, ['--no-open', '--base', 'nope']);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, 'onceover: couldn\'t find a branch or commit named "nope".\n');
  });

  it('explains bad flags', async () => {
    const result = await run(tempDir('plain'), ['--port', 'x']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--port needs a number/);
    assert.match(result.stderr, /onceover --help/);
  });

  it('prints help and the version', async () => {
    const help = await run(tempDir('plain'), ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: onceover \[options\]/);
    const version = await run(tempDir('plain'), ['-v']);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  });

  it('serves the review on 127.0.0.1 and stops cleanly on Ctrl+C', async () => {
    const origin = TestRepo.init({ 'a.ts': 'a\n' });
    const repo = TestRepo.clone(origin);
    repo.git('switch', '--quiet', '-c', 'feature');
    repo.write({ 'a.ts': 'b\n' });

    let served: { branch: string; files: number } | null = null;
    const result = await new Promise<Run>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, '--no-open'], { cwd: repo.path('.'), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', async (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout)?.[0];
        if (!url || served) return;
        served = { branch: '', files: -1 };
        const meta = (await (await fetch(`${url}api/meta`)).json()) as { branch: string };
        const diff = (await (await fetch(`${url}api/diff`)).json()) as { files: unknown[] };
        served = { branch: meta.branch, files: diff.files.length };
        child.kill('SIGINT');
      });
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /feature → origin\/main/);
    assert.deepEqual(served, { branch: 'feature', files: 1 });
  });
});

