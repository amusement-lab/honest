import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Tests live next to their module; shared helpers live in src/test.
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    // Every test file shares one SQLite file, so files must not run in parallel.
    fileParallelism: false,
  },
});
