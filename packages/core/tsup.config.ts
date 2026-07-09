import { defineConfig } from 'tsup';

// ESM + .d.ts. Two entry points: the main barrel and the helpers subpath.
// Structured so the compat/separate WASM-packaging variant matrix (Phase 4) can
// grow additively — add entries + exports subpaths, don't restructure.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'helpers/index': 'src/helpers/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  splitting: false,
  treeshake: true,
});
