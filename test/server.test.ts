import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { findRepo } from '../src/git/index.ts';
import type { ApiError, BranchesResponse, DiffResponse, MetaResponse, ReviewResponse, ServerEvent } from '../src/server/api.ts';
import { PortInUseError, startServer, type OnceoverServer } from '../src/server/server.ts';
import { TestRepo, snapshot, tempDir } from './helpers/repo.ts';

/** A clone with `origin/main`, on a `feature` branch with one committed, one unstaged and one new file. */
function featureRepo(): TestRepo {
  const origin = TestRepo.init({ 'committed.ts': 'export const a = 1;\n', 'unstaged.ts': 'export const b = 1;\n' });
  const repo = TestRepo.clone(origin);
  repo.git('switch', '--quiet', '-c', 'feature');
  repo.write({ 'committed.ts': 'export const a = 2;\n' }).commitAll('Edit a');
  repo.write({ 'unstaged.ts': 'export const b = 2;\n', 'new.ts': 'export const c = 3;\n' });
  return repo;
}

/** A stand-in for the built UI. */
function uiDir(): string {
  const dir = tempDir('ui');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Onceover</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1);');
  return dir;
}

const servers: OnceoverServer[] = [];
after(() => Promise.all(servers.map((server) => server.close())));

async function serve(repo: TestRepo, options: { base?: string; port?: number; preferredPort?: number } = {}) {
  const server = await startServer({ repo: await findRepo(repo.dir), uiDir: uiDir(), ...options });
  servers.push(server);
  return server;
}

interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json<T>(): T;
}

/** A raw request, so tests can set headers like Host that fetch won't let through. */
function request(
  server: OnceoverServer,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: server.port, path, method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: <T>() => JSON.parse(body.toString('utf8')) as T,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

function putBase(server: OnceoverServer, base: unknown, headers: Record<string, string> = {}) {
  return request(server, '/api/base', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ base }),
  });
}

function putReview(server: OnceoverServer, review: unknown, headers: Record<string, string> = {}) {
  return request(server, '/api/review', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(review),
  });
}

/** Opens the event stream and resolves with the first event. */
function firstEvent(server: OnceoverServer, query = ''): Promise<{ data: unknown; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.port, path: `/api/events${query}` }, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
      let text = '';
      res.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
        const match = /^data: (.*)$/m.exec(text);
        if (match) resolve({ data: JSON.parse(match[1]), close: () => req.destroy() });
      });
    });
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

/** Opens the event stream and keeps every event, for tests that wait on the watcher. */
async function eventLog(server: OnceoverServer): Promise<{
  events: ServerEvent[];
  next: (type: ServerEvent['type'], ms?: number) => Promise<ServerEvent>;
  close: () => void;
}> {
  await server.watchReady;
  const events: ServerEvent[] = [];
  const waiters = new Set<() => void>();
  const req = httpRequest({ host: '127.0.0.1', port: server.port, path: '/api/events' }, (res) => {
    let text = '';
    res.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      let end;
      while ((end = text.indexOf('\n\n')) !== -1) {
        const match = /^data: (.*)$/m.exec(text.slice(0, end));
        text = text.slice(end + 2);
        if (match) events.push(JSON.parse(match[1]) as ServerEvent);
        for (const waiter of waiters) waiter();
      }
    });
  });
  req.on('error', () => {});
  req.end();
  let seen = 0;
  const next = (type: ServerEvent['type'], ms = 3000) =>
    new Promise<ServerEvent>((resolve, reject) => {
      const check = () => {
        const index = events.findIndex((event, i) => i >= seen && event.type === type);
        if (index === -1) return;
        seen = index + 1;
        cleanup();
        resolve(events[index]);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`No ${type} event within ${ms} ms`));
      }, ms);
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(check);
      };
      waiters.add(check);
      check();
    });
  await next('hello');
  return { events, next, close: () => req.destroy() };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const changedEvents = (events: ServerEvent[]) => events.filter((event) => event.type === 'changed').length;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

