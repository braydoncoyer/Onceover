import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { findRepo } from '../src/git/index.ts';
import type { ApiError, BranchesResponse, DiffResponse, MetaResponse, ReviewResponse } from '../src/server/api.ts';
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

describe('review storage', () => {
  it('starts empty, saves to <git-dir>/onceover and survives a restart', async () => {
    const repo = featureRepo();
    const first = await serve(repo);
    assert.deepEqual((await request(first, '/api/review')).json<ReviewResponse>(), {
      branch: 'feature',
      base: 'origin/main',
      viewed: [],
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
    const saved = await putReview(first, { viewed: ['new.ts', 'new.ts'], comments: [comment], note: 'Close.' });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json<ReviewResponse>().viewed, ['new.ts']);
    await first.close();

    const second = await serve(repo);
    const review = (await request(second, '/api/review')).json<ReviewResponse>();
    assert.deepEqual(review.viewed, ['new.ts']);
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
