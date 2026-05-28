import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    env: {
      VITEST: 'true',
      DATABASE_URL: process.env.DATABASE_URL_TEST || '',
    },
  },
})
