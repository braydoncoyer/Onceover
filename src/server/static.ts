import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serves the built UI. Paths that aren't files get `index.html`, so the page
 * can own its URLs. Hashed files under `assets/` are cached for good.
 */
export function serveStatic(root: string) {
  const index = join(root, 'index.html');

  return async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> => {
    let file = resolveInside(root, pathname);
    let info = file ? await stat(file).catch(() => null) : null;
    if (!file || !info || !info.isFile()) {
      // A missing asset is a real 404. Anything else is a page route.
      if (pathname.startsWith('/assets/') || extname(pathname)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      file = index;
      info = await stat(index).catch(() => null);
      if (!info) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`The Onceover UI isn't built. Run \`npm run build\` first. Looked in ${root}`);
        return;
      }
    }

    const immutable = file.startsWith(join(root, 'assets') + sep);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}

/** `root` joined with a URL path, or null if the path would leave `root`. */
function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}
