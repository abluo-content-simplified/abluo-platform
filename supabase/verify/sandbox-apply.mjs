#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Apply SQL files to the ABLUO SANDBOX only — one transaction per file, stops
// at the first failure. Used to rebuild the sandbox (schema.sql + the applied
// migrations) and to rehearse a new migration before it goes to Abluo.
//
//   node supabase/verify/sandbox-apply.mjs supabase/migrations/043_event_scheduling.sql
//
// Refuses unless SANDBOX_DATABASE_URL in .env.sandbox.local is the sandbox
// (same project ref as its API URL, never the Abluo production project).
// Rebuild order (2026-10-20): schema.sql, then 006–009, 011–013, 015–019,
// 021–024, 026–042 (010 is a draft; 014/020/025 were never applied — 028
// supersedes them).
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRODUCTION_REFS = ['xsdamzirepfqlutvqfbe'] // = src/lib/environments/supabase-target.ts
const env = Object.fromEntries(
  readFileSync(resolve(REPO, '.env.sandbox.local'), 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
)
const dbRef = decodeURIComponent(new URL(env.SANDBOX_DATABASE_URL).username).split('.')[1] ?? ''
const apiRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if (!dbRef || PRODUCTION_REFS.includes(dbRef) || dbRef !== apiRef) {
  console.error('Refusing: .env.sandbox.local does not point at the Abluo Sandbox.')
  process.exit(3)
}
const files = process.argv.slice(2)
if (!files.length) { console.error('Usage: node supabase/verify/sandbox-apply.mjs <file.sql> [...]'); process.exit(2) }
const c = new pg.Client({ connectionString: env.SANDBOX_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
for (const f of files) {
  const sql = readFileSync(resolve(REPO, f), 'utf8')
  const ownTx = /^\s*begin\s*;/im.test(sql)
  try {
    if (!ownTx) await c.query('begin')
    await c.query(sql)
    if (!ownTx) await c.query('commit')
    console.log('OK  ', f)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.log('FAIL', f, '→', String(e.message).split('\n')[0])
    await c.end()
    process.exit(1)
  }
}
await c.end()
