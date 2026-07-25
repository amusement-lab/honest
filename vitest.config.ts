import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/db/vitest-global-setup.ts'],
    env: {
      VITEST: 'true',
    },
  },
})
