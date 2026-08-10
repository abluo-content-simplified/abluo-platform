// Live-DB verification harness — boots a real, disposable local PostgreSQL
// (via `embedded-postgres`, a downloaded server binary — no Docker, no
// root, no Supabase CLI) and applies this project's real schema + migration
// files verbatim, then hands back a `pg` client for tests to drive.
//
// See ../README.md for the full "how this was stood up" writeup.

import EmbeddedPostgresModule from 'embedded-postgres'
import pg from 'pg'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const EmbeddedPostgres = EmbeddedPostgresModule.default ?? EmbeddedPostgresModule

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VERIFY_DIR = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(VERIFY_DIR, '..', '..')
// IMPORTANT: the repo checkout lives on a FUSE mount in this sandbox (see
// CLAUDE.md "Session conventions" — the sandbox FUSE mount cannot unlink
// its own lock/data files). Postgres's data directory does frequent
// create/unlink cycles (WAL segments, temp files) that FUSE's unlink
// semantics choke on (`EPERM: operation not permitted, unlink ...`). The
// data dir is therefore kept on a real local filesystem (/tmp, ext4 in this
// sandbox — confirmed via `mount`), never inside the repo checkout itself.
// On Tom's own machine (no FUSE mount) this could safely live under
// supabase/verify/.pgdata instead, but /tmp is universally safe, so it's
// used unconditionally. Override with VERIFY_PG_DATA_DIR if needed.
// Suffixed with the process pid so multiple test files (each vitest worker
// is a separate process) never race on the same data directory / port —
// each gets its own fully independent, disposable Postgres instance.
const DATA_DIR =
  process.env.VERIFY_PG_DATA_DIR ?? path.join('/tmp', `abluo-verify-pgdata-${process.pid}`)
const PORT = Number(process.env.VERIFY_PG_PORT ?? 54329 + (process.pid % 1000))
const CONNECTION_STRING = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`

/**
 * Ordered list of real migration files this harness applies, mirroring
 * exactly what a fresh Supabase project would have after all of them ran.
 * `schema.sql` already bakes in migrations 001–005 (see its own header
 * comment) — migrations 006–013 apply on top, in numeric order. The
 * `.sql.draft` file (010) is NOT applied — it was never applied to any real
 * environment either (see its own header). Migration 014 (this task's
 * deliverable) is applied separately by the test suite that needs it, not
 * unconditionally here, so the harness can also prove the P0 route fix
 * against the PRE-014 state if ever needed.
 */
const BASE_MIGRATIONS = [
  '006_custom_access_token_hook.sql',
  '007_project_members.sql',
  '008_leads_project_id.sql',
  '009_projects_select_project_members.sql',
  '011_authz_read_grants.sql',
  '012_profiles_update_own.sql',
  '013_fix_projects_policy_recursion.sql',
]

let pgInstance = null

/**
 * Strips the ` -- Verification queries` / commented-SQL trailer sections
 * that several migration files include as documentation (queries meant to
 * be run manually, not executed automatically) is NOT needed — those
 * blocks are already valid SQL comments (`--`), so `client.query(fullFile)`
 * executes fine as-is via node-postgres's multi-statement support.
 */
function readSql(relPath) {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

export async function startHarness({ verbose = false } = {}) {
  rmSync(DATA_DIR, { recursive: true, force: true })

  pgInstance = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
    onLog: verbose ? (msg) => process.stdout.write(msg) : () => {},
  })

  await pgInstance.initialise()
  await pgInstance.start()

  const client = new pg.Client({ connectionString: CONNECTION_STRING })
  await client.connect()

  // pgcrypto is not required — gen_random_uuid() has been a core PostgreSQL
  // built-in since PG13; this server is PG18.

  await client.query(readFileSync(path.join(VERIFY_DIR, 'auth-shim.sql'), 'utf8'))
  await client.query(readSql('supabase/schema.sql'))
  for (const migration of BASE_MIGRATIONS) {
    try {
      await client.query(readSql(`supabase/migrations/${migration}`))
    } catch (err) {
      throw new Error(`Failed applying migration ${migration}: ${err.message}`)
    }
  }

  return { client, connectionString: CONNECTION_STRING }
}

export async function applyMigrationFile(client, absoluteOrRelativePath) {
  const sql = readFileSync(
    path.isAbsolute(absoluteOrRelativePath)
      ? absoluteOrRelativePath
      : path.join(REPO_ROOT, absoluteOrRelativePath),
    'utf8'
  )
  await client.query(sql)
}

export async function stopHarness(client) {
  try {
    if (client) await client.end()
  } finally {
    if (pgInstance) {
      await pgInstance.stop()
      pgInstance = null
    }
    rmSync(DATA_DIR, { recursive: true, force: true })
  }
}

export const paths = { REPO_ROOT, VERIFY_DIR, DATA_DIR }
