import type {
  ApiError,
  DiffResponse,
  LastReviewResponse,
  MetaResponse,
  ReviewResponse,
  ReviewState,
  ServerEvent,
} from '../../../src/server/api.ts';
import type { DemoData, DemoSnapshot } from './types';

/*
 * Stands in for the Onceover server, so the real app runs as a static page.
 * Answers `/api/*` from the demo data the build made with the real git core,
 * keeps the picked base, viewed marks and comments in localStorage, and plays
 * the scripted agent edits as live `changed` events.
 */

const STORAGE_KEY = 'onceover-demo:v1';
/** About what a local server takes, so loading states flash the way they do for real. */
const LATENCY_MS = 140;
const LAST_REVIEW_PATH = '~/code/rideshare-web/.git/onceover/last-review.md';

interface Saved {
  /** The base picked in the page, or null for the detected one. */
  base: string | null;
  /** How many scripted edits have played. */
  step: number;
  /** Reviews by branch and base, as the server keys them. */
  reviews: Record<string, ReviewState>;
}

const emptyReview = (): ReviewState => ({ viewed: [], viewedVersions: {}, comments: [], note: '' });

export interface DemoServer {
  /** Edits played so far, and how many there are in all. */
  step(): number;
  steps(): number;
  /** What the next edit does, or null once they've all played. */
  nextLabel(): string | null;
  /** Plays the next scripted agent edit, as if the watcher saw it. */
  playNextEdit(): void;
  /** Puts the demo back as a first visit sees it. */
  reset(): void;
  /** Calls back whenever the step changes. */
  subscribe(listener: () => void): () => void;
}

export async function installDemoServer(dataUrl: string): Promise<DemoServer> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Couldn't load the demo data (${res.status}).`);
  const data = (await res.json()) as DemoData;

  const saved = load(data);
  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private windows can refuse storage. The demo still works for this visit.
    }
  };

  const baseRef = () => saved.base ?? data.defaultBase;
  const current = (): DemoSnapshot => data.snapshots[baseRef()][saved.step];
  const reviewKey = (snapshot: DemoSnapshot) => `${snapshot.meta.branch}\u0000${snapshot.meta.base.ref}`;

  const meta = (): MetaResponse => {
    const snapshot = current();
    return { ...snapshot.meta, base: { ...snapshot.meta.base, source: saved.base ? 'picked' : 'origin-head' } };
  };

  const review = (): ReviewResponse => {
    const snapshot = current();
    const state = saved.reviews[reviewKey(snapshot)] ?? emptyReview();
    return { branch: snapshot.meta.branch ?? snapshot.meta.shortHead, base: snapshot.meta.base.ref, ...state };
  };

  // ── API ──
  type Handler = (body: unknown) => [number, unknown];
  const routes: Record<string, Handler> = {
    'GET /api/meta': () => [200, meta()],
    'GET /api/diff': () => {
      const snapshot = current();
      const diff: DiffResponse = { head: snapshot.head, mergeBase: snapshot.mergeBase, files: snapshot.files.map((key) => data.files[key]) };
      return [200, diff];
    },
    'GET /api/branches': () => [200, data.branches],
    'GET /api/review': () => [200, review()],
    'PUT /api/review': (body) => {
      saved.reviews[reviewKey(current())] = { ...emptyReview(), ...(body as Partial<ReviewState>) };
      persist();
      return [200, review()];
    },
    'PUT /api/review/last': () => {
      const saved: LastReviewResponse = { path: LAST_REVIEW_PATH, shown: '.git/onceover/last-review.md' };
      return [200, saved];
    },
    'PUT /api/base': (body) => {
      const base = (body as { base?: unknown } | null)?.base;
      if (base !== null && (typeof base !== 'string' || !data.snapshots[base])) {
        const error: ApiError = {
          error: { code: 'base-not-found', message: `Couldn't find ${String(base)}.`, tried: [String(base)] },
        };
        return [404, error];
      }
      saved.base = base === data.defaultBase ? null : base;
      persist();
      return [200, meta()];
    },
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    await delay(LATENCY_MS, init?.signal);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return json(404, { error: { code: 'not-found', message: `No route for ${method} ${url.pathname}.` } });
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const [status, payload] = handler(body);
    return json(status, payload);
  };

  // ── Live events ──
  const streams = new Set<FakeEventSource>();
  class FakeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readonly url: string;

    constructor(url: string) {
      this.url = url;
      streams.add(this);
      window.setTimeout(() => {
        if (this.readyState === 2) return;
        this.readyState = 1;
        this.onopen?.(new Event('open'));
        this.send({ type: 'hello', server: 'demo', watching: true });
      }, LATENCY_MS);
    }

    send(event: ServerEvent) {
      if (this.readyState === 1) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
    }

    close() {
      this.readyState = 2;
      streams.delete(this);
    }
  }
  (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;

  const listeners = new Set<() => void>();
  return {
    step: () => saved.step,
    steps: () => data.steps.length - 1,
    nextLabel: () => data.steps[saved.step + 1]?.label ?? null,
    playNextEdit() {
      if (saved.step >= data.steps.length - 1) return;
      saved.step++;
      persist();
      // A debounced burst of edits, then one event, as the watcher sends it.
      window.setTimeout(() => {
        for (const stream of streams) stream.send({ type: 'changed', version: `demo-${saved.step}` });
      }, 250);
      for (const listener of listeners) listener();
    },
    reset() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing saved to clear.
      }
      location.reload();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What's saved from an earlier visit, or a first visit's state with the seeded review. */
function load(data: DemoData): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
    if (
      saved &&
      typeof saved.step === 'number' &&
      saved.step < data.steps.length &&
      (saved.base === null || data.snapshots[saved.base]) &&
      saved.reviews
    ) {
      return saved;
    }
  } catch {
    // Unreadable or blocked: start fresh.
  }
  const start = data.snapshots[data.defaultBase][0].meta;
  return { base: null, step: 0, reviews: { [`${start.branch}\u0000${start.base.ref}`]: data.seed } };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}
