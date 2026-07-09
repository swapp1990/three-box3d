import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Single-page R3F app. box3d-web's default loader resolves box3d.wasm via
// `new URL('../wasm/box3d.wasm', import.meta.url)`; Vite fingerprints + serves it
// as an asset automatically (same as the vanilla examples).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    // Playwright/CI probes bind 127.0.0.1, not localhost — match it here.
    host: '127.0.0.1',
    port: 5184,
  },
  build: {
    // useBox3D → createBox3D uses async WASM init; es2022 covers modern syntax.
    target: 'es2022',
  },
});
