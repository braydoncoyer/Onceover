import { useCallback, useEffect, useRef, useState } from 'react';
import { BasePicker } from '../components/BasePicker';
import { IconCaretDown, IconSparkle, IconWarning } from '../components/Icons';
import { ReviewView } from '../components/ReviewView';
import { SkeletonCard, SkeletonRail } from '../components/SkeletonCard';
import { StatePanel } from '../components/StatePanel';
import { Button } from '../components/ui';
import {
  ApiRequestError,
  getDiff,
  getMeta,
  listen,
  putBase,
  toReviewFile,
  toReviewMeta,
  type MetaResponse,
} from '../lib/api';
import type { ReviewFile, ReviewMeta } from '../lib/types';
import s from './App.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: ReviewMeta; worktree: string; files: ReviewFile[]; switching: boolean }
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
        files: orderFiles(diff.files.map(toReviewFile)),
        switching: false,
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

  /** Saves the base, then shows skeletons in the stack while the new diff loads. Rejects if the server refuses it. */
  const pickBase = useCallback(
    async (base: string | null) => {
      const meta = await putBase(base);
      setState((prev) =>
        prev.kind === 'ready' ? { ...prev, meta: toReviewMeta(meta), switching: true } : { kind: 'loading' },
      );
      await load();
    },
    [load],
  );

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <LoadError error={state.error} onRetry={load} onPickBase={pickBase} />;

  return (
    <div className={s.page}>
      <ReviewView
        key={`${state.worktree}\u0000${state.meta.base}`}
        meta={state.meta}
        files={state.files}
        loading={state.switching}
        onPickBase={pickBase}
        railHint={false}
        empty={
          <StatePanel icon={<IconSparkle />} title={`Nothing to review against ${state.meta.base}`}>
            <code>{state.meta.branch}</code> has no commits, staged, unstaged or new files since it left{' '}
            <code>{state.meta.base}</code>. Changes show up here as soon as they land.
          </StatePanel>
        }
      />
    </div>
  );
}

/**
 * Keeps git's path order, but moves generated files (lockfiles and the like)
 * to the end, since they're folded and left out of review.
 */
function orderFiles(files: ReviewFile[]): ReviewFile[] {
  return [...files.filter((file) => file.status !== 'generated'), ...files.filter((file) => file.status === 'generated')];
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

function LoadError({
  error,
  onRetry,
  onPickBase,
}: {
  error: Error;
  onRetry: () => void;
  onPickBase: (base: string | null) => Promise<void>;
}) {
  const api = error instanceof ApiRequestError ? error : null;
  const needsBase = api?.code === 'base-not-found' || api?.code === 'no-merge-base';
  // A missing base opens the picker straight away.
  const [pickerOpen, setPickerOpen] = useState(needsBase);

  let title = "Couldn't load the diff";
  let body = <>{error.message}</>;
  if (api?.code === 'base-not-found') {
    title = 'No base branch found';
    body = (
      <>
        Tried {joinCodes(api.tried ?? [])}. Pick the branch this work started from, or run{' '}
        <code>onceover --base &lt;branch&gt;</code>.
      </>
    );
  } else if (api?.code === 'no-merge-base') {
    title = 'No shared history';
    body = (
      <>
        This branch and its base have no commit in common. Pick the branch this work started from, or run{' '}
        <code>onceover --base &lt;branch&gt;</code>.
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
            needsBase ? (
              <BasePicker
                base={null}
                defaultBase={null}
                branch={null}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPick={onPickBase}
                triggerClassName={s.pickerButton}
                align="center"
              >
                Choose base branch
                <IconCaretDown size="var(--size-icon-xs)" />
              </BasePicker>
            ) : (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )
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