describe('server API', () => {
  it('binds to 127.0.0.1 only', async () => {
    const server = await serve(featureRepo());
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('describes the repo, branch, base and merge-base', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    const meta = (await request(server, '/api/meta')).json<MetaResponse>();
    assert.equal(meta.repo, repo.dir.split('/').pop());
    assert.equal(meta.branch, 'feature');
    assert.equal(meta.head, repo.git('rev-parse', 'HEAD'));
    assert.equal(meta.shortHead, repo.git('rev-parse', '--short', 'HEAD'));
    assert.deepEqual(meta.base, { ref: 'origin/main', sha: repo.git('rev-parse', 'origin/main'), source: 'origin-head' });
    assert.equal(meta.defaultBase, 'origin/main');
    assert.equal(meta.mergeBase, repo.git('rev-parse', 'origin/main'));
    assert.equal(meta.worktree, repo.dir);
    assert.equal(meta.isLinkedWorktree, false);
  });

  it('sends every changed file with old and new contents', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    const diff = (await request(server, '/api/diff')).json<DiffResponse>();
    assert.equal(diff.head, repo.git('rev-parse', 'HEAD'));
    assert.deepEqual(
      diff.files.map((file) => [file.path, file.origin, file.oldContents, file.newContents]),
      [
        ['committed.ts', 'committed', 'export const a = 1;\n', 'export const a = 2;\n'],
        ['new.ts', 'new', null, 'export const c = 3;\n'],
        ['unstaged.ts', 'uncommitted', 'export const b = 1;\n', 'export const b = 2;\n'],
      ],
    );
  });

  it('reads HEAD fresh on every request', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    repo.commitAll('Commit the rest');
    const meta = (await request(server, '/api/meta')).json<MetaResponse>();
    assert.equal(meta.head, repo.git('rev-parse', 'HEAD'));
    const diff = (await request(server, '/api/diff')).json<DiffResponse>();
    assert.deepEqual(diff.files.map((file) => file.origin), ['committed', 'committed', 'committed']);
  });

  it('compresses big responses for clients that accept gzip', async () => {
    const repo = featureRepo();
    repo.write({ 'big.ts': 'export const line = "some code";\n'.repeat(2000) });
    const server = await serve(repo);
    const res = await request(server, '/api/diff', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.headers['content-encoding'], 'gzip');
    const diff = JSON.parse(gunzipSync(res.body).toString('utf8')) as DiffResponse;
    assert.ok(diff.files.some((file) => file.path === 'big.ts'));
  });

  it('uses --base exactly as given', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev', 'feature~1');
    const server = await serve(repo, { base: 'dev' });
    const meta = (await request(server, '/api/meta')).json<MetaResponse>();
    assert.equal(meta.base.ref, 'dev');
    assert.equal(meta.base.source, 'option');
  });

  it('explains which bases it tried when none exist', async () => {
    const repo = TestRepo.init();
    repo.git('branch', '--move', 'main', 'feature');
    const server = await serve(repo);
    for (const path of ['/api/meta', '/api/diff']) {
      const res = await request(server, path);
      assert.equal(res.status, 409);
      const { error } = res.json<ApiError>();
      assert.equal(error.code, 'base-not-found');
      assert.deepEqual(error.tried, ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']);
    }
  });

  it('reports a branch with no history in common with its base', async () => {
    const repo = featureRepo();
    repo.commitAll('Commit the rest');
    repo.git('switch', '--quiet', '--orphan', 'unrelated');
    repo.commitAll('Unrelated');
    const server = await serve(repo);
    const res = await request(server, '/api/diff');
    assert.equal(res.status, 409);
    assert.equal(res.json<ApiError>().error.code, 'no-merge-base');
  });

  it('lists local and remote branches without symbolic refs', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev');
    const server = await serve(repo);
    const branches = (await request(server, '/api/branches')).json<BranchesResponse>();
    assert.deepEqual([...branches.local].sort(), ['dev', 'feature', 'main']);
    assert.deepEqual(branches.remote, ['origin/main']);
  });

  it('answers unknown API routes and methods with JSON errors', async () => {
    const server = await serve(featureRepo());
    const missing = await request(server, '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json<ApiError>().error.code, 'not-found');
    const method = await request(server, '/api/diff', { method: 'DELETE' });
    assert.equal(method.status, 405);
  });
});

