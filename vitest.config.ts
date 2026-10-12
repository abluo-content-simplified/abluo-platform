import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Playwright specs (e2e/) run with `npm run verify:dashboard`, never under vitest.
    // Live suites (*.live.test.ts) talk to real services: `npm run verify:connections`.
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**', '**/*.live.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
