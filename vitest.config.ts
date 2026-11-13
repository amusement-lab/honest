import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live next to their module; shared helpers live in src/utils.
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/utils/test-setup.util.ts'],
    // Every test file shares one SQLite file, so files must not run in parallel.
    fileParallelism: false,
    // Keep module state per file. Nothing closes the shared connection between
    // files, so `--no-isolate` works as well; this is a hygiene choice.
    isolate: true,
    // Make test mode explicit instead of relying on ambient environment vars.
    // DATABASE_URL_TEST is intentionally not set here: globalSetup runs outside
    // the worker env, so both sides must resolve it from the same source.
    env: {
      VITEST: 'true',
      NODE_ENV: 'test',
    },
  },
});