describe('base picker', () => {
  it('switches the base, diffs against it and remembers it next run', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev');
    const first = await serve(repo);
    const res = await putBase(first, 'dev');
    assert.equal(res.status, 200);
    const meta = res.json<MetaResponse>();
    assert.deepEqual(meta.base, { ref: 'dev', sha: repo.git('rev-parse', 'dev'), source: 'picked' });
    assert.equal(meta.defaultBase, 'origin/main');
    assert.equal(meta.mergeBase, repo.git('rev-parse', 'dev'));
    const diff = (await request(first, '/api/diff')).json<DiffResponse>();
    assert.deepEqual(diff.files.map((file) => file.path), ['new.ts', 'unstaged.ts']);
    assert.equal((await request(first, '/api/review')).json<ReviewResponse>().base, 'dev');
    assert.match(repo.read('.git/onceover/settings.json'), /"base": "dev"/);
    await first.close();

    const second = await serve(repo);
    const again = (await request(second, '/api/meta')).json<MetaResponse>();
    assert.equal(again.base.ref, 'dev');
    assert.equal(again.base.source, 'saved');
  });

  it('lets --base win over the saved base until a new pick', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev', 'feature~1');
    repo.git('branch', 'staging', 'feature~1');
    await putBase(await serve(repo), 'dev');
    const server = await serve(repo, { base: 'staging' });
    assert.equal((await request(server, '/api/meta')).json<MetaResponse>().base.ref, 'staging');
    await putBase(server, 'origin/main');
    assert.equal((await request(server, '/api/meta')).json<MetaResponse>().base.ref, 'origin/main');
  });

  it('goes back to the detected base on null', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev', 'feature~1');
    const server = await serve(repo);
    await putBase(server, 'dev');
    const meta = (await putBase(server, null)).json<MetaResponse>();
    assert.equal(meta.base.ref, 'origin/main');
    assert.equal(meta.base.source, 'origin-head');
    const next = (await request(await serve(repo), '/api/meta')).json<MetaResponse>();
    assert.equal(next.base.ref, 'origin/main');
  });

  it('turns away a base that is missing or shares no history, keeping the current one', async () => {
    const repo = featureRepo();
    repo.commitAll('Commit the rest');
    repo.git('switch', '--quiet', '--orphan', 'unrelated');
    repo.commitAll('Unrelated');
    repo.git('switch', '--quiet', 'feature');
    const server = await serve(repo);

    const missing = await putBase(server, 'nope');
    assert.equal(missing.status, 409);
    assert.deepEqual(missing.json<ApiError>().error.tried, ['nope']);
    const unrelated = await putBase(server, 'unrelated');
    assert.equal(unrelated.status, 409);
    assert.equal(unrelated.json<ApiError>().error.code, 'no-merge-base');
    for (const body of ['', 3, ['dev']]) {
      assert.equal((await putBase(server, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await request(server, '/api/meta')).json<MetaResponse>().base.ref, 'origin/main');
  });

  it('falls back to detection when the saved base is gone', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev', 'feature~1');
    await putBase(await serve(repo), 'dev');
    repo.git('branch', '--delete', '--force', 'dev');
    const meta = (await request(await serve(repo), '/api/meta')).json<MetaResponse>();
    assert.equal(meta.base.ref, 'origin/main');
  });

  it('lists the saved base first among the bases it tried when nothing is found', async () => {
    const repo = TestRepo.init();
    repo.git('branch', 'dev');
    repo.git('branch', '--move', 'main', 'feature');
    await putBase(await serve(repo), 'dev');
    repo.git('branch', '--delete', '--force', 'dev');
    const res = await request(await serve(repo), '/api/meta');
    assert.equal(res.status, 409);
    assert.deepEqual(res.json<ApiError>().error.tried, ['dev', 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']);
  });
});

describe('review storage', () => {
  it('starts empty, saves to <git-dir>/onceover and survives a restart', async () => {
    const repo = featureRepo();
    const first = await serve(repo);
    assert.deepEqual((await request(first, '/api/review')).json<ReviewResponse>(), {
      branch: 'feature',
      base: 'origin/main',
      viewed: [],
      viewedVersions: {},
      comments: [],
      note: '',
    });

    const comment = {
      id: 'c1',
      path: 'committed.ts',
      side: 'new',
      start: 1,
      end: 1,
      text: ['export const a = 2;'],
      body: 'Why 2?',
    };
    const saved = await putReview(first, {
      viewed: ['new.ts', 'new.ts'],
      // A version for a file that isn't viewed is dropped.
      viewedVersions: { 'new.ts': 'v1', 'committed.ts': 'v9' },
      comments: [comment],
      note: 'Close.',
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json<ReviewResponse>().viewed, ['new.ts']);
    assert.deepEqual(saved.json<ReviewResponse>().viewedVersions, { 'new.ts': 'v1' });
    await first.close();

    const second = await serve(repo);
    const review = (await request(second, '/api/review')).json<ReviewResponse>();
    assert.deepEqual(review.viewed, ['new.ts']);
    assert.deepEqual(review.viewedVersions, { 'new.ts': 'v1' });
    assert.equal(review.note, 'Close.');
    assert.equal(review.comments.length, 1);
    assert.equal(review.comments[0].body, 'Why 2?');
    assert.equal(review.comments[0].outdated, false);
    assert.match(repo.read('.git/onceover/review.json'), /"Why 2\?"/);
  });

  it('keeps a separate review per base', async () => {
    const repo = featureRepo();
    repo.git('branch', 'dev', 'feature~1');
    await putReview(await serve(repo), { viewed: ['new.ts'] });
    const other = (await request(await serve(repo, { base: 'dev' }), '/api/review')).json<ReviewResponse>();
    assert.equal(other.base, 'dev');
    assert.deepEqual(other.viewed, []);
  });

  it('turns away malformed reviews without touching what was saved', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    await putReview(server, { viewed: ['new.ts'] });

    const bad = [
      { viewed: 'new.ts' },
      { viewed: ['new.ts'], viewedVersions: { 'new.ts': 3 } },
      { comments: [{ id: 'c1', body: 1 }] },
      { comments: [{ id: 'c1', body: 'x', start: 4, end: 2 }] },
      { comments: [{ id: 'c1', body: 'x', side: 'left' }] },
      [],
    ];
    for (const body of bad) {
      const res = await putReview(server, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json<ApiError>().error.code, 'bad-request');
    }
    const notJson = await request(server, '/api/review', { method: 'PUT', body: '{}', headers: { 'content-type': 'text/plain' } });
    assert.equal(notJson.status, 415);
    const broken = await request(server, '/api/review', { method: 'PUT', body: '{', headers: { 'content-type': 'application/json' } });
    assert.equal(broken.status, 400);

    assert.deepEqual((await request(server, '/api/review')).json<ReviewResponse>().viewed, ['new.ts']);
  });

  it('keeps reviews of a linked worktree in that worktree\'s git dir', async () => {
    const repo = featureRepo();
    const worktreeDir = join(tempDir('worktrees'), 'wt');
    repo.git('worktree', 'add', '--quiet', '-b', 'agent', worktreeDir, 'feature');
    const worktree = new TestRepo(worktreeDir);
    await putReview(await serve(worktree), { viewed: ['committed.ts'] });
    assert.match(repo.read('.git/worktrees/wt/onceover/review.json'), /committed\.ts/);
  });
});

describe('server safety', () => {
  it('only answers to 127.0.0.1 and localhost host names', async () => {
    const server = await serve(featureRepo());
    const rebound = await request(server, '/api/meta', { headers: { host: `evil.example:${server.port}` } });
    assert.equal(rebound.status, 403);
    const localhost = await request(server, '/api/meta', { headers: { host: `localhost:${server.port}` } });
    assert.equal(localhost.status, 200);
  });

  it('turns away requests from other origins', async () => {
    const server = await serve(featureRepo());
    const res = await putReview(server, { viewed: [] }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    const own = await putReview(server, { viewed: [] }, { origin: `http://127.0.0.1:${server.port}` });
    assert.equal(own.status, 200);
  });

  it('never writes to the repo outside <git-dir>/onceover', async () => {
    const repo = featureRepo();
    repo.git('add', 'unstaged.ts');
    repo.write({ 'unstaged.ts': 'export const b = 3;\n' });
    const status = repo.git('status', '--porcelain');
    const before = snapshot(repo.dir);

    const server = await serve(repo);
    for (const path of ['/api/meta', '/api/diff', '/api/branches', '/api/review']) {
      assert.equal((await request(server, path)).status, 200, path);
    }
    await putReview(server, { viewed: ['new.ts'] });
    await putBase(server, 'main');

    const afterSnap = snapshot(repo.dir);
    for (const key of afterSnap.keys()) if (key.startsWith('.git/onceover')) afterSnap.delete(key);
    assert.deepEqual(afterSnap, before);
    assert.equal(repo.git('status', '--porcelain'), status);
  });
});

describe('static UI', () => {
  it('serves the built page, its assets and the page for any other route', async () => {
    const server = await serve(featureRepo());
    const page = await request(server, '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(page.body.toString(), /<title>Onceover<\/title>/);
    assert.equal(page.headers['cache-control'], 'no-cache');

    const asset = await request(server, '/assets/app-abc123.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.match(String(asset.headers['cache-control']), /immutable/);

    assert.equal((await request(server, '/some/route')).status, 200);
    assert.equal((await request(server, '/assets/missing.js')).status, 404);
  });

  it("doesn't serve files outside the UI folder", async () => {
    const server = await serve(featureRepo());
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%00']) {
      const res = await request(server, path);
      assert.ok(res.status === 404 || !/"name"/.test(res.body.toString()), path);
    }
  });
});

describe('events and ports', () => {
  it('greets each page with the server id, which changes on restart', async () => {
    const repo = featureRepo();
    const first = await serve(repo);
    const one = await firstEvent(first);
    one.close();
    const again = await firstEvent(first);
    again.close();
    assert.deepEqual(one.data, again.data);
    assert.equal((one.data as { type: string }).type, 'hello');

    const second = await serve(repo);
    const other = await firstEvent(second);
    other.close();
    assert.notDeepEqual(other.data, one.data);
  });

  it('notices a page for this worktree reconnecting, but not one for another', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    const waiting = server.waitForPage(2000);
    const page = await firstEvent(server, `?worktree=${encodeURIComponent(repo.dir)}`);
    assert.equal(await waiting, true);
    page.close();

    const stranger = server.waitForPage(300);
    const otherPage = await firstEvent(server, '?worktree=%2Fsomewhere%2Felse');
    assert.equal(await stranger, false);
    otherPage.close();
  });

  it('fails clearly when an exact port is taken', async () => {
    const taken = await serve(featureRepo());
    await assert.rejects(serve(featureRepo(), { port: taken.port }), PortInUseError);
  });

  it('moves past a taken preferred port', async () => {
    const taken = await serve(featureRepo());
    const server = await serve(featureRepo(), { preferredPort: taken.port });
    assert.notEqual(server.port, taken.port);
    const preferred = await freePort();
    const exact = await serve(featureRepo(), { preferredPort: preferred });
    assert.equal(exact.port, preferred);
  });
});

describe('live refresh', () => {
  it('tells the page when a file is edited, with the new diff ready', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    await request(server, '/api/diff');
    const log = await eventLog(server);
    const started = Date.now();
    repo.write({ 'unstaged.ts': 'export const b = 3;\n' });
    await log.next('changed');
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
    const diff = (await request(server, '/api/diff')).json<DiffResponse>();
    assert.equal(diff.files.find((file) => file.path === 'unstaged.ts')?.newContents, 'export const b = 3;\n');
    log.close();
  });

  it('picks up new files, commits and branch switches', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    const log = await eventLog(server);

    repo.write({ 'brand-new.ts': 'export const d = 4;\n' });
    await log.next('changed');
    let diff = (await request(server, '/api/diff')).json<DiffResponse>();
    assert.ok(diff.files.some((file) => file.path === 'brand-new.ts'));

    repo.commitAll('Commit the rest');
    await log.next('changed');
    diff = (await request(server, '/api/diff')).json<DiffResponse>();
    assert.equal(diff.head, repo.git('rev-parse', 'HEAD'));
    assert.ok(diff.files.every((file) => file.origin === 'committed'));

    repo.git('switch', '--quiet', '-c', 'feature-2');
    await log.next('changed');
    const meta = (await request(server, '/api/meta')).json<MetaResponse>();
    assert.equal(meta.branch, 'feature-2');
    log.close();
  });

  it('stays quiet for ignored files, saved reviews and edits that change nothing', async () => {
    const repo = featureRepo();
    repo.write({ '.gitignore': 'node_modules/\n*.log\n' }).commitAll('Ignore');
    repo.write({ 'node_modules/pkg/index.js': 'module.exports = 1;\n' });
    const server = await serve(repo);
    await request(server, '/api/diff');
    const log = await eventLog(server);

    repo.write({ 'node_modules/pkg/index.js': 'module.exports = 2;\n', 'debug.log': 'hi\n' });
    await putReview(server, { viewed: ['new.ts'] });
    // Same contents written again, as an editor's save does.
    repo.write({ 'unstaged.ts': repo.read('unstaged.ts') });
    await sleep(1200);
    assert.equal(changedEvents(log.events), 0);
    log.close();
  });

  it('sends one event for a burst of edits', async () => {
    const repo = featureRepo();
    const server = await serve(repo);
    await request(server, '/api/diff');
    const log = await eventLog(server);
    for (let i = 0; i < 5; i++) {
      repo.write({ 'unstaged.ts': `export const b = ${10 + i};\n` });
      await sleep(40);
    }
    await log.next('changed');
    await sleep(600);
    assert.equal(changedEvents(log.events), 1);
    log.close();
  });

  it('watches a linked worktree, not the main checkout', async () => {
    const repo = featureRepo();
    const worktreeDir = tempDir('worktree');
    repo.git('worktree', 'add', '--quiet', '-b', 'agent', worktreeDir, 'feature');
    const worktree = new TestRepo(worktreeDir);
    const server = await serve(worktree);
    await request(server, '/api/diff');
    const log = await eventLog(server);

    repo.write({ 'unstaged.ts': 'export const b = 99;\n' });
    await sleep(900);
    assert.equal(changedEvents(log.events), 0);

    worktree.write({ 'committed.ts': 'export const a = 42;\n' });
    await log.next('changed');
    // A commit in the worktree moves its branch in the shared git dir.
    worktree.commitAll('Agent commit');
    await log.next('changed');
    log.close();
  });

  it('can be turned off', async () => {
    const repo = featureRepo();
    const server = await startServer({ repo: await findRepo(repo.dir), uiDir: uiDir(), watch: false });
    servers.push(server);
    const hello = await firstEvent(server);
    hello.close();
    assert.equal((hello.data as { watching: boolean }).watching, false);
  });
});
