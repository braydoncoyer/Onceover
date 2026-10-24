import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import {
  BaseNotFoundError,
  NoMergeBaseError,
  detectBase,
  findMergeBase,
  findRepo,
  getChangedFiles,
  listBranches,
  type RepoInfo,
} from '../git/index.ts';
import type { ApiError, BranchesResponse, DiffResponse, MetaResponse, ReviewResponse, ServerEvent } from './api.ts';
import { InvalidReviewError, ReviewStore } from './review-store.ts';
import { serveStatic } from './static.ts';

const HOST = '127.0.0.1';
const MAX_BODY = 5 * 1024 * 1024;
const KEEPALIVE_MS = 15_000;
/** How soon an open page tries again after losing the server, in ms. */
const RECONNECT_MS = 1000;

const gzipAsync = promisify(gzip);

export interface ServerOptions {
  repo: RepoInfo;
  /** The `--base` flag, used exactly as given. Detected on every request when left out. */
  base?: string;
  /** Folder holding the built UI. */
  uiDir: string;
  /** Exact port to use. Fails with `PortInUseError` if it's taken. */
  port?: number;
  /** Port to try first when `port` isn't set. The next few are tried after it, then any free port. */
  preferredPort?: number;
}

export interface OnceoverServer {
  url: string;
  port: number;
  /**
   * Resolves true as soon as a page showing this worktree connects to the
   * event stream, or false after `ms`. A tab left open from an earlier run
   * reconnects on its own, so the CLI can skip opening a new one.
   */
  waitForPage(ms: number): Promise<boolean>;
  /** Pushes an event to every open page. */
  broadcast(event: ServerEvent): void;
  close(): Promise<void>;
}

