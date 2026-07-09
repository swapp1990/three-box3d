import { defineConfig } from 'tsup';

// ESM + .d.ts. `three` is a peer dep — externalized, never bundled.
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
  external: ['three', 'box3d-web'],
});
