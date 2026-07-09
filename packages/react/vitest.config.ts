import { defineConfig } from 'vitest/config';

// jsdom so React + R3F's @react-three/test-renderer can render off-screen.
// Real WASM (box3d-web) runs in-process — nothing about core is mocked.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
