import { processFile } from '@pierre/diffs';
import type { ChangedFile } from '../../../src/git/index.ts';
import type { ApiError, DiffResponse, MetaResponse, ServerEvent } from '../../../src/server/api.ts';
import type { ReviewFile, ReviewMeta } from './types';

export type { DiffResponse, MetaResponse } from '../../../src/server/api.ts';

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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, null, "Can't reach the Onceover server. Is it still running?");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, (body as ApiError | null)?.error ?? null, res.statusText);
  return body as T;
}

export const getMeta = (signal?: AbortSignal) => getJson<MetaResponse>('/api/meta', signal);
export const getDiff = (signal?: AbortSignal) => getJson<DiffResponse>('/api/diff', signal);

export function toReviewMeta(meta: MetaResponse): ReviewMeta {
  return {
    repo: meta.repo,
    branch: meta.branch ?? meta.shortHead,
    base: meta.base.ref,
    mergeBase: meta.mergeBase.slice(0, 7),
  };
}

/** Turns a file from the git core into what the file card renders. */
export function toReviewFile(file: ChangedFile): ReviewFile {
  const base: ReviewFile = {
    id: file.path,
    path: file.path,
    ...(file.prevPath ? { prevPath: file.prevPath } : {}),
    status: file.binary
      ? 'binary'
      : file.generated
        ? 'generated'
        : file.status === 'type-changed'
          ? 'modified'
          : file.status,
    origin: file.origin,
    additions: file.additions,
    deletions: file.deletions,
    comments: 0,
  };

  if (file.binary) return { ...base, size: { before: file.oldSize ?? 0, after: file.newSize ?? 0 } };
  if (file.submodule) return base;

  try {
    // Git's hunks, with both whole files so highlighting sees full context.
    const diff = processFile(file.patch, {
      isGitDiff: true,
      oldFile: file.oldContents === null ? undefined : { name: file.prevPath ?? file.path, contents: file.oldContents },
      newFile: file.newContents === null ? undefined : { name: file.path, contents: file.newContents },
    });
    return {
      ...base,
      diff,
      large: file.additions + file.deletions > LARGE_FILE_LINES,
    };
  } catch {
    return base;
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
