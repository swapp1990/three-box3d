import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Real WASM instantiation per suite; keep it snappy but not flaky.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
