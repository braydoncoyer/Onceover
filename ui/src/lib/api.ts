import { parseDiffFromFile, processFile, type FileDiffMetadata } from '@pierre/diffs';
import type { ChangedFile } from '../../../src/git/index.ts';
import type {
  ApiError,
  BaseRequest,
  BranchesResponse,
  DiffResponse,
  MetaResponse,
  ServerEvent,
} from '../../../src/server/api.ts';
import type { ReviewFile, ReviewMeta } from './types';

export type { BranchesResponse, DiffResponse, MetaResponse } from '../../../src/server/api.ts';

/** Past this many changed lines a file waits behind a Load diff button. */
const LARGE_FILE_LINES = 2000;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError['error']['code'] | 'network';
  readonly tried?: string[];

  constructor(status: number, body: ApiError['error'] | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'network' : 'internal');
    this.tried = body?.tried;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...init.headers } });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, null, "Can't reach the Onceover server. Is it still running?");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, (body as ApiError | null)?.error ?? null, res.statusText);
  return body as T;
}

export const getMeta = (signal?: AbortSignal) => requestJson<MetaResponse>('/api/meta', { signal });
export const getDiff = (signal?: AbortSignal) => requestJson<DiffResponse>('/api/diff', { signal });
export const getBranches = (signal?: AbortSignal) => requestJson<BranchesResponse>('/api/branches', { signal });

/** Switches the base and saves it for next run. Null goes back to the detected base. */
export function putBase(base: string | null): Promise<MetaResponse> {
  const body: BaseRequest = { base };
  return requestJson<MetaResponse>('/api/base', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function toReviewMeta(meta: MetaResponse): ReviewMeta {
  return {
    repo: meta.repo,
    branch: meta.branch ?? meta.shortHead,
    detached: meta.branch === null,
    base: meta.base.ref,
    defaultBase: meta.defaultBase,
    mergeBase: meta.mergeBase.slice(0, 7),
  };
}

const SUBMODULE_MODE = '160000';

/** Turns a file from the git core into what the file card renders. */
export function toReviewFile(file: ChangedFile): ReviewFile {
  const base: ReviewFile = {
    id: file.path,
    path: file.path,
    ...(file.prevPath ? { prevPath: file.prevPath } : {}),
    status: file.generated
      ? 'generated'
      : file.binary
        ? 'binary'
        : file.status === 'type-changed'
          ? 'modified'
          : file.status,
    origin: file.origin,
    uncommitted: file.origins.includes('uncommitted'),
    additions: file.additions,
    deletions: file.deletions,
    comments: 0,
    ...(file.oldMode && file.newMode && file.oldMode !== file.newMode
      ? { mode: { before: file.oldMode, after: file.newMode } }
      : {}),
  };

  if (file.submodule) {
    // A submodule pointer has no contents, only the commits it moved between.
    const commit = (sign: '-' | '+') => {
      const prefix = `${sign}Subproject commit `;
      return file.patch.split('\n').find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? null;
    };
    return {
      ...base,
      status: file.status === 'type-changed' ? 'modified' : base.status,
      additions: 0,
      deletions: 0,
      submodule: {
        before: file.oldMode === SUBMODULE_MODE ? commit('-') : null,
        after: file.newMode === SUBMODULE_MODE ? commit('+') : null,
      },
    };
  }

  if (file.binary) {
    return { ...base, binary: true, size: { before: file.oldSize, after: file.newSize } };
  }

  const diff = buildDiff(file);
  if (!diff) return base;
  return { ...base, diff, large: file.additions + file.deletions > LARGE_FILE_LINES };
}

function buildDiff(file: ChangedFile): FileDiffMetadata | null {
  const oldFile = file.oldContents === null ? undefined : { name: file.prevPath ?? file.path, contents: file.oldContents };
  const newFile = file.newContents === null ? undefined : { name: file.path, contents: file.newContents };
  try {
    // A type change comes as two patches (a deletion, then a creation), so
    // diff the two sides directly instead.
    if (file.status === 'type-changed' && oldFile && newFile) {
      return parseDiffFromFile(oldFile, newFile, { context: 3 });
    }
    // Git's hunks, with both whole files so highlighting sees full context
    // and folded lines can be expanded.
    return processFile(file.patch, { isGitDiff: true, oldFile, newFile }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Listens to the server's event stream. Calls `onServer` with the server's id
 * on every (re)connection, so the page can reload after a restart. Keeps
 * trying if the browser gives up on the stream.
 */
export function listen(worktree: string, onEvent: (event: ServerEvent) => void): () => void {
  let source: EventSource | null = null;
  let retry: number | undefined;
  let stopped = false;

  const connect = () => {
    source = new EventSource(`/api/events?worktree=${encodeURIComponent(worktree)}`);
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data as string) as ServerEvent);
      } catch {
        // Ignore anything that isn't an event we know.
      }
    };
    source.onerror = () => {
      // The browser retries on its own unless it closed the stream for good.
      if (source?.readyState !== EventSource.CLOSED || stopped) return;
      source = null;
      retry = window.setTimeout(connect, 2000);
    };
  };

  connect();
  return () => {
    stopped = true;
    window.clearTimeout(retry);
    source?.close();
  };
}
