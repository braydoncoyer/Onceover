// Screenshots the built design playground (dist/ui/playground.html) and the
// real app, served by the Onceover server over a throwaway repo made from the
// playground's fixture files. Uses Playwright.
// Usage: npm run build && npm run screenshot [-- outDir]
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { findRepo } from '../src/git/index.ts';
import { startServer } from '../src/server/server.ts';

const root = resolve('dist/ui');
const outDir = resolve(process.argv[2] ?? 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(root, 'playground.html'))) {
  console.error('dist/ui is missing. Run `npm run build` first.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/`;

// CHROMIUM_PATH and CHROMIUM_ARGS (JSON) point at another Chromium build, for
// machines where `npx playwright install` can't download one.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : undefined,
});
const logs = [];

// SHOTS=<regex> takes only the matching screenshots, for quick rounds.
const only = process.env.SHOTS ? new RegExp(process.env.SHOTS) : null;

async function shoot(name, query, { width = 1440, height = 900, prepare, clip, route, waitUntil = 'networkidle', then = [], expectOffline = false } = {}) {
  if (only && !only.test(name)) return;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  page.on('console', (msg) => {
    // A page whose server was stopped on purpose keeps trying to reconnect.
    if (expectOffline && /ERR_CONNECTION_REFUSED/.test(msg.text())) return;
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`[${name}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`[${name}] pageerror: ${error.message}`));
  if (route) await route(page);
  await page.goto(query.startsWith('http') ? query : `${base}playground.html?${query}`, { waitUntil });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  if (prepare) await prepare(page);
  const target = clip ? await clip(page) : undefined;
  await page.screenshot({ path: join(outDir, `${name}.png`), clip: target });
  // More shots of the same page, for states that only exist in that tab.
  for (const next of then) {
    await next.prepare(page);
    await page.screenshot({ path: join(outDir, `${next.name}.png`) });
    console.log(`✓ ${next.name}`);
  }
  await page.close();
  console.log(`✓ ${name}`);
}

// Box of a card's code area, for detail crops that line up with the mockups.
const cardClip = (id, { top = 0, height = 520, width = 1000 } = {}) => async (page) => {
  const box = await page.locator(`#file-${id}`).boundingBox();
  return { x: box.x, y: box.y + top, width: Math.min(width, box.width), height };
};

await shoot('01-review', 'chrome=0');
await shoot('02-review-scrolled', 'chrome=0&file=use-ride-history', {
  prepare: async (page) => {
    await page.locator('[data-scroll-root]').evaluate((node) => node.scrollBy(0, 360));
    await page.waitForTimeout(400);
  },
});
await shoot('03-review-viewed', 'chrome=0&viewed=ride-history-page,status-labels,dimmed-rows&file=ride-history-page');
await shoot('04-review-split', 'chrome=0&diff=split&rail=collapsed');
await shoot('05-states', 'view=states&chrome=0', { height: 1700 });
await shoot('06-tokens', 'view=tokens&chrome=0', { height: 1500 });
await shoot('07-interaction', 'chrome=0', {
  prepare: async (page) => {
    await page.getByRole('button', { name: /section-list/ }).hover();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
  },
});
// Live status in the header, and two files changed since they were seen.
await shoot('08-live', 'chrome=0&live=live&updated=use-ride-history,status-labels&file=status-labels', {
  clip: async () => ({ x: 0, y: 0, width: 1440, height: 520 }),
});
// Header, file header and rail rows up close, to judge icon weight.
await shoot('detail-icons', 'chrome=0&viewed=status-labels', {
  clip: async () => ({ x: 0, y: 0, width: 720, height: 300 }),
});
await shoot('detail-linear', 'chrome=0&rail=collapsed&file=use-ride-history', {
  width: 1200,
  clip: cardClip('use-ride-history', { top: 0, height: 760, width: 1100 }),
  prepare: async (page) => {
    // Scroll so the changed block sits under the card header, like the mockup.
    await page.waitForTimeout(400);
  },
});
await shoot('detail-changes', 'chrome=0&file=section-list', {
  clip: async (page) => {
    const box = await page.locator('#file-section-list').boundingBox();
    const rail = await page.locator('nav').boundingBox();
    return { x: rail.x, y: Math.max(box.y - 60, 0), width: 1440, height: 760 };
  },
});

// ── Comments ──
/** A line number in a file's diff, for clicking and dragging. */
const lineNumber = (page, id, line) =>
  page.locator(`#file-${id} diffs-container`).locator(`[data-column-number="${line}"]`).first();
// Saved comments under their lines, one outdated, and a file comment atop its card.
await shoot('09-comments', 'chrome=0&comments=1&file=use-ride-history', {
  prepare: async (page) => {
    await page.locator('[data-scroll-root]').evaluate((node) => node.scrollBy(0, 560));
    await page.waitForTimeout(300);
  },
  then: [
    {
      name: '10-comments-outdated',
      prepare: async (page) => {
        await page.locator('#file-section-list').evaluate((node) => node.scrollIntoView({ block: 'start' }));
        await page.locator('[data-scroll-root]').evaluate((node) => node.scrollBy(0, 260));
        await page.waitForTimeout(300);
        await page.locator('#file-section-list [data-comment-id]').first().hover();
        await page.waitForTimeout(200);
      },
    },
  ],
});
// Dragging across line numbers picks a range; letting go opens the box on it.
await shoot('11-comment-drag', 'chrome=0&comments=1&file=use-ride-history', {
  prepare: async (page) => {
    await page.locator('[data-scroll-root]').evaluate((node) => node.scrollBy(0, 700));
    await page.waitForTimeout(300);
    const from = await lineNumber(page, 'use-ride-history', 60).boundingBox();
    const to = await lineNumber(page, 'use-ride-history', 62).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
  },
  then: [
    {
      name: '12-comment-box',
      prepare: async (page) => {
        await page.mouse.up();
        await page.waitForTimeout(300);
        await page.keyboard.type('Name this for what it holds, like titleById.');
        await page.waitForTimeout(150);
      },
    },
  ],
});
await shoot('13-comments-menu', 'chrome=0&comments=1', {
  prepare: async (page) => {
    await page.getByTitle('Comments and review note').click();
    await page.waitForTimeout(300);
  },
});
await shoot('14-done', 'chrome=0&comments=1', {
  prepare: async (page) => {
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await page.waitForTimeout(400);
  },
});

// ── The real app ─────────────────────────────────────────────────────────

const sandbox = mkdtempSync(join(tmpdir(), 'onceover-shots-'));
const fixtures = resolve('ui/src/fixtures/files');
const fixture = (name) => readFileSync(join(fixtures, name));
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(sandbox, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z',
};
writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '[user]\n\tname = Onceover\n\temail = shots@example.com\n[init]\n\tdefaultBranch = main\n');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' }).toString().trim();
const write = (dir, files) => {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
};
const lockfile = (version) =>
  `${JSON.stringify({ name: 'rideshare-web', lockfileVersion: 3, packages: { '': { version } } }, null, 2)}\n`;
const png = (seed) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), Buffer.alloc(4096 + seed * 512, seed)]);

