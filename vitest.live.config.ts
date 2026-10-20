// ── Live verification suites (*.live.test.ts) ────────────────────────────────
//
// Run against REAL services with throwaway fixtures, never as part of
// `npm test`. Today: the Connections cross-tenant API suite (ADR-031 D8.7).
//
//   npm run verify:connections
//
// Supabase: ONLY the sandbox project (**Abluo Sandbox**), from
// .env.sandbox.local — never .env.local, which points at the Supabase shared by
// dev, preview and production (ADR-038 D8). The config refuses to start when
// the sandbox is missing or is production. Every row the suite creates belongs
// to fixture tenants named `zz-cnv-…` and is deleted at the end (and swept at
// the start, should an earlier run have crashed).
// Sanity: ALWAYS the `staging` dataset — forced here, and the suite refuses
// to run against `production`. No live website content is ever read or written.
import { configDefaults, defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { assertSandboxSupabase, SANDBOX_ENV_FILE } from './src/lib/environments/supabase-target'

const env = loadEnv('', process.cwd(), '')
const LIVE_DATASET = 'staging'

// Sandbox Supabase credentials replace the shared project's, whatever .env.local says.
const SUPABASE_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
function readSandboxEnv(): Record<string, string> {
  const path = resolve(__dirname, SANDBOX_ENV_FILE)
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && (SUPABASE_KEYS as readonly string[]).includes(m[1])) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}
const sandbox = readSandboxEnv()
assertSandboxSupabase(sandbox.NEXT_PUBLIC_SUPABASE_URL, 'Live verification suites')
for (const k of SUPABASE_KEYS) {
  if (!sandbox[k]) throw new Error(`Live verification suites: ${k} missing from ${SANDBOX_ENV_FILE}.`)
}

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
      ...sandbox,
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
