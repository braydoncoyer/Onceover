import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewComment, ReviewState } from './api.ts';

const VERSION = 1;

interface StoreFile {
  version: number;
  /** Keyed by `reviewKey(branch, base)`. */
  reviews: Record<string, ReviewState & { branch: string; base: string; updatedAt: string }>;
}

export class InvalidReviewError extends Error {}

export function emptyReview(): ReviewState {
  return { viewed: [], comments: [], note: '' };
}

/**
 * Viewed state and comments, saved to `<git-dir>/onceover/review.json` so they
 * never show up in the repo and survive a refresh or a restart. Only ever
 * writes inside its own folder.
 */
export class ReviewStore {
  readonly dir: string;
  readonly file: string;
  /** Writes run one at a time so two quick saves can't interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(gitDir: string) {
    this.dir = join(gitDir, 'onceover');
    this.file = join(this.dir, 'review.json');
  }

  async get(branch: string, base: string): Promise<ReviewState> {
    const store = await this.read();
    const saved = store.reviews[reviewKey(branch, base)];
    if (!saved) return emptyReview();
    return { viewed: saved.viewed, comments: saved.comments, note: saved.note };
  }

  /** Replaces the review for `branch` against `base`. Throws `InvalidReviewError` on a malformed body. */
  put(branch: string, base: string, input: unknown): Promise<ReviewState> {
    const review = parseReview(input);
    const run = this.queue.then(async () => {
      const store = await this.read();
      store.reviews[reviewKey(branch, base)] = { branch, base, ...review, updatedAt: new Date().toISOString() };
      await this.write(store);
      return review;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async read(): Promise<StoreFile> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: VERSION, reviews: {} };
      throw error;
    }
    try {
      const parsed = JSON.parse(text) as StoreFile;
      if (parsed && typeof parsed === 'object' && parsed.reviews && typeof parsed.reviews === 'object') return parsed;
    } catch {
      // Fall through: a broken file is set aside below rather than lost.
    }
    await rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => {});
    return { version: VERSION, reviews: {} };
  }

  /** Writes to a temp file and renames it into place, so a crash never leaves half a file. */
  private async write(store: StoreFile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temp = join(this.dir, `.review-${randomUUID()}.json`);
    try {
      await writeFile(temp, `${JSON.stringify({ ...store, version: VERSION }, null, 2)}\n`);
      await rename(temp, this.file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}

export function reviewKey(branch: string, base: string): string {
  return `${branch}\u0000${base}`;
}

function parseReview(input: unknown): ReviewState {
  if (!isObject(input)) throw new InvalidReviewError('Expected a JSON object.');
  const viewed = input.viewed ?? [];
  const comments = input.comments ?? [];
  const note = input.note ?? '';
  if (!Array.isArray(viewed) || !viewed.every((path) => typeof path === 'string')) {
    throw new InvalidReviewError('`viewed` must be a list of paths.');
  }
  if (typeof note !== 'string') throw new InvalidReviewError('`note` must be text.');
  if (!Array.isArray(comments)) throw new InvalidReviewError('`comments` must be a list.');
  return { viewed: [...new Set(viewed)], comments: comments.map(parseComment), note };
}

function parseComment(input: unknown, index: number): ReviewComment {
  const fail = (what: string): never => {
    throw new InvalidReviewError(`Comment ${index + 1}: ${what}.`);
  };
  if (!isObject(input)) return fail('expected an object');
  const lines = (value: unknown, name: string) =>
    value === undefined
      ? []
      : Array.isArray(value) && value.every((line) => typeof line === 'string')
        ? (value as string[])
        : fail(`\`${name}\` must be a list of lines`);
  const lineNumber = (value: unknown, name: string) =>
    value === undefined || value === null
      ? null
      : Number.isInteger(value) && (value as number) > 0
        ? (value as number)
        : fail(`\`${name}\` must be a line number`);

  const { id, path, side, body } = input;
  if (typeof id !== 'string' || !id) fail('`id` is required');
  if (path !== undefined && path !== null && typeof path !== 'string') fail('`path` must be text');
  if (side !== undefined && side !== null && side !== 'new' && side !== 'old') fail('`side` must be new or old');
  if (typeof body !== 'string') fail('`body` must be text');
  const start = lineNumber(input.start, 'start');
  const end = lineNumber(input.end, 'end');
  if (start !== null && end !== null && end < start) fail('`end` comes before `start`');
  const now = new Date().toISOString();

  return {
    id: id as string,
    path: (path as string | undefined) ?? null,
    side: (side as ReviewComment['side'] | undefined) ?? null,
    start,
    end: end ?? start,
    text: lines(input.text, 'text'),
    before: lines(input.before, 'before'),
    after: lines(input.after, 'after'),
    body: body as string,
    outdated: input.outdated === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