/** `origin` on main with the old files, cloned into `rideshare-web` and branched. */
function makeRepo(name) {
  const origin = join(sandbox, `${name}-origin`);
  mkdirSync(origin);
  git(origin, 'init', '--quiet');
  write(origin, {
    'client/src/views/RideHistory/useRideHistory.ts': fixture('useRideHistory.old.ts.txt'),
    'client/src/views/RideHistory/RideHistoryPage.tsx': fixture('RideHistoryPage.old.tsx.txt'),
    'app/src/ui/lib/list/section-list.tsx': fixture('section-list.old.tsx.txt'),
    'client/src/views/RideHistory/rideStatus.ts': fixture('rideStatus.old.ts.txt'),
    'client/src/legacy/dimmedRows.ts': fixture('dimmedRows.old.ts.txt'),
    'client/public/img/route-map@2x.png': png(1),
    'package-lock.json': lockfile('1.4.0'),
  });
  git(origin, 'add', '--all');
  git(origin, 'commit', '--quiet', '-m', 'Initial commit');
  const repo = join(sandbox, name, 'rideshare-web');
  mkdirSync(dirname(repo), { recursive: true });
  git(sandbox, 'clone', '--quiet', origin, repo);
  git(repo, 'switch', '--quiet', '-c', 'feature/dimmed-status-cards');
  return repo;
}

