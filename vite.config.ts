import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE_FILE=1 bundles the playground into one script with inlined fonts,
// for previewing it somewhere that can't serve hundreds of chunks.
const singleFile = process.env.SINGLE_FILE === '1';

export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  build: {
    outDir: singleFile ? '../dist/preview' : '../dist/ui',
    emptyOutDir: true,
    assetsInlineLimit: singleFile ? Number.MAX_SAFE_INTEGER : undefined,
    chunkSizeWarningLimit: 4096,
    rolldownOptions: singleFile ? { output: { codeSplitting: false } } : undefined,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
