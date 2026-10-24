import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION = 1;

/** What Onceover remembers about a worktree between runs. */
export interface Settings {
  /** The base picked in the page, used when `--base` isn't given. */
  base: string | null;
}

/**
 * Settings saved to `<git-dir>/onceover/settings.json`, next to the review.
 * Each linked worktree has its own git dir, so each keeps its own base.
 */
export class SettingsStore {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(gitDir: string) {
    this.file = join(gitDir, 'onceover', 'settings.json');
  }

  async get(): Promise<Settings> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Settings>;
      return { base: typeof parsed.base === 'string' && parsed.base ? parsed.base : null };
    } catch {
      // Missing or unreadable settings just mean the defaults.
      return { base: null };
    }
  }

  /** Merges `changes` into what's saved. Writes one at a time, through a temp file. */
  update(changes: Partial<Settings>): Promise<Settings> {
    const run = this.queue.then(async () => {
      const settings = { ...(await this.get()), ...changes };
      const dir = join(this.file, '..');
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.settings-${randomUUID()}.json`);
      try {
        await writeFile(temp, `${JSON.stringify({ version: VERSION, ...settings }, null, 2)}\n`);
        await rename(temp, this.file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return settings;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
