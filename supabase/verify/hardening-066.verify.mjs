/**
 * Migration 066 — Reservations core (ADR-044). Proves, against a real Postgres
 * with the scheduling chain (043 → 044 → 064 → 065) applied:
 *  - server-only: RLS on, no policies, anon / a signed-in user reach nothing;
 *    service_role reads and writes but can never DELETE; activity is append-only;
 *  - places: all-or-nothing booking, AB409 with the full sessions, idempotent
 *    retries, two clients racing for the last place → exactly one wins;
 *  - holds: count while valid, stop counting the moment they expire, come back
 *    on confirm only if there is room (else payment_review);
 *  - passes (D9): "I'm coming" takes a place against the pass, respects places,
 *    scope, validity and entries; withdrawing gives the entry back when asked;
 *  - payments: several per booking; paid in full confirms a waiting booking;
 *  - isolation: another project's ids are refused everywhere;
 *  - rollback-066 restores the catalog exactly and refuses once data exists.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const ROLLBACK = path.join(__dirname, 'rollback-066.sql')
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql',
  '043_event_scheduling.sql', '044_event_scheduling_conflict_code.sql', '064_course_schedules.sql',
  '065_occurrence_place_override.sql']

let client, connectionString
let n = 0
const uid = () => crypto.randomUUID()
async function reset() { await client.query('select public.reset_session_auth()') }
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function sq(sql, params) { await client.query(`select public.set_session_auth(null, 'service_role')`); try { return await q(sql, params) } finally { await reset() } }
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const book = (projectId, payload) => sq('select public.reservations_book($1, $2::jsonb) as r', [projectId, JSON.stringify(payload)]).then((r) => r[0].r)
const attend = (projectId, passId, occ) => sq('select public.reservations_pass_attend($1, $2, $3) as r', [projectId, passId, occ]).then((r) => r[0].r)
const withdraw = (projectId, passId, occ, ret) => sq('select public.reservations_pass_withdraw($1, $2, $3, $4) as r', [projectId, passId, occ, ret]).then((r) => r[0].r)

async function catalog() {
  const parts = await Promise.all([
    q(`select c.relname, c.relkind, coalesce(array_to_string(c.relacl, ','), '') as acl, c.relrowsecurity
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','S','i','p') order by 1`),
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`),
    q(`select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal order by 1, 2`),
  ])
  return JSON.stringify(parts)
}

// ── Fixtures (inserted as the superuser) ─────────────────────────────────────
async function makeProject(slug) {
  const t = (await q(`insert into public.tenants (slug, display_name) values ($1, $1) returning id`, [slug]))[0].id
  return (await q(`insert into public.projects (slug, tenant_id, name) values ($1, $2, $1) returning id`, [slug, t]))[0].id
}
async function makeCourse(projectId, { sessions = 3, firstDay = '2026-12-01' } = {}) {
  const course = uid()
  const series = (await q(`insert into public.event_series (project_id, event_public_id, owner_type, owner_public_id, time_zone, start_local, end_local)
      values ($1, null, 'course', $2, 'Europe/Brussels', ($3::date + time '18:30'), ($3::date + time '20:00')) returning id`,
    [projectId, course, firstDay]))[0].id
  const occ = []
  for (let i = 0; i < sessions; i++) {
    occ.push((await q(`insert into public.event_occurrences (series_id, project_id, event_public_id, owner_type, owner_public_id,
        start_local, end_local, time_zone, starts_at, ends_at)
      values ($1, $2, null, 'course', $3, ($4::date + $5 * interval '7 day' + time '18:30'), ($4::date + $5 * interval '7 day' + time '20:00'),
        'Europe/Brussels', ($4::date + $5 * interval '7 day' + time '17:30') at time zone 'UTC', ($4::date + $5 * interval '7 day' + time '19:00') at time zone 'UTC')
      returning id`, [series, projectId, course, firstDay, i]))[0].id)
  }
  return { course, series, occ }
}
async function makeTarget(projectId, ownerType, ownerId, { places = null, open = true, maxPasses = null } = {}) {
  return (await q(`insert into public.reservable_targets (project_id, owner_type, owner_public_id, registration_status, default_places, max_passes)
      values ($1, $2, $3, $4, $5, $6) returning id`, [projectId, ownerType, ownerId, open ? 'open' : 'closed', places, maxPasses]))[0].id
}
async function makeOption(projectId, targetId, kind, extra = {}) {
  const cols = { project_id: projectId, target_id: targetId, kind, status: 'active', ...extra }
  const keys = Object.keys(cols)
  return (await q(`insert into public.booking_options (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
    Object.values(cols)))[0].id
}
const ref = () => `T-${(++n).toString(36).toUpperCase().padStart(4, 'A')}`.replace(/[^A-Z0-9-]/g, 'X')
function payload(targetId, { attendees = 1, sessions = [], status = 'confirmed', hold = null, key = uid(), total = 0, passes = [], optionId, source = 'website' } = {}) {
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

let P, P2, C, T
beforeAll(async () => {
  ;({ client, connectionString } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  globalThis.__before066 = await catalog()
  await applyMigrationFile(client, MIG('066_reservations.sql'))
  P = await makeProject('resv-a')
  P2 = await makeProject('resv-b')
  C = await makeCourse(P)
  T = await makeTarget(P, 'course', C.course, { places: 3 })
}, 170_000)
afterAll(async () => { await stopHarness(client) })

describe('066 — server-only access', () => {
  const tables = ['reservation_settings', 'reservable_targets', 'session_capacity', 'price_categories', 'booking_options',
    'booking_option_prices', 'booking_option_session_prices', 'bookings', 'booking_attendees', 'booking_passes',
    'booking_allocations', 'booking_lines', 'booking_payments', 'booking_refunds', 'booking_activity',
    'reservation_outbox', 'booking_link_attempts']
  it('anon and a signed-in user reach no table and no function', async () => {
    for (const t of tables) {
      for (const role of ['anon', 'authenticated']) {
        const r = await q(`select has_table_privilege($1, $2, 'select') s, has_table_privilege($1, $2, 'insert') i, has_table_privilege($1, $2, 'update') u`, [role, `public.${t}`])
        expect(r[0], `${role} on ${t}`).toEqual({ s: false, i: false, u: false })
      }
    }
    const fns = await q(`select p.oid::regprocedure::text sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'reservations\\_%'`)
    expect(fns.length).toBeGreaterThanOrEqual(15)
    for (const { sig } of fns) {
      const r = await q(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') s`, [sig])
      expect(r[0], sig).toEqual({ a: false, b: false, s: true })
    }
  })
  it('service_role can never delete; activity is append-only', async () => {
    for (const t of tables) {
      const r = await q(`select has_table_privilege('service_role', $1, 'delete') d`, [`public.${t}`])
      expect(r[0].d, t).toBe(false)
    }
    const e = await errOf(() => sq(`update public.booking_activity set action = 'x.y'`))
    expect(e?.code).toBe('42501')
  })
  it('a signed-in user cannot call the booking function', async () => {
    const u = uid()
    await q(`insert into auth.users (id) values ($1)`, [u])
    await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [u])
    const e = await errOf(() => client.query('select public.reservations_book($1, $2::jsonb)', [P, '{}']))
    expect(e?.code).toBe('42501')
  })
})

describe('066 — places (D3)', () => {
  it('books all or nothing and reports the full sessions', async () => {
    const r1 = await book(P, payload(T, { attendees: 2, sessions: [C.occ[0], C.occ[1]] }))
    expect(r1.replayed).toBe(false)
    // 3 places, 2 taken on occ[0] and occ[1]: 2 more attendees do not fit on either.
    const e = await errOf(() => book(P, payload(T, { attendees: 2, sessions: [C.occ[0], C.occ[2]] })))
    expect(e?.code).toBe('AB409')
    expect(JSON.parse(e.detail)).toEqual([C.occ[0]])
    // Nothing of the refused booking was written (occ[2] still empty).
    const c2 = await q(`select public.reservations_active_count($1) n`, [C.occ[2]])
    expect(c2[0].n).toBe(0)
    const r2 = await book(P, payload(T, { attendees: 1, sessions: [C.occ[0]] }))
    expect(r2.booking_id).toBeTruthy()
    const e2 = await errOf(() => book(P, payload(T, { attendees: 1, sessions: [C.occ[0]] })))
    expect(e2?.code).toBe('AB409')
  })
  it('a retry with the same key returns the same booking', async () => {
    const p = payload(T, { sessions: [C.occ[2]] })
    const a = await book(P, p)
    const b = await book(P, { ...p, reference: ref() })
    expect(b).toEqual({ ...a, replayed: true })
  })
  it('refuses a total that does not match the lines', async () => {
    const p = payload(T, { sessions: [C.occ[2]], total: 1000 })
    p.total_cents = 999
    expect((await errOf(() => book(P, p)))?.message).toMatch('total_mismatch')
  })
  it('refuses closed registration on the website, allows the dashboard', async () => {
    const c = await makeCourse(P)
    const t = await makeTarget(P, 'course', c.course, { open: false })
    expect((await errOf(() => book(P, payload(t, { sessions: [c.occ[0]] }))))?.message).toMatch('registration_closed')
    expect((await book(P, payload(t, { sessions: [c.occ[0]], source: 'dashboard' }))).booking_id).toBeTruthy()
  })
  it('two clients racing for the last place: exactly one wins', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course, { places: 1 })
    const mk = async () => { const k = new pg.Client({ connectionString }); await k.connect(); await k.query(`select public.set_session_auth(null, 'service_role')`); return k }
    const [k1, k2] = await Promise.all([mk(), mk()])
    try {
      await k1.query('begin'); await k2.query('begin')
      const p1 = k1.query('select public.reservations_book($1, $2::jsonb)', [P, JSON.stringify(payload(t, { sessions: [c.occ[0]] }))])
      await p1
      const p2 = k2.query('select public.reservations_book($1, $2::jsonb)', [P, JSON.stringify(payload(t, { sessions: [c.occ[0]] }))])
        .then(() => 'ok', (e) => e.code)
      await new Promise((r) => setTimeout(r, 300)) // k2 is now waiting on the place row lock
      await k1.query('commit')
      expect(await p2).toBe('AB409')
      await k2.query('rollback')
    } finally { await k1.end(); await k2.end() }
    expect((await q(`select public.reservations_active_count($1) n`, [c.occ[0]]))[0].n).toBe(1)
  })
  it('places cannot drop below active ones without force', async () => {
    const e = await errOf(() => sq('select public.reservations_set_places($1, $2, 1)', [P, C.occ[0]]))
    expect(e?.code).toBe('AB409')
    await sq('select public.reservations_set_places($1, $2, 1, true)', [P, C.occ[0]])
    expect((await q(`select count(*)::int n from public.booking_activity where action = 'capacity.forced_below_active'`))[0].n).toBe(1)
    await sq('select public.reservations_set_places($1, $2, 3, false)', [P, C.occ[0]])
  })
})

describe('066 — holds and payments (D5, D6)', () => {
  it('a valid hold counts, an expired one stops counting at once', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course, { places: 1 })
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const h = await book(P, payload(t, { sessions: [c.occ[0]], status: 'awaiting_payment', hold: soon, total: 5000 }))
    expect((await errOf(() => book(P, payload(t, { sessions: [c.occ[0]] }))))?.code).toBe('AB409')
    await q(`update public.booking_allocations set expires_at = now() - interval '1 second' where booking_id = $1`, [h.booking_id])
    const other = await book(P, payload(t, { sessions: [c.occ[0]] }))
    expect(other.booking_id).toBeTruthy()
    // Paid late: no room any more → not confirmed, payment_review set.
    const r = (await sq(`select public.reservations_record_payment($1, $2, 'bank_transfer', 5000, current_date, 'BANK-123') r`, [P, h.booking_id]))[0].r
    expect(r.payment_status).toBe('paid')
    expect(r.confirm.confirmed).toBe(false)
    const b = (await q(`select status, payment_review from public.bookings where id = $1`, [h.booking_id]))[0]
    expect(b).toEqual({ status: 'awaiting_payment', payment_review: true })
  })
  it('part card, part transfer: confirmed when paid in full', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course, { places: 5 })
    const soon = new Date(Date.now() + 3600_000).toISOString()
    const h = await book(P, payload(t, { sessions: [c.occ[0]], status: 'awaiting_payment', hold: soon, total: 10000 }))
    const r1 = (await sq(`select public.reservations_record_payment($1, $2, 'cash', 4000, current_date) r`, [P, h.booking_id]))[0].r
    expect(r1.payment_status).toBe('partially_paid')
    const r2 = (await sq(`select public.reservations_record_payment($1, $2, 'bank_transfer', 6000, current_date, 'CYCE-4F7K') r`, [P, h.booking_id]))[0].r
    expect(r2.confirm.confirmed).toBe(true)
    expect((await q(`select kind from public.booking_allocations where booking_id = $1`, [h.booking_id]))[0].kind).toBe('confirmed')
    expect((await q(`select count(*)::int n from public.booking_payments where booking_id = $1`, [h.booking_id]))[0].n).toBe(2)
  })
  it('the sweep expires due holds and an expired booking can still be confirmed if there is room', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course, { places: 2 })
    const h = await book(P, payload(t, { sessions: [c.occ[0]], status: 'awaiting_payment', hold: new Date(Date.now() + 1000).toISOString() }))
    const swept = await sq(`select * from public.reservations_expire_holds(now() + interval '1 minute')`)
    expect(swept.map((r) => r.booking_id)).toContain(h.booking_id)
    expect((await q(`select status from public.bookings where id = $1`, [h.booking_id]))[0].status).toBe('expired')
    const r = (await sq(`select public.reservations_confirm($1, $2) r`, [P, h.booking_id]))[0].r
    expect(r.confirmed).toBe(true)
    expect((await q(`select released_at is null as active, kind from public.booking_allocations where booking_id = $1`, [h.booking_id]))[0])
      .toEqual({ active: true, kind: 'confirmed' })
  })
})

describe('066 — passes (D9)', () => {
  let projectTarget, passOption, passId, c
  beforeAll(async () => {
    c = await makeCourse(P, { sessions: 4, firstDay: '2026-12-07' })
    await makeTarget(P, 'course', c.course, { places: 2 })
    projectTarget = await makeTarget(P, 'project', null)
    passOption = await makeOption(P, projectTarget, 'pass', { pass_scope: 'all_courses', pass_validity: 'fixed_end', pass_valid_to: '2026-12-31', pass_entries: 2 })
    const r = await book(P, payload(projectTarget, { optionId: passOption, passes: [{ option_id: passOption, scope: 'all_courses', valid_from: '2026-12-01', valid_to: '2026-12-31', entries_total: 2 }] }))
    passId = (await q(`select id from public.booking_passes where booking_id = $1`, [r.booking_id]))[0].id
  })
  it('"I\'m coming" takes a place; a repeat is a replay', async () => {
    const a = await attend(P, passId, c.occ[0])
    expect(a.replayed).toBe(false)
    expect((await attend(P, passId, c.occ[0])).replayed).toBe(true)
    expect((await q(`select public.reservations_active_count($1) n`, [c.occ[0]]))[0].n).toBe(1)
  })
  it('entries run out, and come back when withdrawn in time', async () => {
    await attend(P, passId, c.occ[1])
    expect((await errOf(() => attend(P, passId, c.occ[2])))?.message).toMatch('no_entries_left')
    expect((await withdraw(P, passId, c.occ[1], false)).entry_returned).toBe(false)
    expect((await errOf(() => attend(P, passId, c.occ[2])))?.message).toMatch('no_entries_left')
    await attend(P, passId, c.occ[1]) // ← would be a 3rd entry: refused
      .then(() => { throw new Error('should refuse') }, (e) => { expect(e.message).toMatch('no_entries_left') })
    await reset()
  })
  it('respects places like any booking', async () => {
    const p2 = await book(P, payload(projectTarget, { passes: [{ option_id: passOption, scope: 'all_courses', valid_from: '2026-12-01', valid_to: '2026-12-31', entries_total: null }] }))
    const pass2 = (await q(`select id from public.booking_passes where booking_id = $1`, [p2.booking_id]))[0].id
    const p3 = await book(P, payload(projectTarget, { passes: [{ option_id: passOption, scope: 'all_courses', valid_from: '2026-12-01', valid_to: '2026-12-31' }] }))
    const pass3 = (await q(`select id from public.booking_passes where booking_id = $1`, [p3.booking_id]))[0].id
    await attend(P, pass2, c.occ[0]) // 2 of 2 places
    expect((await errOf(() => attend(P, pass3, c.occ[0])))?.code).toBe('AB409')
    await withdraw(P, pass2, c.occ[0], true)
    expect((await attend(P, pass3, c.occ[0])).replayed).toBe(false)
  })
  it('refuses sessions outside scope or validity, and unpaid passes', async () => {
    const late = await makeCourse(P, { sessions: 1, firstDay: '2027-01-05' })
    expect((await errOf(() => attend(P, passId, late.occ[0])))?.message).toMatch('pass_does_not_cover')
    const only = await makeOption(P, projectTarget, 'pass', { pass_scope: 'courses', pass_scope_owner_ids: [late.course], pass_validity: 'duration', pass_duration_months: 6 })
    const r = await book(P, payload(projectTarget, { passes: [{ option_id: only, scope: 'courses', scope_owner_ids: [late.course], valid_from: '2026-12-01', valid_to: '2027-05-31' }] }))
    const pid = (await q(`select id from public.booking_passes where booking_id = $1`, [r.booking_id]))[0].id
    expect((await errOf(() => attend(P, pid, c.occ[3])))?.message).toMatch('pass_does_not_cover')
    expect((await attend(P, pid, late.occ[0])).replayed).toBe(false)
    const unpaid = await book(P, payload(projectTarget, { status: 'awaiting_payment', hold: new Date(Date.now() + 3600_000).toISOString(), total: 14000,
      passes: [{ option_id: passOption, scope: 'all_courses', valid_from: '2026-12-01', valid_to: '2026-12-31' }] }))
    const up = (await q(`select id from public.booking_passes where booking_id = $1`, [unpaid.booking_id]))[0].id
    expect((await errOf(() => attend(P, up, c.occ[3])))?.message).toMatch('pass_not_active')
  })
  it('cancelling the booking cancels the pass and frees its places', async () => {
    const r = await book(P, payload(projectTarget, { passes: [{ option_id: passOption, scope: 'all_courses', valid_from: '2026-12-01', valid_to: '2026-12-31' }] }))
    const pid = (await q(`select id from public.booking_passes where booking_id = $1`, [r.booking_id]))[0].id
    await attend(P, pid, c.occ[3])
    await sq(`select public.reservations_release($1, $2, 'cancelled', null, true)`, [P, r.booking_id])
    expect((await q(`select status from public.booking_passes where id = $1`, [pid]))[0].status).toBe('cancelled')
    expect((await q(`select count(*)::int n from public.booking_allocations where pass_id = $1 and released_at is null`, [pid]))[0].n).toBe(0)
    expect((await errOf(() => attend(P, pid, c.occ[3])))?.message).toMatch('pass_not_active')
  })
  it('max_passes caps sales', async () => {
    const t = await makeTarget(P, 'course', (await makeCourse(P, { sessions: 1 })).course, { maxPasses: 1 })
    const o = await makeOption(P, t, 'pass', { pass_scope: 'target', pass_validity: 'duration', pass_duration_months: 1 })
    const pp = () => payload(t, { passes: [{ option_id: o, scope: 'target', valid_from: '2026-12-01', valid_to: '2026-12-31' }] })
    await book(P, pp())
    expect((await errOf(() => book(P, pp())))?.message).toMatch('passes_sold_out')
  })
})

describe('066 — isolation', () => {
  it("refuses another project's target, sessions, passes and bookings", async () => {
    expect((await errOf(() => book(P2, payload(T, { sessions: [C.occ[0]] }))))?.message).toMatch('target_not_found')
    const c2 = await makeCourse(P2, { sessions: 1 })
    const t2 = await makeTarget(P2, 'course', c2.course)
    expect((await errOf(() => book(P2, payload(t2, { sessions: [C.occ[0]] }))))?.message).toMatch('session_not_bookable')
    const anyPass = (await q(`select id from public.booking_passes where project_id = $1 limit 1`, [P]))[0].id
    expect((await errOf(() => attend(P2, anyPass, c2.occ[0])))?.message).toMatch('pass_not_found')
    const anyBooking = (await q(`select id from public.bookings where project_id = $1 limit 1`, [P]))[0].id
    expect((await errOf(() => sq(`select public.reservations_confirm($1, $2)`, [P2, anyBooking])))?.message).toMatch('booking_not_found')
    expect((await errOf(() => sq(`select public.reservations_release($1, $2, 'cancelled')`, [P2, anyBooking])))?.message).toMatch('booking_not_found')
    expect((await errOf(() => sq(`select public.reservations_set_places($1, $2, 5)`, [P2, C.occ[0]])))?.message).toMatch('session_not_found')
  })
  it('composite keys stop a cross-project row even for the service role', async () => {
    const e = await errOf(() => sq(`insert into public.booking_options (project_id, target_id, kind) values ($1, $2, 'drop_in')`, [P2, T]))
    expect(e?.code).toBe('23503')
  })
  it('an edition of another owner is refused', async () => {
    const ed = (await q(`insert into public.schedule_editions (project_id, owner_type, owner_public_id, starts_on, ends_on, time_zone)
        values ($1, 'course', $2, '2026-09-01', '2026-12-31', 'Europe/Brussels') returning id`, [P, uid()]))[0].id
    const e = await errOf(() => sq(`insert into public.reservable_targets (project_id, owner_type, owner_public_id, edition_id) values ($1, 'course', $2, $3)`, [P, C.course, ed]))
    expect(e?.message).toMatch('edition_owner_mismatch')
  })
})

describe('066 — retention', () => {
  it('anonymising wipes people and keeps amounts and the reference', async () => {
    const r = await book(P, payload(T, { sessions: [C.occ[2]], source: 'dashboard' }))
    await sq(`select public.reservations_anonymise_booking($1, $2)`, [P, r.booking_id])
    const b = (await q(`select purchaser_name, purchaser_email, reference, total_cents, anonymised_at is not null as anon from public.bookings where id = $1`, [r.booking_id]))[0]
    expect(b).toMatchObject({ purchaser_name: null, purchaser_email: null, reference: r.reference, anon: true })
    const a = await q(`select name, email from public.booking_attendees where booking_id = $1`, [r.booking_id])
    expect(a.every((x) => x.name === null && x.email === null)).toBe(true)
  })
})


describe('066 — review fixes (2026-11-07)', () => {
  it('extending a lapsed hold never overbooks', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course, { places: 1 })
    const h = await book(P, payload(t, { sessions: [c.occ[0]], status: 'awaiting_payment', hold: new Date(Date.now() + 3600_000).toISOString() }))
    await q(`update public.booking_allocations set expires_at = now() - interval '1 second' where booking_id = $1`, [h.booking_id])
    await book(P, payload(t, { sessions: [c.occ[0]] }))
    const e = await errOf(() => sq(`select public.reservations_extend_hold($1, $2, now() + interval '2 days')`, [P, h.booking_id]))
    expect(e?.code).toBe('AB409')
    expect((await q(`select public.reservations_active_count($1) n`, [c.occ[0]]))[0].n).toBe(1)
  })
  it('bookings creating place rows for the same new sessions in opposite order do not deadlock', async () => {
    const mk = async () => { const k = new pg.Client({ connectionString }); await k.connect(); await k.query(`select public.set_session_auth(null, 'service_role')`); return k }
    const [k1, k2] = await Promise.all([mk(), mk()])
    const codes = []
    try {
      for (let i = 0; i < 15; i++) {
        const c = await makeCourse(P, { sessions: 3 })
        const t = await makeTarget(P, 'course', c.course, { places: 5 })
        const run = (k, occ) => k.query('select public.reservations_book($1, $2::jsonb)', [P, JSON.stringify(payload(t, { sessions: occ }))])
          .then(() => 'ok', (e) => e.code)
        codes.push(...await Promise.all([run(k1, [c.occ[2], c.occ[1], c.occ[0]]), run(k2, [c.occ[0], c.occ[1], c.occ[2]])]))
      }
    } finally { await k1.end(); await k2.end() }
    expect(codes.every((x) => x === 'ok')).toBe(true)
  })
  it('a row that contradicts itself is refused even for the service role', async () => {
    const c = await makeCourse(P, { sessions: 2 })
    const t = await makeTarget(P, 'course', c.course)
    const r1 = await book(P, payload(t, { sessions: [c.occ[0]] }))
    const r2 = await book(P, payload(t, { sessions: [c.occ[0]] }))
    const att1 = (await q(`select id from public.booking_attendees where booking_id = $1`, [r1.booking_id]))[0].id
    const att2 = (await q(`select id from public.booking_attendees where booking_id = $1`, [r2.booking_id]))[0].id
    const cap0 = (await q(`select id from public.session_capacity where occurrence_id = $1`, [c.occ[0]]))[0].id
    const ins = (b, a, o, cap) => errOf(() => sq(`insert into public.booking_allocations (project_id, booking_id, attendee_id, occurrence_id, capacity_id, kind)
       values ($1, $2, $3, $4, $5, 'confirmed')`, [P, b, a, o, cap]))
    expect((await ins(r1.booking_id, att2, c.occ[1], cap0))?.code).toBe('23503') // attendee of another booking
    const e1 = await ins(r1.booking_id, att1, c.occ[1], cap0)                   // place row of another session
    expect(e1?.code).toBe('23503')
  })
  it('a later change of the target default applies to existing place rows', async () => {
    const c = await makeCourse(P, { sessions: 1 })
    await sq('select public.reservations_set_places($1, $2, null)', [P, c.occ[0]]) // row created before any target
    const t = await makeTarget(P, 'course', c.course, { places: null })
    await book(P, payload(t, { sessions: [c.occ[0]] }))
    await q(`update public.reservable_targets set default_places = 1 where id = $1`, [t])
    expect((await errOf(() => book(P, payload(t, { sessions: [c.occ[0]] }))))?.code).toBe('AB409')
    await sq('select public.reservations_set_places($1, $2, null, false, null, true)', [P, c.occ[0]]) // unlimited on this date
    expect((await book(P, payload(t, { sessions: [c.occ[0]] }))).booking_id).toBeTruthy()
  })
  it("refuses 'pending', mismatched line amounts and invented pass terms", async () => {
    const c = await makeCourse(P, { sessions: 1 })
    const t = await makeTarget(P, 'course', c.course)
    expect((await errOf(() => book(P, payload(t, { sessions: [c.occ[0]], status: 'pending' }))))?.message).toMatch('invalid_status')
    const p = payload(t, { sessions: [c.occ[0]], total: 1000 }); p.lines[0].unit_cents = 900
    expect((await errOf(() => book(P, p)))?.code).toBe('23514')
    const pt = await makeTarget(P, 'project', null).catch(() => null)
      ?? (await q(`select id from public.reservable_targets where project_id = $1 and owner_type = 'project'`, [P]))[0].id
    const o = await makeOption(P, pt, 'pass', { pass_scope: 'all_courses', pass_validity: 'duration', pass_duration_months: 1, pass_entries: 3 })
    const r = await book(P, payload(pt, { passes: [{ option_id: o, scope: 'courses', scope_owner_ids: [uid()], valid_from: '2026-12-01', valid_to: '2026-12-31', entries_total: 99 }] }))
    expect((await q(`select scope, scope_owner_ids, entries_total from public.booking_passes where booking_id = $1`, [r.booking_id]))[0])
      .toEqual({ scope: 'all_courses', scope_owner_ids: null, entries_total: 3 })
    const tooLong = await errOf(() => book(P, payload(pt, { passes: [{ option_id: o, valid_from: '2026-12-01', valid_to: '2027-01-02' }] })))
    expect(tooLong?.message).toMatch('pass_dates_invalid')
    // Month-end start: 31 Jan + 1 month ends on 28 Feb (domain passValidity), accepted.
    const me = await book(P, payload(pt, { passes: [{ option_id: o, valid_from: '2027-01-31', valid_to: '2027-02-28' }] }))
    expect(me.booking_id).toBeTruthy()
  })
})

describe('066 — rollback', () => {
  it('refuses while data exists, then restores the catalog exactly', async () => {
    const e = await errOf(() => applyMigrationFile(client, ROLLBACK))
    expect(e?.message).toMatch('reservation data exists')
    await client.query(`set session_replication_role = replica`)
    for (const t of ['booking_activity', 'reservation_outbox', 'booking_payments', 'booking_refunds', 'booking_lines', 'booking_allocations',
      'booking_passes', 'booking_attendees', 'bookings', 'booking_option_prices', 'booking_option_session_prices', 'booking_options',
      'price_categories', 'session_capacity', 'reservable_targets', 'reservation_settings', 'booking_link_attempts']) {
      await client.query(`delete from public.${t}`)
    }
    await client.query(`set session_replication_role = origin`)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(globalThis.__before066)
    await applyMigrationFile(client, MIG('066_reservations.sql'))
    expect((await errOf(() => applyMigrationFile(client, MIG('066_reservations.sql'))))?.message).toMatch('already applied')
  })
})