export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${port} is already in use.`);
    this.name = 'PortInUseError';
    this.port = port;
  }
}

/**
 * The local server: the built UI plus a small JSON API, bound to 127.0.0.1
 * only. Every git call is read-only; the one thing it writes is the review
 * file under `<git-dir>/onceover/`.
 */
export async function startServer(options: ServerOptions): Promise<OnceoverServer> {
  const root = options.repo.root;
  const store = new ReviewStore(options.repo.gitDir);
  const id = randomUUID();
  const pages = new EventEmitter();
  const streams = new Set<ServerResponse>();
  const staticFiles = serveStatic(options.uiDir);
  let port = 0;

  /** HEAD and the branch can move while the server runs, so they're read fresh. */
  const current = async () => {
    const repo = await findRepo(root);
    const base = await detectBase(repo, options.base);
    const mergeBase = await findMergeBase(repo, base);
    return { repo, base, mergeBase };
  };

  // Requests that land while a diff is being built share it.
  let diffInFlight: Promise<DiffResponse> | null = null;
  const loadDiff = () => {
    diffInFlight ??= (async () => {
      const { repo, mergeBase } = await current();
      return { head: repo.head, mergeBase, files: await getChangedFiles(repo, mergeBase) };
    })().finally(() => {
      diffInFlight = null;
    });
    return diffInFlight;
  };

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>> = {
    'GET /api/meta': async (req, res) => {
      const { repo, base, mergeBase } = await current();
      const meta: MetaResponse = {
        repo: repo.name,
        branch: repo.branch,
        shortHead: repo.shortHead,
        head: repo.head,
        base,
        mergeBase,
        worktree: repo.root,
        isLinkedWorktree: repo.isLinkedWorktree,
      };
      await sendJson(req, res, 200, meta);
    },

    'GET /api/diff': async (req, res) => {
      await sendJson(req, res, 200, await loadDiff());
    },

    'GET /api/branches': async (req, res) => {
      const branches: BranchesResponse = await listBranches(await findRepo(root));
      await sendJson(req, res, 200, branches);
    },

    'GET /api/review': async (req, res) => {
      const key = await reviewKeyParts();
      const review: ReviewResponse = { ...key, ...(await store.get(key.branch, key.base)) };
      await sendJson(req, res, 200, review);
    },

    'PUT /api/review': async (req, res) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
        return sendError(req, res, 415, 'bad-request', 'Send the review as application/json.');
      }
      const body = await readJson(req);
      const key = await reviewKeyParts();
      const review: ReviewResponse = { ...key, ...(await store.put(key.branch, key.base, body)) };
      await sendJson(req, res, 200, review);
    },

    'GET /api/events': async (req, res, url) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write(`retry: ${RECONNECT_MS}\n\n`);
      writeEvent(res, { type: 'hello', server: id });
      streams.add(res);
      const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
      req.on('close', () => {
        clearInterval(keepalive);
        streams.delete(res);
      });
      // A page that names another worktree (a tab from an unrelated run on this
      // port) still gets events, but doesn't count as this run's tab.
      const worktree = url.searchParams.get('worktree');
      if (worktree === null || worktree === root) pages.emit('page');
    },
  };

  /** Reviews are keyed by branch (or HEAD's SHA when detached) and base. */
  const reviewKeyParts = async () => {
    const repo = await findRepo(root);
    const base = await detectBase(repo, options.base);
    return { branch: repo.branch ?? repo.head, base: base.ref };
  };

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHost(req.headers.host, port)) {
        return await sendError(req, res, 403, 'forbidden', 'Onceover only answers on 127.0.0.1 and localhost.');
      }
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedOrigin(origin, port)) {
        return await sendError(req, res, 403, 'forbidden', 'Cross-origin requests are not allowed.');
      }

      const url = new URL(req.url ?? '/', `http://${HOST}`);
      const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
      const route = routes[`${method} ${url.pathname}`];
      if (route) return await route(req, res, url);

      if (url.pathname.startsWith('/api/')) {
        const known = Object.keys(routes).some((key) => key.endsWith(` ${url.pathname}`));
        return known
          ? await sendError(req, res, 405, 'bad-request', `${req.method} isn't supported on ${url.pathname}.`)
          : await sendError(req, res, 404, 'not-found', `No API route at ${url.pathname}.`);
      }
      if (method !== 'GET') return await sendError(req, res, 405, 'bad-request', `${req.method} isn't supported.`);
      await staticFiles(req, res, url.pathname);
    } catch (error) {
      await sendFailure(req, res, error);
    }
  });
  // Server-Sent Events stay open; only idle keep-alive sockets time out.
  server.requestTimeout = 0;

  port = await listen(server, options);
  const url = `http://${HOST}:${port}/`;

  return {
    url,
    port,
    waitForPage(ms) {
      return new Promise((resolve) => {
        const done = (found: boolean) => {
          clearTimeout(timer);
          pages.off('page', onPage);
          resolve(found);
        };
        const onPage = () => done(true);
        const timer = setTimeout(() => done(false), ms);
        pages.on('page', onPage);
      });
    },
    broadcast(event) {
      for (const res of streams) writeEvent(res, event);
    },
    close() {
      for (const res of streams) res.end();
      streams.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function listen(server: Server, options: ServerOptions): Promise<number> {
  const attempt = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, HOST);
    });

  if (options.port !== undefined) {
    try {
      return await attempt(options.port);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new PortInUseError(options.port);
      throw error;
    }
  }

  const candidates = options.preferredPort ? range(options.preferredPort, 10) : [];
  for (const port of [...candidates, 0]) {
    try {
      return await attempt(port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (port === 0 || (code !== 'EADDRINUSE' && code !== 'EACCES')) throw error;
    }
  }
  throw new Error('unreachable');
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i).filter((port) => port <= 65535);
}

/** Guards against DNS rebinding: a page on another site can't reach us through a hostname it controls. */
function allowedHost(host: string | undefined, port: number): boolean {
  return host === `${HOST}:${port}` || host === `localhost:${port}`;
}

function allowedOrigin(origin: string, port: number): boolean {
  return origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`;
}

function writeEvent(res: ServerResponse, event: ServerEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new InvalidReviewError('The review is too large to save.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InvalidReviewError("The request body isn't valid JSON.");
  }
}

async function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): Promise<void> {
  let payload: Buffer = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string | number> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'accept-encoding',
  };
  // Diffs with full file contents get big; compress them for the page.
  if (payload.length > 8 * 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    payload = await gzipAsync(payload);
    headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  code: ApiError['error']['code'],
  message: string,
  extra: Partial<ApiError['error']> = {},
): Promise<void> {
  const body: ApiError = { error: { code, message, ...extra } };
  return sendJson(req, res, status, body);
}

async function sendFailure(req: IncomingMessage, res: ServerResponse, error: unknown): Promise<void> {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof BaseNotFoundError) {
    return sendError(req, res, 409, 'base-not-found', error.message, { tried: error.tried });
  }
  if (error instanceof NoMergeBaseError) return sendError(req, res, 409, 'no-merge-base', error.message);
  if (error instanceof InvalidReviewError) return sendError(req, res, 400, 'bad-request', error.message);
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  return sendError(req, res, 500, 'internal', message);
}