// Committed, uncommitted and new changes, like the playground fixture.
const reviewRepo = makeRepo('review');
write(reviewRepo, {
  'client/src/views/RideHistory/useRideHistory.ts': fixture('useRideHistory.new.ts.txt'),
  'app/src/ui/lib/list/section-list.tsx': fixture('section-list.new.tsx.txt'),
  'package-lock.json': lockfile('1.5.0'),
});
git(reviewRepo, 'mv', 'client/src/views/RideHistory/rideStatus.ts', 'client/src/views/RideHistory/statusLabels.ts');
write(reviewRepo, { 'client/src/views/RideHistory/statusLabels.ts': fixture('statusLabels.new.ts.txt') });
git(reviewRepo, 'rm', '--quiet', 'client/src/legacy/dimmedRows.ts');
git(reviewRepo, 'add', '--all');
git(reviewRepo, 'commit', '--quiet', '-m', 'Dim finished rides');
write(reviewRepo, {
  'client/src/views/RideHistory/RideHistoryPage.tsx': fixture('RideHistoryPage.new.tsx.txt'),
  'client/src/components/StatusCard/StatusCard.tsx': fixture('StatusCard.new.tsx.txt'),
  'client/public/img/route-map@2x.png': png(2),
});

// Other branches for the base picker.
git(reviewRepo, 'branch', 'release/2.4', 'main');
// Starts from this branch's commit, so switching to it leaves only the uncommitted work.
git(reviewRepo, 'branch', 'agent/map-view', 'HEAD');

// Every kind of file card: mode change, renames, empty, symlink, binary,
// a submodule, a very large file and a deleted one shown in full.
const edgeRepo = makeRepo('edge');
const bigLines = (n, word) => Array.from({ length: n }, (_, i) => `export const ${word}${i} = ${i};`).join('\n') + '\n';
{
  const origin = join(sandbox, 'edge-origin');
  write(origin, {
    'scripts/release.sh': '#!/bin/sh\nnpm run build\n',
    'client/src/views/RideHistory/rideFormat.ts': fixture('rideStatus.old.ts.txt'),
    'client/src/legacy/statusColors.ts': 'export const DIMMED = 0.4;\nexport const FULL = 1;\n',
    'docs/README.md': '# Ride history\n',
    'client/src/test/fixtures/rides.ts': bigLines(1200, 'ride'),
  });
  git(origin, 'add', '--all');
  git(origin, 'commit', '--quiet', '-m', 'More files');
  const vendorA = git(origin, 'commit-tree', '-m', 'vendor a', git(origin, 'write-tree'));
  git(origin, 'update-index', '--add', '--cacheinfo', `160000,${vendorA},vendor/maps-sdk`);
  git(origin, 'commit', '--quiet', '-m', 'Add maps SDK');
  git(edgeRepo, 'fetch', '--quiet');
  git(edgeRepo, 'reset', '--quiet', '--hard', 'origin/main');
  const vendorB = git(edgeRepo, 'commit-tree', '-m', 'vendor b', git(edgeRepo, 'write-tree'));
  git(edgeRepo, 'update-index', '--cacheinfo', `160000,${vendorB},vendor/maps-sdk`);
  execFileSync('chmod', ['+x', join(edgeRepo, 'scripts/release.sh')]);
  mkdirSync(join(edgeRepo, 'client/src/format'));
  mkdirSync(join(edgeRepo, 'client/src/theme'));
  git(edgeRepo, 'mv', 'client/src/views/RideHistory/rideFormat.ts', 'client/src/format/rideFormat.ts');
  git(edgeRepo, 'mv', 'client/src/legacy/statusColors.ts', 'client/src/theme/statusColors.ts');
  write(edgeRepo, {
    'client/src/format/rideFormat.ts': fixture('statusLabels.new.ts.txt'),
    'client/src/views/RideHistory/index.ts': '',
    'client/src/test/fixtures/rides.ts': bigLines(1400, 'trip'),
    'client/public/img/pin@2x.png': png(3),
  });
  rmSync(join(edgeRepo, 'docs/README.md'));
  execFileSync('ln', ['-s', '../client/src/views/RideHistory/README.md', join(edgeRepo, 'docs/README.md')]);
  git(edgeRepo, 'add', '--all');
  git(edgeRepo, 'commit', '--quiet', '-m', 'Edge cases');
  git(edgeRepo, 'rm', '--quiet', 'client/src/legacy/dimmedRows.ts');
}

