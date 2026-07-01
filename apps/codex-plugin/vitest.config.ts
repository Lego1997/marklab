import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Several tests spawn the real `node marklab.mjs` CLI and hit a local HTTP server; Node
    // spawn + module-load latency under load runs 3-5s, so the 5000ms default is too tight and
    // caused flaky timeouts. The E2E test keeps its own explicit 90s per-test override.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
