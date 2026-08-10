import { defineConfig } from 'vitest/config'

// Deliberately separate from the repo-root vitest.config.ts — this suite
// needs a live local Postgres (embedded-postgres) and must never be picked
// up by the platform's default `npx vitest run` gate. Invoke explicitly via
// `npm run verify` in this directory. See README.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.verify.mjs'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    isolate: true,
  },
})
