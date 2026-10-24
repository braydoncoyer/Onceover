// Screenshots the built design playground (dist/ui) with Playwright.
// Usage: npm run build && npm run screenshot [-- outDir]
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist/ui');
const outDir = resolve(process.argv[2] ?? 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

if (!existsSync(join(root, 'index.html'))) {
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

const browser = await chromium.launch();
const logs = [];

async function shoot(name, query, { width = 1440, height = 900, prepare, clip } = {}) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`[${name}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => logs.push(`[${name}] pageerror: ${error.message}`));
  await page.goto(`${base}?${query}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  if (prepare) await prepare(page);
  const target = clip ? await clip(page) : undefined;
  await page.screenshot({ path: join(outDir, `${name}.png`), clip: target });
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
await shoot('05-states', 'view=states&chrome=0', { height: 1340 });
await shoot('06-tokens', 'view=tokens&chrome=0', { height: 1500 });
await shoot('07-interaction', 'chrome=0', {
  prepare: async (page) => {
    await page.getByRole('button', { name: /section-list/ }).hover();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
  },
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

writeFileSync(join(outDir, 'console.txt'), logs.length ? `${logs.join('\n')}\n` : 'No console errors or warnings.\n');
await browser.close();
server.close();
console.log(logs.length ? `${logs.length} console messages, see console.txt` : 'No console errors.');
