import { defineConfig } from 'tsup';

// ESM + .d.ts. React, R3F and three are peer deps — externalized, never bundled.
// box3d-web / three-box3d are runtime deps but we keep them external too so the
// consumer dedupes a single copy (they carry the WASM and three-peer contract).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  splitting: false,
  treeshake: true,
  external: ['react', 'react/jsx-runtime', '@react-three/fiber', 'three', 'box3d-web', 'three-box3d'],
});
