#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rehearsal of migration 043 (event scheduling) — ABLUO SANDBOX ONLY.
//
// Runs the scheduling functions end to end against the sandbox, inside ONE
// transaction that is always rolled back (no rows are left behind), and checks
// the API roles cannot reach the tables. Refuses to run unless the database in
// .env.sandbox.local is the sandbox (same project ref as its API URL, and not
// the Abluo production project).
//
//   node supabase/verify/rehearse-043.mjs
//
// Needs .env.sandbox.local: SANDBOX_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Secrets never printed.
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
if (!dbRef || PRODUCTION_REFS.includes(dbRef) || PRODUCTION_REFS.includes(apiRef) || dbRef !== apiRef) {
  console.error('Refusing: .env.sandbox.local does not point at the Abluo Sandbox.')
  process.exit(3)
}

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++ }
const c = new pg.Client({ connectionString: env.SANDBOX_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = (sql, p) => c.query(sql, p)
async function expectError(name, fn, codeOrText) {
  await q('savepoint s')
  try { await fn(); check(name, false, 'no error') } catch (e) {
    check(name, e.code === codeOrText || String(e.message).includes(codeOrText), `${e.code} ${String(e.message).split('\n')[0]}`)
  }
  await q('rollback to savepoint s')
}
const save = (args) => q(
  `select * from public.event_schedule_save_one_off($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [args.project, args.event, args.tz ?? 'Europe/Brussels', args.startLocal, args.endLocal ?? null, args.startsAt, args.endsAt ?? null,
   args.place ?? null, args.mode ?? 'inPerson', args.instructors ?? [], args.version ?? null, null, args.origin ?? 'dashboard'],
).then((r) => r.rows[0])

try {
  await q('begin')
  const t = (await q(`insert into public.tenants (slug, display_name) values ('zz-rehearse-043', 'Rehearsal') returning id`)).rows[0].id
  const pA = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r43-a', $1, 'A') returning id`, [t])).rows[0].id
  const pB = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r43-b', $1, 'B') returning id`, [t])).rows[0].id
  const ev = 'edccb129-3d15-497d-ad46-c30f0cc41261'

  // One-off create → 1 series + 1 session, version 1.
  const a = await save({ project: pA, event: ev, startLocal: '2026-10-24 10:00', endLocal: '2026-10-24 12:30', startsAt: '2026-10-24T08:00:00Z', endsAt: '2026-10-24T10:30:00Z', place: { kind: 'location', key: 'brey' } })
  check('create one-off: series + session, version 1', a?.series_id && a?.occurrence_id && a.version === 1)
  // Update with the right version → same ids, version 2.
  const b = await save({ project: pA, event: ev, startLocal: '2026-10-31 10:00', startsAt: '2026-10-31T09:00:00Z', version: 1 })
  check('move the session: ids kept, version 2', b.series_id === a.series_id && b.occurrence_id === a.occurrence_id && b.version === 2)
  const occ = (await q(`select start_local::text, starts_at, time_zone from public.event_occurrences where id = $1`, [a.occurrence_id])).rows[0]
  check('session carries local time, zone and UTC', occ.start_local === '2026-10-31 10:00:00' && occ.time_zone === 'Europe/Brussels' && new Date(occ.starts_at).toISOString() === '2026-10-31T09:00:00.000Z')
  await expectError('stale version → version_conflict', () => save({ project: pA, event: ev, startLocal: '2026-11-01 10:00', startsAt: '2026-11-01T09:00:00Z', version: 1 }), 'AB409')
  await expectError('create again (no version) → refused', () => save({ project: pA, event: ev, startLocal: '2026-11-01 10:00', startsAt: '2026-11-01T09:00:00Z' }), 'AB409')
  // The same publicId under another project is a different schedule (isolation by project).
  const other = await save({ project: pB, event: ev, startLocal: '2026-12-01 10:00', startsAt: '2026-12-01T09:00:00Z' })
  check('same event id in another project → its own schedule', other.series_id !== a.series_id)
  await expectError('a session cannot point at another project\'s series', () =>
    q(`insert into public.event_occurrences (series_id, project_id, event_public_id, start_local, time_zone, starts_at) values ($1, $2, $3, '2026-10-01 10:00', 'Europe/Brussels', now())`, [a.series_id, pB, ev]), '23503')
  await expectError('invalid place shape refused', () => save({ project: pA, event: ev, startLocal: '2026-11-02 10:00', startsAt: '2026-11-02T09:00:00Z', version: 2, place: { kind: 'venue', venuePublicId: 'nope' } }), '23514')
  await expectError('end before start refused', () => save({ project: pA, event: ev, startLocal: '2026-11-02 10:00', endLocal: '2026-11-02 09:00', startsAt: '2026-11-02T09:00:00Z', version: 2 }), '23514')
  // Cancel and restore one session.
  const v1 = (await q(`select public.event_occurrence_set_status($1,$2,'cancelled',$3) v`, [pA, a.occurrence_id, 2])).rows[0].v
  check('cancel a session: version bumps', v1 === 3)
  await expectError('cancel with stale version → conflict', () => q(`select public.event_occurrence_set_status($1,$2,'scheduled',$3)`, [pA, a.occurrence_id, 2]), 'AB409')
  await expectError('cancel from the wrong project → conflict (not found)', () => q(`select public.event_occurrence_set_status($1,$2,'scheduled',$3)`, [pB, a.occurrence_id, 3]), 'AB409')
  // Remove → tombstones, rows kept.
  const removed = (await q(`select public.event_schedule_remove($1,$2) n`, [pA, ev])).rows[0].n
  const left = (await q(`select count(*)::int n, count(*) filter (where removed_at is not null)::int t from public.event_occurrences where project_id = $1`, [pA])).rows[0]
  check('remove: session tombstoned, not deleted', removed === 1 && left.n === 1 && left.t === 1)
  const fresh = await save({ project: pA, event: ev, startLocal: '2027-01-10 10:00', startsAt: '2027-01-10T09:00:00Z' })
  check('after removal a new schedule gets NEW ids', fresh.series_id !== a.series_id && fresh.occurrence_id !== a.occurrence_id)
  await expectError('rows cannot be deleted (permanent ids)', async () => {
    await q('set local role service_role')
    await q(`delete from public.event_occurrences where id = $1`, [a.occurrence_id])
  }, '42501')
} catch (e) {
  check('rehearsal ran', false, e.message)
} finally {
  await q('rollback').catch(() => {})
  const leftovers = (await q(`select count(*)::int n from public.tenants where slug = 'zz-rehearse-043'`)).rows[0].n
  check('nothing left behind', leftovers === 0)
  await c.end()
}

// API roles over the Data API (PostgREST).
for (const [role, key, expectBlocked] of [['anon', env.NEXT_PUBLIC_SUPABASE_ANON_KEY, true], ['service_role', env.SUPABASE_SERVICE_ROLE_KEY, false]]) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/event_occurrences?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const blocked = res.status === 401 || res.status === 403 || res.status === 404
  check(`${role} via the API ${expectBlocked ? 'is refused' : 'can read'}`, blocked === expectBlocked, `HTTP ${res.status}`)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