// A big branch: 120 files, to check scrolling stays smooth.
const bigRepo = makeRepo('big');
for (let i = 0; i < 120; i++) {
  const dir = ['client/src/views', 'client/src/components', 'server/src/routes', 'packages/ui/src'][i % 4];
  write(bigRepo, {
    [`${dir}/module${String(i).padStart(3, '0')}.ts`]: `${bigLines(30 + (i % 7) * 10, `value${i}_`)}`,
  });
}

// No changes yet.
const emptyRepo = makeRepo('empty');

// No base to find.
const orphanRepo = join(sandbox, 'orphan', 'rideshare-web');
mkdirSync(orphanRepo, { recursive: true });
git(orphanRepo, 'init', '--quiet', '--initial-branch=agent/experiment');
write(orphanRepo, { 'README.md': '# rideshare-web\n' });
git(orphanRepo, 'add', '--all');
git(orphanRepo, 'commit', '--quiet', '-m', 'Start');
git(orphanRepo, 'branch', 'develop');

const appServers = [];
async function serveRepo(dir) {
  const server = await startServer({ repo: await findRepo(dir), uiDir: root });
  appServers.push(server);
  return server.url;
}

const reviewUrl = await serveRepo(reviewRepo);
await shoot('app-01-review', reviewUrl);
await shoot('app-02-review-scrolled', reviewUrl, {
  prepare: async (page) => {
    await page.locator('[data-scroll-root]').evaluate((node) => node.scrollBy(0, 1400));
    await page.waitForTimeout(400);
  },
});
// N twice: the second change, flashed under its file header.
await shoot('app-11-next-change', reviewUrl, {
  prepare: async (page) => {
    await page.keyboard.press('n');
    await page.waitForTimeout(150);
    await page.keyboard.press('n');
    await page.waitForTimeout(120);
  },
});
// V on the first two files (J moves on), then a reload: the marks are saved.
await shoot('app-12-viewed-saved', reviewUrl, {
  prepare: async (page) => {
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    await page.keyboard.press('j');
    await page.waitForTimeout(200);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
  },
});
// Clear the marks for the shots after this one.
await fetch(new URL('/api/review', reviewUrl), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ viewed: [] }),
});
await shoot('app-13-file-finder', reviewUrl, {
  prepare: async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await page.waitForTimeout(250);
    await page.keyboard.type('ride');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
  },
});
await shoot('app-14-shortcuts', reviewUrl, {
  prepare: async (page) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
  },
});
// Halfway down a file: its header is stuck, with a shadow under it.
await shoot('app-15-stuck-header', reviewUrl, {
  prepare: async (page) => {
    await page.locator('[data-scroll-root]').evaluate((node) => {
      const card = node.querySelector('section[aria-label$="useRideHistory.ts"]');
      node.scrollTop += card.getBoundingClientRect().top - node.getBoundingClientRect().top + 420;
    });
    await page.waitForTimeout(400);
  },
  clip: async () => ({ x: 300, y: 0, width: 1140, height: 420 }),
});
await shoot('app-06-base-picker', reviewUrl, {
  prepare: async (page) => {
    await page.getByRole('button', { name: /origin\/main/ }).click();
    await page.waitForTimeout(500);
  },
  clip: async () => ({ x: 0, y: 0, width: 960, height: 480 }),
});
await shoot('app-07-base-switched', reviewUrl, {
  prepare: async (page) => {
    await page.getByRole('button', { name: /origin\/main/ }).click();
    await page.getByRole('option', { name: /agent\/map-view/ }).click();
    await page.waitForTimeout(1200);
  },
});
// Put the base back for the shots after this one.
await fetch(new URL('/api/base', reviewUrl), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ base: null }),
});

