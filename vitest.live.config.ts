// ── Live verification suites (*.live.test.ts) ────────────────────────────────
//
// Run against REAL services with throwaway fixtures, never as part of
// `npm test`. Today: the Connections cross-tenant API suite (ADR-031 D8.7).
//
//   npm run verify:connections
//
// Supabase: the project from .env.local (service role); every row the suite
// creates belongs to fixture tenants named `zz-cnv-…` and is deleted at the
// end (and swept at the start, should an earlier run have crashed).
// Sanity: ALWAYS the `staging` dataset — forced here, and the suite refuses
// to run against `production`. No live website content is ever read or written.
import { configDefaults, defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { resolve } from 'path'

const env = loadEnv('', process.cwd(), '')
const LIVE_DATASET = 'staging'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      ...env,
      NEXT_PUBLIC_SANITY_DATASET: LIVE_DATASET,
      // The staging dataset is private: reads need a token. The write token
      // also reads; it never leaves this process.
      SANITY_API_READ_TOKEN: env.SANITY_API_READ_TOKEN || env.SANITY_API_WRITE_TOKEN || '',
      CONNECTIONS_LIVE_VERIFY: '1',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
