import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    port: 5180,
    strictPort: true,
    // Force no-cache on every dev-served asset. Without this WebView2's
    // HTTP cache hangs onto the JS bundle across app restarts, serving a
    // stale build long after Vite's bundle has changed — which manifests
    // as fixes that work in HMR but "disappear" on close + reopen.
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