// ── Comments in the app ──
// A comment and a note, saved, survive a reload; Done copies them and saves last-review.md.
await shoot('app-19-comment-saved', reviewUrl, {
  prepare: async (page) => {
    const line = page.locator('section[aria-label$="useRideHistory.ts"] diffs-container').locator('[data-column-number="44"]').first();
    await line.scrollIntoViewIfNeeded();
    await line.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('This closes the loop above; keep the two in step.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.getByTitle('Comments and review note').click();
    await page.keyboard.type('Looks close. Tighten the naming first.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.locator('[data-comment-id]').first().evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
  },
  then: [
    {
      name: 'app-20-done',
      prepare: async (page) => {
        await page.keyboard.press('ControlOrMeta+Shift+Enter');
        await page.waitForTimeout(800);
      },
    },
  ],
});
// Clear the comments for the shots after this one.
await fetch(new URL('/api/review', reviewUrl), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ comments: [], note: '' }),
});

// ── Live refresh ──
/** The first line of code under the stuck header of a file's card: its text and where it sits. */
const firstLine = (page, name) =>
  page.locator('[data-scroll-root]').evaluate((root, name) => {
    const card = root.querySelector(`section[aria-label$="${name}"]`);
    const rootTop = root.getBoundingClientRect().top;
    const y = rootTop + 44;
    const row = [...card.querySelector('diffs-container').shadowRoot.querySelectorAll('[data-line][data-line-type]')]
      .map((node) => ({ text: node.textContent, top: node.getBoundingClientRect().top - rootTop }))
      .find((item) => item.top + rootTop >= y);
    return { ...row, scrollTop: root.scrollTop };
  }, name);
const sectionList = 'app/src/ui/lib/list/section-list.tsx';
const sectionListBefore = readFileSync(join(reviewRepo, sectionList), 'utf8');
// V folds the first file. Then, reading halfway down a later file, the agent
// edits the folded file above and adds a new one: the folded file unfolds and
// loses its viewed mark, and the line being read stays put.
await shoot('app-16-live-edit', reviewUrl, {
  prepare: async (page) => {
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    await page.locator('[data-scroll-root]').evaluate((root) => {
      const card = root.querySelector('section[aria-label$="RideHistoryPage.tsx"]');
      root.scrollTo({ top: root.scrollTop + card.getBoundingClientRect().top - root.getBoundingClientRect().top + 120, behavior: 'instant' });
    });
    await page.waitForTimeout(400);
    const before = await firstLine(page, 'RideHistoryPage.tsx');
    const lines = sectionListBefore.split('\n');
    lines.splice(15, 0, '  /** Called once the list has measured its rows */', '  readonly onRowsMeasured?: (count: number) => void', '');
    writeFileSync(join(reviewRepo, sectionList), lines.join('\n'));
    write(reviewRepo, { 'client/src/views/RideHistory/rideTime.ts': 'export const formatRideTime = (date: Date) =>\n  date.toLocaleTimeString([], { hour: \'numeric\', minute: \'2-digit\' });\n' });
    await page.waitForTimeout(1600);
    const after = await firstLine(page, 'RideHistoryPage.tsx');
    logs.push(
      `[app-16-live-edit] info: reading "${before.text?.trim()}" at ${before.top.toFixed(1)} px, after the edit "${after.text?.trim()}" at ${after.top.toFixed(1)} px (scrollTop ${before.scrollTop} → ${after.scrollTop})`,
    );
  },
  // U jumps to the next updated file: the edited one, unfolded, with its badge.
  then: [
    {
      name: 'app-17-next-updated',
      prepare: async (page) => {
        await page.keyboard.press('u');
        await page.waitForTimeout(800);
      },
    },
  ],
});
writeFileSync(join(reviewRepo, sectionList), sectionListBefore);
rmSync(join(reviewRepo, 'client/src/views/RideHistory/rideTime.ts'), { force: true });
// The server stops: the header says so, and the page waits for it to come back.
{
  const server = await startServer({ repo: await findRepo(reviewRepo), uiDir: root });
  await shoot('app-18-offline', server.url, {
    expectOffline: true,
    prepare: async (page) => {
      await server.close();
      await page.waitForTimeout(2500);
    },
    clip: async () => ({ x: 720, y: 0, width: 720, height: 120 }),
  });
  await server.close();
}

