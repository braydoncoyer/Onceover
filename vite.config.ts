import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE_FILE=1 bundles the playground into one script with inlined fonts,
// for previewing it somewhere that can't serve hundreds of chunks.
const singleFile = process.env.SINGLE_FILE === '1';

// `npm run dev` proxies the API to a running `onceover --no-open --port 47000`.
const apiPort = process.env.ONCEOVER_PORT ?? '47000';

export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
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
