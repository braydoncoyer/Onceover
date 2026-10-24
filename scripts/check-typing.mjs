// Checks that typing in a comment box doesn't redraw the diff around it.
// Each keystroke used to hand Pierre new line annotations, which made it
// throw away and rebuild every line of the file: the box flickered as you
// typed. Usage: npm run build && node scripts/check-typing.mjs
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist/ui');
if (!existsSync(join(root, 'playground.html'))) {
  console.error('dist/ui is missing. Run `npm run build` first.');
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : undefined,
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${server.address().port}/playground.html?chrome=0&comments=1&file=use-ride-history`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(800);
  const diff = page.locator('#file-use-ride-history diffs-container');
  const number = diff.locator('[data-column-number="60"]').first();
  await number.scrollIntoViewIfNeeded();
  await number.click();
  const field = page.locator('#file-use-ride-history [data-comment-composer] textarea').last();
  await field.waitFor();
  await page.waitForTimeout(300);

  // Count every node Pierre adds or removes in the file's shadow root while we type.
  await diff.evaluate((host) => {
    const marks = (window.__marks = { added: 0, removed: 0 });
    window.__observer = new MutationObserver((records) => {
      for (const record of records) {
        marks.added += record.addedNodes.length;
        marks.removed += record.removedNodes.length;
      }
    });
    window.__observer.observe(host.shadowRoot, { childList: true, subtree: true });
    window.__line = host.shadowRoot.querySelector('[data-line]');
  });
  const box = await field.evaluateHandle((node) => node);
  await field.pressSequentially('Name this for what it holds.', { delay: 20 });
  await page.waitForTimeout(300);
  const result = await diff.evaluate((host) => ({ ...window.__marks, lineKept: window.__line.isConnected }));
  const sameBox = await box.evaluate((node) => node.isConnected && node === document.activeElement);
  console.log(`shadow DOM nodes added ${result.added}, removed ${result.removed}; first line kept: ${result.lineKept}; box kept focus: ${sameBox}`);
  if (result.added + result.removed > 0 || !result.lineKept || !sameBox) {
    console.error('✗ Typing in a comment box redrew the diff.');
    failed = true;
  } else {
    console.log('✓ Typing leaves the diff alone.');
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
