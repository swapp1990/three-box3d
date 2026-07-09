import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page vanilla app: one gallery index + one page per example. Each page is
// a self-contained index.html + main.ts — no shared JS framework, no router.
export default defineConfig({
  root: __dirname,
  server: {
    // Playwright/CI probes bind to 127.0.0.1, not localhost — match it here too.
    host: '127.0.0.1',
    port: 5183,
  },
  build: {
    // Every example's main.ts uses top-level await (`await createBox3D()`) — the
    // loud, explicit init box3d-web's API is designed around. Default esbuild
    // targets predate top-level-await support; es2022 covers it.
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        stack: resolve(__dirname, 'stack/index.html'),
        ballDrop: resolve(__dirname, 'ball-drop/index.html'),
        raycastPick: resolve(__dirname, 'raycast-pick/index.html'),
        contactPulse: resolve(__dirname, 'contact-pulse/index.html'),
      },
    },
  },
});
