#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rehearsal of migration 066 (Reservations core, ADR-044) — ABLUO SANDBOX ONLY.
//
// Runs the reservations functions end to end against the sandbox as service_role
// (booking, full refusal, idempotent replay, bank-transfer hold + two payments,
// hold expiry, passes, cross-project refusals, places, activity), inside ONE
// transaction that is always rolled back (no rows are left behind), and checks
// the API roles cannot reach the new tables or functions. Refuses to run unless
// the database in .env.sandbox.local is the sandbox (same project ref as its API
// URL, and not the Abluo production project). Apply 066 to the sandbox first.
//
//   node supabase/verify/rehearse-066.mjs
//
// Needs .env.sandbox.local: SANDBOX_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Secrets never printed.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
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

// Run fn as service_role inside a savepoint. Returns { value } or { error }; the transaction survives errors.
async function svc(fn) {
  await q('set local role service_role')
  await q('savepoint s')
  try {
    const value = await fn()
    await q('release savepoint s')
    return { value }
  } catch (error) {
    await q('rollback to savepoint s')
    return { error }
  } finally {
    await q('reset role')
  }
}
const ok = async (fn) => { const r = await svc(fn); if (r.error) throw r.error; return r.value }
const rpc = (sql, p) => () => q(sql, p).then((r) => r.rows[0].r ?? r.rows[0])
const expectError = async (name, fn, codeOrText) => {
  const { error } = await svc(fn)
  check(name, !!error && (error.code === codeOrText || String(error.message).includes(codeOrText)), error ? `${error.code} ${String(error.message).split('\n')[0]}` : 'no error')
  return error
}

let n = 0
const ref = () => `R66-${(++n).toString(36).toUpperCase().padStart(4, '0')}`
function payload(targetId, { attendees = 1, sessions = [], status = 'confirmed', hold = null, key = randomUUID(), total = 0, passes = [], optionId, source = 'website' } = {}) {
  const atts = Array.from({ length: attendees }, (_, i) => ({ key: `a${i}`, name: `Person ${i}`, email: `p${i}@example.test` }))
  return {
    target_id: targetId, option_id: optionId, idempotency_key: `idem-${key}`, reference: ref(), status, locale: 'en', source,
    purchaser: { name: 'Buyer', email: 'buyer@example.test' }, total_cents: total, hold_expires_at: hold,
    attendees: atts,
    allocations: atts.flatMap((a) => sessions.map((o) => ({ attendee_key: a.key, occurrence_id: o }))),
    passes: passes.map((p) => ({ attendee_key: 'a0', ...p })),
    lines: total ? [{ attendee_key: 'a0', kind: 'item', unit_cents: total, amount_cents: total }] : [],
  }
}
const book = (pid, p) => ok(rpc('select public.reservations_book($1, $2::jsonb) as r', [pid, JSON.stringify(p)]))
const attend = (pid, passId, occ) => ok(rpc('select public.reservations_pass_attend($1,$2,$3) as r', [pid, passId, occ]))
const withdraw = (pid, passId, occ, ret) => ok(rpc('select public.reservations_pass_withdraw($1,$2,$3,$4) as r', [pid, passId, occ, ret]))
const activeCount = async (occ) => (await q('select public.reservations_active_count($1) n', [occ])).rows[0].n

async function makeCourse(projectId, { sessions = 3, firstDay = '2099-03-02' } = {}) {
  const course = randomUUID()
  const series = (await q(`insert into public.event_series (project_id, event_public_id, owner_type, owner_public_id, time_zone, start_local, end_local)
      values ($1, null, 'course', $2, 'Europe/Brussels', ($3::date + time '18:30'), ($3::date + time '20:00')) returning id`, [projectId, course, firstDay])).rows[0].id
  const occ = []
  for (let i = 0; i < sessions; i++) {
    occ.push((await q(`insert into public.event_occurrences (series_id, project_id, event_public_id, owner_type, owner_public_id,
        start_local, end_local, time_zone, starts_at, ends_at)
      values ($1, $2, null, 'course', $3, ($4::date + $5 * interval '7 day' + time '18:30'), ($4::date + $5 * interval '7 day' + time '20:00'),
        'Europe/Brussels', ($4::date + $5 * interval '7 day' + time '17:30') at time zone 'UTC', ($4::date + $5 * interval '7 day' + time '19:00') at time zone 'UTC')
      returning id`, [series, projectId, course, firstDay, i])).rows[0].id)
  }
  return { course, series, occ }
}
const makeTarget = async (projectId, ownerType, ownerId, { places = null, open = true } = {}) =>
  (await q(`insert into public.reservable_targets (project_id, owner_type, owner_public_id, registration_status, default_places)
      values ($1, $2, $3, $4, $5) returning id`, [projectId, ownerType, ownerId, open ? 'open' : 'closed', places])).rows[0].id

