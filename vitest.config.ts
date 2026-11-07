import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // All tests live in src/test. Helpers/setup files are not matched.
    include: ['src/test/**/*.test.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    // Every test file shares one SQLite file, so files must not run in parallel.
    fileParallelism: false,
    env: {
      VITEST: 'true',
      DATABASE_URL_TEST: './sqlite.test.db',
    },
  },
});
