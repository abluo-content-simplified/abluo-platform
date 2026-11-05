#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rehearsal of migration 064 (course schedules) — ABLUO SANDBOX ONLY.
//
// Runs the course schedule functions end to end against the sandbox (create
// series -> sync -> update one session -> closure -> end series, plus an event
// one-off save), inside ONE transaction that is always rolled back (no rows are
// left behind), and checks the API roles cannot reach the new tables. Refuses to
// run unless the database in .env.sandbox.local is the sandbox (same project ref
// as its API URL, and not the Abluo production project). Apply 064 to the
// sandbox first.
//
//   node supabase/verify/rehearse-064.mjs
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

// Mondays in January 2099 (no DST; Europe/Brussels = UTC+1).
const MON = ['2099-01-05', '2099-01-12', '2099-01-19', '2099-01-26']
const row = (d, hh = 18) => ({
  original_start_local: `${d}T18:00`, start_local: `${d}T${String(hh).padStart(2, '0')}:00`, end_local: `${d}T${String(hh + 1).padStart(2, '0')}:00`,
  starts_at: `${d}T${String(hh - 1).padStart(2, '0')}:00:00Z`, ends_at: `${d}T${String(hh).padStart(2, '0')}:00:00Z`,
})

try {
  await q('begin')
  const t = (await q(`insert into public.tenants (slug, display_name) values ('zz-rehearse-064', 'Rehearsal') returning id`)).rows[0].id
  const pA = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r64-a', $1, 'A') returning id`, [t])).rows[0].id
  const pB = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r64-b', $1, 'B') returning id`, [t])).rows[0].id
  const course = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  // Backfill sanity: tables carry the new columns.
  const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'event_series' and column_name in ('owner_type','owner_public_id','edition_id','languages','meeting_room_id','rule_weekday','starts_on','ends_on')`)).rows.length
  check('event_series has the 8 new columns', cols === 8, `${cols}`)

  const edition = (await q(`insert into public.schedule_editions (project_id, label, starts_on, ends_on, time_zone) values ($1, '{"en":"Winter"}', '2099-01-01', '2099-03-31', 'Europe/Brussels') returning id`, [pA])).rows[0].id
  const room = (await q(`insert into public.schedule_meeting_rooms (project_id, label, join_url, meeting_id, passcode) values ($1, 'Room 1', 'https://zoom.example/j/1', '123', 'abc') returning id`, [pA])).rows[0].id
  await expectError('meeting room join_url must be https', () => q(`insert into public.schedule_meeting_rooms (project_id, label, join_url) values ($1, 'x', 'http://zoom.example')`, [pA]), '23514')
  await expectError('edition end before start refused', () => q(`insert into public.schedule_editions (project_id, starts_on, ends_on, time_zone) values ($1, '2099-02-01', '2099-01-01', 'Europe/Brussels')`, [pA]), '23514')

  const saveSeries = (a) => q(
    `select * from public.schedule_series_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [a.project ?? pA, a.id ?? null, a.ownerType ?? 'course', a.owner ?? course, a.edition === undefined ? edition : a.edition, 'Europe/Brussels',
     a.startLocal ?? '2099-01-05 18:00', a.endLocal ?? '2099-01-05 19:00', 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', 1, '2099-01-05', '2099-03-30',
     a.place ?? { kind: 'location', key: 'brey' }, a.mode ?? 'inPerson', a.instructors ?? [person], a.languages ?? ['fr', 'en'],
     a.room === undefined ? room : a.room, a.version ?? null, null],
  ).then((r) => r.rows[0])
  const sync = (series, from, rows, closed = []) => q(
    `select * from public.schedule_occurrences_sync($1,$2,$3,$4::jsonb,$5::jsonb)`, [pA, series, from, JSON.stringify(rows), JSON.stringify(closed)],
  ).then((r) => r.rows[0])
  const occs = (series) => q(`select id, original_start_local::text o, start_local::text s, starts_at, status, is_modified, version, removed_at, removed_reason, owner_type, owner_public_id from public.event_occurrences where series_id = $1 order by original_start_local, removed_at nulls first`, [series]).then((r) => r.rows)

  // Create a weekly class.
  const s1 = await saveSeries({})
  check('create course series: version 1', s1?.series_id && s1.version === 1)
  const sr = (await q(`select owner_type, owner_public_id, event_public_id, languages, rule_weekday from public.event_series where id = $1`, [s1.series_id])).rows[0]
  check('series is owned by the course (no event id)', sr.owner_type === 'course' && sr.owner_public_id === course && sr.event_public_id === null && sr.rule_weekday === 1 && sr.languages.join() === 'fr,en')
  await expectError('foreign project edition refused', () => saveSeries({ project: pB, edition }), '22023')
  await expectError('foreign project meeting room refused', () => saveSeries({ project: pB, edition: null, room }), '22023')
  await expectError('bad language code refused', () => saveSeries({ languages: ['FR'] }), '23514')

  // Update with the right / a stale version.
  const s2 = await saveSeries({ id: s1.series_id, version: 1, mode: 'mixed' })
  check('update series: same id, version 2', s2.series_id === s1.series_id && s2.version === 2)
  await expectError('stale series version -> AB409', () => saveSeries({ id: s1.series_id, version: 1 }), 'AB409')
  await expectError('series of another project -> not found', () => saveSeries({ project: pB, edition: null, room: null, id: s1.series_id, version: 2 }), 'P0002')
  await expectError('owner cannot change', () => saveSeries({ id: s1.series_id, version: 2, owner: person }), '22023')

  // Sync: insert 4, idempotent, move times.
  const from = '2099-01-01T00:00:00Z'
  const a1 = await sync(s1.series_id, from, MON.map((d) => row(d)))
  check('sync inserts 4 sessions', a1.inserted === 4 && a1.updated === 0 && a1.removed === 0, JSON.stringify(a1))
  const a2 = await sync(s1.series_id, from, MON.map((d) => row(d)))
  check('sync again is idempotent', a2.inserted === 0 && a2.updated === 0 && a2.removed === 0, JSON.stringify(a2))
  const o1 = await occs(s1.series_id)
  check('sessions carry the course owner', o1.length === 4 && o1.every((o) => o.owner_type === 'course' && o.owner_public_id === course))
  const a3 = await sync(s1.series_id, from, MON.map((d) => row(d, 19)))
  check('time change updates 4 sessions in place (ids kept)', a3.updated === 4 && (await occs(s1.series_id)).every((o, i) => o.id === o1[i].id && o.version === 2))

  // Edit one session: cancel + new time + substitute teacher -> modified.
  const target = o1[1] // 2099-01-12
  const nv = (await q(`select public.schedule_occurrence_update($1,$2,$3,'cancelled',$4::uuid[],false,'2099-01-12 20:00','2099-01-12 21:00','2099-01-12T19:00:00Z','2099-01-12T20:00:00Z','{"en":"Sub"}'::jsonb,false) v`, [pA, target.id, 2, [person]])).rows[0].v
  const tRow = (await occs(s1.series_id)).find((o) => o.id === target.id)
  check('occurrence update: version bumps, is_modified, cancelled', nv === 3 && tRow.is_modified === true && tRow.status === 'cancelled' && tRow.s === '2099-01-12 20:00:00')
  await expectError('occurrence update with stale version -> AB409', () => q(`select public.schedule_occurrence_update($1,$2,$3,'scheduled',null,false,null,null,null,null,null,false)`, [pA, target.id, 2]), 'AB409')
  await expectError('occurrence update of another project -> AB409', () => q(`select public.schedule_occurrence_update($1,$2,$3,'scheduled',null,false,null,null,null,null,null,false)`, [pB, target.id, 3]), 'AB409')
  const nv2 = (await q(`select public.schedule_occurrence_update($1,$2,$3,null,null,false,null,null,null,null,null,true) v`, [pA, target.id, 3])).rows[0].v
  check('clear note keeps modified flag and times', nv2 === 4 && (await occs(s1.series_id)).find((o) => o.id === target.id).is_modified === true)

  // Closure: week of Jan 19 closed, and the (modified) Jan 12 is no longer in the set.
  const a4 = await sync(s1.series_id, from, [row(MON[0], 19), row(MON[3], 19)], [`${MON[2]}T18:00`])
  check('closure sync removes exactly the closed session', a4.removed === 1 && a4.inserted === 0, JSON.stringify(a4))
  const o4 = await occs(s1.series_id)
  const jan19 = o4.find((o) => o.o === '2099-01-19 18:00:00')
  const jan12 = o4.find((o) => o.id === target.id)
  check('closed session tombstoned with reason closure', jan19.removed_at !== null && jan19.removed_reason === 'closure')
  check('modified session is never touched by sync', jan12.removed_at === null && jan12.is_modified === true)
  check('sessions before p_from are untouched', (await sync(s1.series_id, '2099-01-20T00:00:00Z', [row(MON[3], 19)])).removed === 0)
  // Closure removed again -> the session comes back as a NEW row (the old one stays a tombstone).
  const a5 = await sync(s1.series_id, from, [row(MON[0], 19), row(MON[2], 19), row(MON[3], 19)])
  check('closure lifted: session inserted again', a5.inserted === 1, JSON.stringify(a5))

  // Event one-off still works and fills the owner columns.
  const ev = 'edccb129-3d15-497d-ad46-c30f0cc41261'
  const one = (await q(`select * from public.event_schedule_save_one_off($1,$2,'Europe/Brussels','2099-02-01 10:00',null,'2099-02-01T09:00:00Z',null,null,'inPerson','{}',null,null,'dashboard')`, [pA, ev])).rows[0]
  const oneRow = (await q(`select s.owner_type so, s.owner_public_id sp, o.owner_type oo, o.owner_public_id op from public.event_series s join public.event_occurrences o on o.series_id = s.id where s.id = $1`, [one.series_id])).rows[0]
  check('event one-off: owner_type event + owner_public_id = event id', oneRow.so === 'event' && oneRow.sp === ev && oneRow.oo === 'event' && oneRow.op === ev)
  const one2 = (await q(`select * from public.event_schedule_save_one_off($1,$2,'Europe/Brussels','2099-02-02 10:00',null,'2099-02-02T09:00:00Z',null,null,'inPerson','{}',1,null,'dashboard')`, [pA, ev])).rows[0]
  check('event one-off update still works', one2.series_id === one.series_id && one2.version === 2)
  await expectError('event one-off stale version -> AB409', () => q(`select * from public.event_schedule_save_one_off($1,$2,'Europe/Brussels','2099-02-02 10:00',null,'2099-02-02T09:00:00Z',null,null,'inPerson','{}',1,null,'dashboard')`, [pA, ev]), 'AB409')
  await expectError('course series cannot carry an event id', () => q(`insert into public.event_series (project_id, event_public_id, owner_type, owner_public_id, time_zone, start_local) values ($1, $2, 'course', $2, 'Europe/Brussels', '2099-01-01 10:00')`, [pA, ev]), '23514')
  await expectError('event series owner must equal event id', () => q(`insert into public.event_series (project_id, event_public_id, owner_type, owner_public_id, time_zone, start_local) values ($1, $2, 'event', $3, 'Europe/Brussels', '2099-01-01 10:00')`, [pA, ev, course]), '23514')

  // End the series: future sessions go, past ones stay.
  await q(`insert into public.event_occurrences (series_id, project_id, owner_type, owner_public_id, original_start_local, start_local, time_zone, starts_at) values ($1, $2, 'course', $3, '2020-01-06 18:00', '2020-01-06 18:00', 'Europe/Brussels', '2020-01-06T17:00:00Z')`, [s1.series_id, pA, course])
  await expectError('end series with stale version -> AB409', () => q(`select public.schedule_series_end($1,$2,$3)`, [pA, s1.series_id, 1]), 'AB409')
  const ended = (await q(`select public.schedule_series_end($1,$2,$3) n`, [pA, s1.series_id, 2])).rows[0].n
  const after = await occs(s1.series_id)
  const live = after.filter((o) => o.removed_at === null)
  check('end series: future sessions tombstoned (series_ended), past kept', ended >= 3 && live.length === 1 && live[0].o === '2020-01-06 18:00:00' && after.some((o) => o.removed_reason === 'series_ended'), `removed ${ended}`)
  const ser = (await q(`select status, removed_at from public.event_series where id = $1`, [s1.series_id])).rows[0]
  check('series tombstoned and marked ended', ser.status === 'ended' && ser.removed_at !== null)

  // Privileges.
  for (const f of ['schedule_series_save', 'schedule_occurrences_sync', 'schedule_occurrence_update', 'schedule_series_end']) {
    const p = (await q(`select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) api, bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) svc from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [f])).rows[0]
    check(`${f}: service_role only`, p.api === false && p.svc === true)
  }
  await expectError('rows cannot be deleted (permanent ids)', async () => {
    await q('set local role service_role')
    await q(`delete from public.schedule_closures`)
  }, '42501')
} catch (e) {
  check('rehearsal ran', false, e.message)
} finally {
  await q('rollback').catch(() => {})
  const leftovers = (await q(`select count(*)::int n from public.tenants where slug = 'zz-rehearse-064'`)).rows[0].n
  check('nothing left behind', leftovers === 0)
  await c.end()
}

// API roles over the Data API (PostgREST): the new tables are server-only.
for (const table of ['schedule_meeting_rooms', 'schedule_editions', 'schedule_closures', 'event_series']) {
  for (const [role, key, expectBlocked] of [['anon', env.NEXT_PUBLIC_SUPABASE_ANON_KEY, true], ['service_role', env.SUPABASE_SERVICE_ROLE_KEY, false]]) {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    const blocked = res.status === 401 || res.status === 403 || res.status === 404
    check(`${role} via the API on ${table} ${expectBlocked ? 'is refused' : 'can read'}`, blocked === expectBlocked, `HTTP ${res.status}`)
  }
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
