import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE_FILE=1 bundles the playground into one script with inlined fonts,
// for previewing it somewhere that can't serve hundreds of chunks.
const singleFile = process.env.SINGLE_FILE === '1';

// `npm run dev` proxies the API to a running `onceover --no-open --port 47000`.
const apiPort = process.env.ONCEOVER_PORT ?? '47000';

/*
 * Swaps Pierre's word-alt pass for ours (ui/src/lib/wordDiff.ts): pills that
 * hug words, no pills on rewritten lines. Pierre has no hook for this, so the
 * plugin renames its function and adds one that calls ours. It runs in the
 * build and in dev's dependency pre-bundle, and only reaches the main-thread
 * renderer, which is the one the app uses (`disableWorkerPool`). If a Pierre
 * update changes the function, the build stops here rather than quietly
 * falling back.
 */
function pierreWordPills(): Plugin {
  const target = /@pierre[\\/]diffs[\\/]dist[\\/]utils[\\/]renderDiffWithHighlighter\.js$/;
  const signature = 'function computeLineDiffDecorations({';
  const wordDiff = JSON.stringify(resolve(import.meta.dirname, 'ui/src/lib/wordDiff.ts'));
  return {
    name: 'onceover:pierre-word-pills',
    enforce: 'pre',
    transform(code, id) {
      if (!target.test(id.split('?')[0])) return;
      if (!code.includes(signature) || !code.includes('createDiffSpanDecoration') || !code.includes('cleanLastNewline')) {
        this.error('Pierre changed computeLineDiffDecorations. Update the pierreWordPills plugin in vite.config.ts.');
      }
      return [
        `import { wordSpans as onceoverWordSpans } from ${wordDiff};`,
        code.replace(signature, 'function computeLineDiffDecorations__pierre({'),
        /* js */ `
function computeLineDiffDecorations(args) {
  const { deletionLine, additionLine, lineDiffType, maxLineDiffLength } = args;
  if (lineDiffType !== 'word-alt' || deletionLine == null || additionLine == null) {
    return computeLineDiffDecorations__pierre(args);
  }
  const before = cleanLastNewline(deletionLine);
  const after = cleanLastNewline(additionLine);
  if (before.length > maxLineDiffLength || after.length > maxLineDiffLength) return;
  const spans = onceoverWordSpans(before, after);
  if (!spans) return;
  for (const [spanStart, spanLength] of spans.deletion) {
    args.deletionDecorations.push(createDiffSpanDecoration({ line: args.deletionLineIndex, spanStart, spanLength }));
  }
  for (const [spanStart, spanLength] of spans.addition) {
    args.additionDecorations.push(createDiffSpanDecoration({ line: args.additionLineIndex, spanStart, spanLength }));
  }
}`,
      ].join('\n');
    },
  };
}

export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [pierreWordPills(), react()],
  optimizeDeps: {
    rolldownOptions: { plugins: [pierreWordPills()] },
  },
  build: {
    outDir: singleFile ? '../dist/preview' : '../dist/ui',
    emptyOutDir: true,
    assetsInlineLimit: singleFile ? Number.MAX_SAFE_INTEGER : undefined,
    chunkSizeWarningLimit: 4096,
    rolldownOptions: singleFile
      ? { input: resolve(import.meta.dirname, 'ui/playground.html'), output: { codeSplitting: false } }
      : {
          input: {
            index: resolve(import.meta.dirname, 'ui/index.html'),
            playground: resolve(import.meta.dirname, 'ui/playground.html'),
          },
        },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        // The server turns away other origins; through the proxy, this is the page itself.
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
    },
  },
});
