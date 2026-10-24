import { useCallback, useEffect, useRef, useState } from 'react';
import { IconSparkle, IconWarning } from '../components/Icons';
import { ReviewView } from '../components/ReviewView';
import { SkeletonCard, SkeletonRail } from '../components/SkeletonCard';
import { StatePanel } from '../components/StatePanel';
import { Button } from '../components/ui';
import {
  ApiRequestError,
  getDiff,
  getMeta,
  listen,
  toReviewFile,
  toReviewMeta,
  type MetaResponse,
} from '../lib/api';
import type { ReviewFile, ReviewMeta } from '../lib/types';
import s from './App.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: ReviewMeta; worktree: string; files: ReviewFile[] }
  | { kind: 'error'; error: ApiRequestError | Error };

/** The real review screen: the server's diff in the playground's components. */
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [worktree, setWorktree] = useState<string | null>(null);
  const loadRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    try {
      const [meta, diff] = await Promise.all([getMeta(controller.signal), getDiff(controller.signal)]);
      if (controller.signal.aborted) return;
      setWorktree(meta.worktree);
      setState({
        kind: 'ready',
        meta: toReviewMeta(meta),
        worktree: meta.worktree,
        files: diff.files.map(toReviewFile),
      });
      document.title = `${titleOf(meta)} · Onceover`;
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ kind: 'error', error: error as Error });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => loadRef.current?.abort();
  }, [load]);

  // A new server (a restart, or a fresh run reusing this tab) means fresh data.
  useEffect(() => {
    if (!worktree) return;
    let server: string | null = null;
    return listen(worktree, (event) => {
      if (event.type !== 'hello') return;
      if (server !== null && server !== event.server) void load();
      server = event.server;
    });
  }, [worktree, load]);

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <LoadError error={state.error} onRetry={load} />;

  return (
    <ReviewView
      key={state.worktree}
      meta={state.meta}
      files={state.files}
      empty={
        <StatePanel icon={<IconSparkle />} title={`Nothing to review against ${state.meta.base}`}>
          <code>{state.meta.branch}</code> has no commits, staged, unstaged or new files since it left{' '}
          <code>{state.meta.base}</code>. Changes show up here as soon as they land.
        </StatePanel>
      }
    />
  );
}

function titleOf(meta: MetaResponse): string {
  return `${meta.repo} · ${meta.branch ?? meta.shortHead}`;
}

function Loading() {
  return (
    <div className={s.page} aria-busy="true">
      <div className={s.headerSkeleton} />
      <div className={s.loading}>
        <div className={s.loadingRail}>
          <SkeletonRail />
        </div>
        <div className={s.loadingStack}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const api = error instanceof ApiRequestError ? error : null;

  let title = "Couldn't load the diff";
  let body = <>{error.message}</>;
  if (api?.code === 'base-not-found') {
    title = 'No base branch found';
    body = (
      <>
        Tried {joinCodes(api.tried ?? [])}. Run <code>onceover --base &lt;branch&gt;</code> with the branch this work
        started from.
      </>
    );
  } else if (api?.code === 'no-merge-base') {
    title = 'No shared history';
    body = (
      <>
        This branch and its base have no commit in common. Run <code>onceover --base &lt;branch&gt;</code> with the
        branch this work started from.
      </>
    );
  } else if (api?.code === 'network') {
    title = 'Onceover stopped';
    body = (
      <>
        The server isn&apos;t running. Start <code>onceover</code> again in the repo and this tab picks it back up.
      </>
    );
  }

  return (
    <div className={s.page}>
      <div className={s.center}>
        <StatePanel
          icon={<IconWarning />}
          tone="warning"
          title={title}
          actions={
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          {body}
        </StatePanel>
      </div>
    </div>
  );
}

function joinCodes(items: string[]) {
  return items.map((item, i) => (
    <span key={item}>
      {i > 0 && (i === items.length - 1 ? ' and ' : ', ')}
      <code>{item}</code>
    </span>
  ));
}