const edgeUrl = await serveRepo(edgeRepo);
await shoot('app-08-edge-cases', edgeUrl, { height: 1800 });
// The folded deleted file, opened up.
await shoot('app-09-edge-cases-revealed', edgeUrl, {
  prepare: async (page) => {
    await page.getByRole('button', { name: 'Show lines' }).click();
    await page.locator('section[aria-label$="dimmedRows.ts"]').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.mouse.move(8, 892);
    await page.waitForTimeout(400);
  },
});
const bigUrl = await serveRepo(bigRepo);
await shoot('app-10-big-branch', bigUrl, {
  prepare: async (page) => {
    const timing = await page.evaluate(async () => {
      const root = document.querySelector('[data-scroll-root]');
      const frames = [];
      let last = performance.now();
      for (let i = 0; i < 60; i++) {
        root.scrollBy(0, 400);
        await new Promise((done) => requestAnimationFrame(done));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      frames.sort((a, b) => a - b);
      return { median: frames[30], worst: frames[59], cards: document.querySelectorAll('section[id^="file-"]').length };
    });
    logs.push(`[app-10-big-branch] info: ${timing.cards} cards, scroll frame median ${timing.median.toFixed(1)} ms, worst ${timing.worst.toFixed(1)} ms`);
  },
});
await shoot('app-03-empty', await serveRepo(emptyRepo));
await shoot('app-04-no-base', await serveRepo(orphanRepo));
await shoot('app-05-loading', reviewUrl, {
  route: (page) => page.route('**/api/diff', () => new Promise(() => {})),
  waitUntil: 'domcontentloaded',
});

// ── The hosted demo ─────────────────────────────────────────────────────
// The real app over the demo's fake server (npm run build:demo), when it's built.
const demoRoot = resolve('dist/demo');
let demoServer = null;
if (existsSync(join(demoRoot, 'index.html'))) {
  demoServer = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(demoRoot, path);
    if (!file.startsWith(demoRoot) || !existsSync(file) || statSync(file).isDirectory()) file = join(demoRoot, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? (file.endsWith('.json') ? 'application/json' : 'application/octet-stream') });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => demoServer.listen(0, '127.0.0.1', done));
  const demoUrl = `http://127.0.0.1:${demoServer.address().port}/`;
  /** Scrolls the stack so a file's card sits under the header. */
  const scrollTo = (name, offset = 0) => async (page) => {
    await page.locator('[data-scroll-root]').evaluate(
      (root, [name, offset]) => {
        const card = root.querySelector(`section[aria-label$="${name}"]`);
        root.scrollTo({ top: root.scrollTop + card.getBoundingClientRect().top - root.getBoundingClientRect().top + offset, behavior: 'instant' });
      },
      [name, offset],
    );
    await page.waitForTimeout(400);
  };
  // First visit: seeded comments, a viewed file and the demo bar.
  await shoot('demo-01-open', demoUrl, {
    then: [
      { name: 'demo-02-comments', prepare: scrollTo('useRideHistory.ts', 520) },
      {
        name: 'demo-03-live-edit',
        prepare: async (page) => {
          await page.getByRole('button', { name: /Simulate an agent edit/ }).click();
          await page.waitForTimeout(1600);
        },
      },
      {
        name: 'demo-04-done',
        prepare: async (page) => {
          await page.keyboard.press('ControlOrMeta+Shift+Enter');
          await page.waitForTimeout(800);
        },
      },
    ],
  });
  await shoot('demo-05-edge-cases', demoUrl, { height: 2000, prepare: scrollTo('package-lock.json', -1200) });
  await shoot('demo-06-base-picker', demoUrl, {
    prepare: async (page) => {
      await page.getByRole('button', { name: /origin\/main/ }).click();
      await page.waitForTimeout(400);
    },
    then: [
      {
        name: 'demo-07-base-switched',
        prepare: async (page) => {
          await page.getByRole('option', { name: /origin\/release\/2\.4/ }).click();
          await page.waitForTimeout(1200);
        },
      },
    ],
  });
}

await Promise.all(appServers.map((server) => server.close()));
rmSync(sandbox, { recursive: true, force: true });

writeFileSync(join(outDir, 'console.txt'), logs.length ? `${logs.join('\n')}\n` : 'No console errors or warnings.\n');
await browser.close();
server.close();
demoServer?.close();
console.log(logs.length ? `${logs.length} console messages, see console.txt` : 'No console errors.');
