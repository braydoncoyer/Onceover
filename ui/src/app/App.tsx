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
  getReview,
  listen,
  putBase,
  putLastReview,
  putReview,
  toReviewFile,
  toReviewMeta,
  type MetaResponse,
  type ReviewState,
} from '../lib/api';
import type { ReviewComment } from '../lib/comments';
import { reuseUnchanged, type LiveStatus } from '../lib/live';
import type { ReviewFile, ReviewMeta } from '../lib/types';
import s from './App.module.css';

type State =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      meta: ReviewMeta;
      worktree: string;
      files: ReviewFile[];
      /** Files still viewed: marked, and unchanged since. */
      viewed: string[];
      comments: ReviewComment[];
      note: string;
      switching: boolean;
      /** Branch and base the review is for. A change in either starts a new review. */
      key: string;
    }
  | { kind: 'error'; error: ApiRequestError | Error };

/** Longest the page waits on a dropped stream before it says it's offline, in ms. */
const OFFLINE_GRACE_MS = 1500;

/** The real review screen: the server's diff in the playground's components. */
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [worktree, setWorktree] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStatus>('live');
  /** Bumped each time a refresh lands, so the live dot can pulse. */
  const [synced, setSynced] = useState(0);
  const loadRef = useRef<AbortController | null>(null);
  /** The saved review, so saving viewed marks keeps its comments and note. */
  const reviewRef = useRef<ReviewState | null>(null);
  const saveRef = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    try {
      const [meta, diff, review] = await Promise.all([
        getMeta(controller.signal),
        getDiff(controller.signal),
        // A review that can't be read starts fresh rather than blocking the diff.
        getReview(controller.signal).catch((error: Error) => {
          if (error.name === 'AbortError') throw error;
          return null;
        }),
      ]);
      if (controller.signal.aborted) return;
      const files = orderFiles(diff.files.map(toReviewFile));
      reviewRef.current = review && { viewed: review.viewed, viewedVersions: review.viewedVersions, comments: review.comments, note: review.note };
      setWorktree(meta.worktree);
      setState({
        kind: 'ready',
        meta: toReviewMeta(meta),
        worktree: meta.worktree,
        files,
        viewed: stillViewed(files, review),
        comments: review?.comments ?? [],
        note: review?.note ?? '',
        switching: false,
        key: reviewKey(meta),
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

  /**
   * Brings the open review up to date without starting over: new files slot
   * in, changed ones are swapped, and the stack keeps its place. A new branch
   * or base is a different review, so that loads from scratch. Refreshes run
   * one at a time; one asked for meanwhile runs right after.
   */
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return refreshing.current;
    }
    const run = async () => {
      do {
        refreshAgain.current = false;
        const current = stateRef.current;
        if (current.kind !== 'ready' || current.switching) {
          await load();
          continue;
        }
        try {
          const [meta, diff] = await Promise.all([getMeta(), getDiff()]);
          if (reviewKey(meta) !== current.key) {
            await load();
            continue;
          }
          setState((prev) => {
            if (prev.kind !== 'ready') return prev;
            const files = reuseUnchanged(prev.files, orderFiles(diff.files.map(toReviewFile)));
            return { ...prev, meta: toReviewMeta(meta), files };
          });
          document.title = `${titleOf(meta)} · Onceover`;
          setSynced((count) => count + 1);
        } catch (error) {
          // Lost the server: the stream notices too, and refreshes when it's back.
          if (error instanceof ApiRequestError && error.code === 'network') return;
          await load();
        }
      } while (refreshAgain.current);
    };
    refreshing.current = run().finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  }, [load]);

  // Edits land as `changed` events. A new server (a restart, or a fresh run
  // reusing this tab) may have missed some, so it refreshes too.
  useEffect(() => {
    let server: string | null = null;
    let offline: number | undefined;
    const stop = listen(
      worktree,
      (event) => {
        if (event.type === 'hello') {
          setLive(event.watching ? 'live' : 'paused');
          // An error page (say, the server was down at first load) tries again too.
          if ((server !== null && server !== event.server) || stateRef.current.kind === 'error') void refresh();
          server = event.server;
        } else if (event.type === 'changed') {
          void refresh();
        } else if (event.type === 'watching') {
          setLive('paused');
        }
      },
      (open) => {
        if (open) {
          window.clearTimeout(offline);
          offline = undefined;
          return;
        }
        // A blip while the browser reconnects isn't worth a warning. Failed
        // retries keep the first timer running rather than starting over.
        offline ??= window.setTimeout(() => setLive('offline'), OFFLINE_GRACE_MS);
      },
    );
    return () => {
      window.clearTimeout(offline);
      stop();
    };
  }, [worktree, refresh]);

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

  /** Saves part of the review over what's saved. Saves run one after another. */
  const save = useCallback((patch: Partial<ReviewState>) => {
    const review: ReviewState = {
      ...(reviewRef.current ?? { viewed: [], viewedVersions: {}, comments: [], note: '' }),
      ...patch,
    };
    reviewRef.current = review;
    // A failed save shouldn't interrupt the review; the next change tries again.
    saveRef.current = saveRef.current.then(() => putReview(review)).catch(() => {});
  }, []);

  /** Saves viewed marks with each file's current version. */
  const saveViewed = useCallback(
    (viewed: string[]) => {
      if (state.kind !== 'ready') return;
      const versions = new Map(state.files.map((file) => [file.id, file.version]));
      const viewedVersions: Record<string, string> = {};
      for (const id of viewed) {
        const version = versions.get(id);
        if (version) viewedVersions[id] = version;
      }
      save({ viewed, viewedVersions });
    },
    [state, save],
  );

  /** Saves comments and the review note with the viewed marks. */
  const saveComments = useCallback((comments: ReviewComment[], note: string) => save({ comments, note }), [save]);

  /** Writes the copied review to `last-review.md`, resolving with the path to show. */
  const saveLastReview = useCallback(
    (markdown: string) =>
      putLastReview(markdown).then(
        (saved) => saved.shown,
        () => null,
      ),
    [],
  );

  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <LoadError error={state.error} onRetry={load} onPickBase={pickBase} />;

  return (
    <div className={s.page}>
      <ReviewView
        key={`${state.worktree}\u0000${state.key}`}
        meta={state.meta}
        files={state.files}
        initialViewed={state.viewed}
        loading={state.switching}
        live={live}
        synced={synced}
        onPickBase={pickBase}
        onViewedChange={saveViewed}
        initialComments={state.comments}
        initialNote={state.note}
        onCommentsChange={saveComments}
        onSaveReview={saveLastReview}
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

/** Viewed marks that still hold: a file that changed since it was marked needs another look. */
function stillViewed(files: ReviewFile[], review: ReviewState | null): string[] {
  if (!review) return [];
  const byId = new Map(files.map((file) => [file.id, file]));
  return review.viewed.filter((id) => {
    const file = byId.get(id);
    if (!file || file.status === 'generated') return false;
    const saved = review.viewedVersions[id];
    return !saved || saved === file.version;
  });
}

/**
 * Keeps git's path order, but moves generated files (lockfiles and the like)
 * to the end, since they're folded and left out of review.
 */
function orderFiles(files: ReviewFile[]): ReviewFile[] {
  return [...files.filter((file) => file.status !== 'generated'), ...files.filter((file) => file.status === 'generated')];
}

function reviewKey(meta: MetaResponse): string {
  return `${meta.branch ?? meta.head}\u0000${meta.base.ref}`;
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