const SLUG = 'zz-rehearse-066'
let pA, pB, tenantId
try {
  await q('begin')
  tenantId = (await q(`insert into public.tenants (slug, display_name) values ($1, 'Rehearsal 066') returning id`, [SLUG])).rows[0].id
  pA = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r66-a', $1, 'A') returning id`, [tenantId])).rows[0].id
  pB = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r66-b', $1, 'B') returning id`, [tenantId])).rows[0].id

  const tableCount = (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('bookings','reservable_targets','session_capacity','booking_options','booking_passes','booking_allocations','booking_payments','booking_activity')`)).rows[0].n
  check('066 is applied (8 core tables present)', tableCount === 8, `${tableCount}`)

  // ── Places: confirmed booking, full refusal, replay ────────────────────────
  const C = await makeCourse(pA, { sessions: 3 })
  const T = await makeTarget(pA, 'course', C.course, { places: 3 })
  const r1 = await book(pA, payload(T, { attendees: 2, sessions: [C.occ[0], C.occ[1]] }))
  check('confirmed booking (2 attendees x 2 sessions)', r1.replayed === false && !!r1.booking_id, JSON.stringify(r1).slice(0, 80))
  check('places taken on both sessions', (await activeCount(C.occ[0])) === 2 && (await activeCount(C.occ[1])) === 2)
  const e1 = await expectError('full session refused with AB409', () => book(pA, payload(T, { attendees: 2, sessions: [C.occ[0], C.occ[2]] })), 'AB409')
  let detail = null; try { detail = JSON.parse(e1.detail) } catch {}
  check('AB409 detail lists exactly the full session', Array.isArray(detail) && detail.length === 1 && detail[0] === C.occ[0], String(e1?.detail))
  check('refused booking wrote nothing (third session still empty)', (await activeCount(C.occ[2])) === 0)
  const rp = payload(T, { sessions: [C.occ[2]] })
  const a = await book(pA, rp)
  const b = await book(pA, { ...rp, reference: ref() })
  check('idempotent replay returns the same booking', b.replayed === true && b.booking_id === a.booking_id)
  check('replay did not take another place', (await activeCount(C.occ[2])) === 1)

  // ── Places can't drop below active ────────────────────────────────────────
  await expectError('set_places below active refused (AB409)', rpc('select public.reservations_set_places($1,$2,1)', [pA, C.occ[0]]), 'AB409')
  await ok(rpc('select public.reservations_set_places($1,$2,1,true)', [pA, C.occ[0]]))
  const forced = (await q(`select count(*)::int n from public.booking_activity where project_id = $1 and action = 'capacity.forced_below_active'`, [pA])).rows[0].n
  check('forced set_places logs capacity.forced_below_active', forced === 1, `${forced}`)
  await ok(rpc('select public.reservations_set_places($1,$2,3,false)', [pA, C.occ[0]]))

  // ── Bank-transfer hold + two payments -> confirmed ────────────────────────
  const hc = await makeCourse(pA, { sessions: 1, firstDay: '2099-04-06' })
  const ht = await makeTarget(pA, 'course', hc.course, { places: 1 })
  const soon = new Date(Date.now() + 3600_000).toISOString()
  const h = await book(pA, payload(ht, { sessions: [hc.occ[0]], status: 'awaiting_payment', hold: soon, total: 10000 }))
  check('hold takes the place', (await activeCount(hc.occ[0])) === 1)
  await expectError('second booking blocked by valid hold (AB409)', () => book(pA, payload(ht, { sessions: [hc.occ[0]] })), 'AB409')
  const p1 = await ok(rpc(`select public.reservations_record_payment($1,$2,'bank_transfer',4000,current_date,'REH-1') r`, [pA, h.booking_id]))
  check('first part-payment: partially_paid, not yet confirmed', p1.payment_status === 'partially_paid')
  const p2 = await ok(rpc(`select public.reservations_record_payment($1,$2,'bank_transfer',6000,current_date,'REH-2') r`, [pA, h.booking_id]))
  check('second payment: paid and confirmed', p2.payment_status === 'paid' && p2.confirm?.confirmed === true)
  check('booking confirmed, allocation kind confirmed, 2 payments', (await q(`select (select status from public.bookings where id = $1) st, (select kind from public.booking_allocations where booking_id = $1 limit 1) k, (select count(*)::int from public.booking_payments where booking_id = $1) np`, [h.booking_id])).rows[0].st === 'confirmed'
    && (await q(`select kind from public.booking_allocations where booking_id = $1`, [h.booking_id])).rows[0].kind === 'confirmed'
    && (await q(`select count(*)::int n from public.booking_payments where booking_id = $1`, [h.booking_id])).rows[0].n === 2)

  // ── Hold expiry frees the place ───────────────────────────────────────────
  const ec = await makeCourse(pA, { sessions: 1, firstDay: '2099-05-04' })
  const et = await makeTarget(pA, 'course', ec.course, { places: 1 })
  const eh = await book(pA, payload(et, { sessions: [ec.occ[0]], status: 'awaiting_payment', hold: soon, total: 5000 }))
  check('hold counts while valid', (await activeCount(ec.occ[0])) === 1)
  await q(`update public.booking_allocations set expires_at = now() - interval '1 second' where booking_id = $1`, [eh.booking_id])
  check('expired hold no longer counts: place freed', (await activeCount(ec.occ[0])) === 0)
  const other = await book(pA, payload(et, { sessions: [ec.occ[0]] }))
  check('someone else can now take the freed place', !!other.booking_id)
  // Sweep: a hold due within a minute is expired by the sweep (room is needed elsewhere to stay clean).
  const sc = await makeCourse(pA, { sessions: 1, firstDay: '2099-06-01' })
  const st = await makeTarget(pA, 'course', sc.course, { places: 2 })
  const sh = await book(pA, payload(st, { sessions: [sc.occ[0]], status: 'awaiting_payment', hold: new Date(Date.now() + 1000).toISOString() }))
  const swept = await ok(() => q(`select * from public.reservations_expire_holds(now() + interval '1 minute')`).then((r) => r.rows))
  check('expire_holds sweep expires the due booking', swept.some((r) => r.booking_id === sh.booking_id)
    && (await q(`select status from public.bookings where id = $1`, [sh.booking_id])).rows[0].status === 'expired')

  // ── Pass (all_courses, 2 entries) ─────────────────────────────────────────
  const PC = await makeCourse(pA, { sessions: 4, firstDay: '2099-07-06' })
  await makeTarget(pA, 'course', PC.course, { places: 2 })
  const PT = await makeTarget(pA, 'project', null)
  const opt = (await q(`insert into public.booking_options (project_id, target_id, kind, status, pass_scope, pass_validity, pass_valid_to, pass_entries)
      values ($1, $2, 'pass', 'active', 'all_courses', 'fixed_end', '2099-12-31', 2) returning id`, [pA, PT])).rows[0].id
  const pb = await book(pA, payload(PT, { optionId: opt, passes: [{ option_id: opt, scope: 'all_courses', valid_from: '2099-07-01', valid_to: '2099-12-31', entries_total: 2 }] }))
  const passId = (await q(`select id from public.booking_passes where booking_id = $1`, [pb.booking_id])).rows[0].id
  const at1 = await attend(pA, passId, PC.occ[0])
  check('pass attend takes a place', at1.replayed === false && (await activeCount(PC.occ[0])) === 1)
  const at1b = await attend(pA, passId, PC.occ[0])
  check('pass attend replay', at1b.replayed === true && (await activeCount(PC.occ[0])) === 1)
  await attend(pA, passId, PC.occ[1])
  await expectError('third entry refused: no_entries_left', () => q('select public.reservations_pass_attend($1,$2,$3)', [pA, passId, PC.occ[2]]), 'no_entries_left')
  const wd = await withdraw(pA, passId, PC.occ[1], true)
  check('withdraw returns the entry', wd.entry_returned === true && (await activeCount(PC.occ[1])) === 0, JSON.stringify(wd))
  const at3 = await attend(pA, passId, PC.occ[2])
  check('entry can be used again after withdraw', at3.replayed === false)

  // ── Cross-project refusals ────────────────────────────────────────────────
  await expectError('other project: target_not_found', () => book(pB, payload(T, { sessions: [C.occ[0]] })), 'target_not_found')
  const c2 = await makeCourse(pB, { sessions: 1, firstDay: '2099-08-03' })
  const t2 = await makeTarget(pB, 'course', c2.course)
  await expectError('other project: session_not_bookable', () => book(pB, payload(t2, { sessions: [C.occ[0]] })), 'session_not_bookable')
  await expectError('other project: pass_not_found', () => q('select public.reservations_pass_attend($1,$2,$3)', [pB, passId, c2.occ[0]]), 'pass_not_found')
  await expectError('other project: confirm -> booking_not_found', () => q('select public.reservations_confirm($1,$2)', [pB, a.booking_id]), 'booking_not_found')
  await expectError('other project: release -> booking_not_found', () => q(`select public.reservations_release($1,$2,'cancelled')`, [pB, a.booking_id]), 'booking_not_found')
  await expectError('other project: set_places -> session_not_found', () => q('select public.reservations_set_places($1,$2,5)', [pB, C.occ[0]]), 'session_not_found')

  // ── Activity written ──────────────────────────────────────────────────────
  const acts = (await q(`select action, count(*)::int n from public.booking_activity where project_id = $1 group by 1`, [pA])).rows
  const total = acts.reduce((s, r) => s + r.n, 0)
  check('activity rows written', total > 0 && acts.length >= 2, `${total} rows, actions: ${acts.map((r) => r.action).join(', ')}`)

  // ── Privileges ────────────────────────────────────────────────────────────
  const fns = (await q(`select p.oid::regprocedure::text sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'reservations\\_%'`)).rows
  let bad = 0
  for (const { sig } of fns) {
    const p = (await q(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') s`, [sig])).rows[0]
    if (p.a || p.b || !p.s) bad++
  }
  check('all reservations_* functions: service_role only', fns.length >= 15 && bad === 0, `${fns.length} functions`)
  await expectError('service_role cannot delete bookings', () => q('delete from public.bookings'), '42501')
  await expectError('activity is append-only', () => q(`update public.booking_activity set action = 'x.y'`), '42501')
} catch (e) {
  check('rehearsal ran', false, e.message)
} finally {
  await q('rollback').catch(() => {})
  const left = (await q(`select (select count(*)::int from public.tenants where slug = $1) tn, (select count(*)::int from public.bookings) bk, (select count(*)::int from public.reservable_targets) rt, (select count(*)::int from public.booking_activity) ba`, [SLUG])).rows[0]
  check('nothing left behind', left.tn === 0 && left.bk === 0 && left.rt === 0 && left.ba === 0, `tenants ${left.tn}, bookings ${left.bk}, reservable_targets ${left.rt}, activity ${left.ba}`)
  await c.end()
}

// API roles over the Data API (PostgREST): the new tables and functions are server-only.
const base = env.NEXT_PUBLIC_SUPABASE_URL
const refused = (s) => s === 401 || s === 403 || s === 404
for (const table of ['bookings', 'reservable_targets', 'booking_passes', 'booking_activity', 'booking_payments']) {
  for (const [role, key, expectBlocked] of [['anon', env.NEXT_PUBLIC_SUPABASE_ANON_KEY, true], ['service_role', env.SUPABASE_SERVICE_ROLE_KEY, false]]) {
    const res = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    check(`${role} via the API on ${table} ${expectBlocked ? 'is refused' : 'can read'}`, refused(res.status) === expectBlocked, `HTTP ${res.status}`)
  }
}
for (const fn of ['reservations_book', 'reservations_confirm']) {
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' })
  check(`anon POST /rpc/${fn} is refused`, refused(res.status), `HTTP ${res.status}`)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)
