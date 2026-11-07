import { describe, expect, it } from 'vitest'
import { createSupabaseReservationStore } from '../store'
import { fakeDb, opsOf, type Call } from './fake-db'

const P = '00000000-0000-4000-8000-00000000000a'
const B = '33333333-3333-4333-8333-333333333333'
const O1 = '22222222-2222-4222-8222-222222222221'
const O2 = '22222222-2222-4222-8222-222222222222'
const HASH = 'ab'.repeat(32)
const rpcCalls = (calls: Call[]) => calls.filter((c): c is Extract<Call, { kind: 'rpc' }> => c.kind === 'rpc')
const hasProjectEq = (c: Call) => opsOf(c, 'eq').some(([k, v]) => k === 'project_id' && v === P)

describe('write methods call the right function with project_id', () => {
  it('book: builds the payload and calls reservations_book', async () => {
    const { db, calls } = fakeDb({ data: { booking_id: B, reference: 'T-AAAA', replayed: false } })
    const r = await createSupabaseReservationStore(db).book(P, {
      targetId: '11111111-1111-4111-8111-111111111111', attendees: [{ key: 'a0' }], sessions: [{ attendeeKey: 'a0', occurrenceId: O1 }],
      lines: [], totalCents: 0, status: 'confirmed', idempotencyKey: 'idem-12345678', reference: 'CYCE-7K2MQ', locale: 'it', source: 'website',
    })
    expect(r).toEqual({ ok: true, value: { bookingId: B, reference: 'T-AAAA', replayed: false } })
    const [c] = rpcCalls(calls)
    expect(c.fn).toBe('reservations_book')
    expect(c.args.p_project_id).toBe(P)
    expect(c.args.p_payload).toMatchObject({ idempotency_key: 'idem-12345678', total_cents: 0 })
  })
  it('book: a bad request is refused locally, no round trip', async () => {
    const { db, calls } = fakeDb()
    const r = await createSupabaseReservationStore(db).book(P, {
      targetId: 'x', attendees: [{ key: 'a0' }], sessions: [{ attendeeKey: 'a0', occurrenceId: O1 }],
      lines: [], totalCents: 5, status: 'confirmed', idempotencyKey: 'idem-12345678', reference: 'CYCE-7K2MQ', locale: 'it', source: 'website',
    })
    expect(r).toEqual({ ok: false, error: { kind: 'refused', code: 'total_mismatch', detail: '0 != 5' } })
    expect(calls).toHaveLength(0)
  })
  it('book: AB409 full comes back as a value, not a throw', async () => {
    const { db } = fakeDb({ error: { code: 'AB409', message: 'reservations: full', details: `["${O1}"]` } })
    const r = await createSupabaseReservationStore(db).book(P, { project: 'x' } as never)
    expect(r).toEqual({ ok: false, error: { kind: 'full', occurrenceIds: [O1] } })
  })

  const cases: Array<[string, (s: ReturnType<typeof createSupabaseReservationStore>) => Promise<unknown>, string, Record<string, unknown>]> = [
    ['passAttend', (s) => s.passAttend(P, B, O1), 'reservations_pass_attend', { p_pass_id: B, p_occurrence_id: O1, p_allow_over_capacity: false, p_actor: { kind: 'participant', id: null } }],
    ['passWithdraw', (s) => s.passWithdraw(P, B, O1, { returnEntry: true }), 'reservations_pass_withdraw', { p_pass_id: B, p_occurrence_id: O1, p_return_entry: true }],
    ['release', (s) => s.release(P, B, 'absence', { occurrenceIds: [O1, O2] }), 'reservations_release', { p_booking_id: B, p_reason: 'absence', p_occurrence_ids: [O1, O2], p_cancel_booking: false, p_note: null }],
    ['confirm', (s) => s.confirm(P, B, { kind: 'user', id: 'u1' }), 'reservations_confirm', { p_booking_id: B, p_actor: { kind: 'user', id: 'u1' } }],
    ['extendHold', (s) => s.extendHold(P, B, new Date('2026-12-01T00:00:00Z')), 'reservations_extend_hold', { p_booking_id: B, p_until: '2026-12-01T00:00:00.000Z' }],
    ['recordPayment', (s) => s.recordPayment(P, B, { method: 'bank_transfer', amountCents: 5000, paidOn: '2026-11-07', reference: 'X' }), 'reservations_record_payment', { p_booking_id: B, p_method: 'bank_transfer', p_amount_cents: 5000, p_paid_on: '2026-11-07', p_reference: 'X', p_note: null }],
    ['setPlaces', (s) => s.setPlaces(P, O1, 12, { force: true }), 'reservations_set_places', { p_occurrence_id: O1, p_places: 12, p_force: true }],
    ['anonymiseBooking', (s) => s.anonymiseBooking(P, B), 'reservations_anonymise_booking', { p_booking_id: B }],
    ['reserveLinkAttempt', (s) => s.reserveLinkAttempt(P, HASH, 600, 5), 'reservations_reserve_link_attempt', { p_ip_hash: HASH, p_window_seconds: 600, p_per_ip: 5 }],
  ]
  for (const [name, run, fn, args] of cases) {
    it(`${name} -> ${fn}`, async () => {
      const { db, calls } = fakeDb({ data: {} })
      await run(createSupabaseReservationStore(db))
      const [c] = rpcCalls(calls)
      expect(c.fn).toBe(fn)
      expect(c.args).toMatchObject({ p_project_id: P, ...args })
    })
  }

  it('setPlaces null = unlimited', async () => {
    const { db, calls } = fakeDb({ data: { capacity_id: B, places: null, active: 2 } })
    const r = await createSupabaseReservationStore(db).setPlaces(P, O1, null)
    expect(rpcCalls(calls)[0].args.p_places).toBeNull()
    expect(r).toEqual({ ok: true, value: { capacityId: B, places: null, active: 2 } })
  })
  it('expireHolds and finishLinkAttempt (no project argument by design)', async () => {
    const a = fakeDb({ data: [{ booking_id: B, project_id: P }] })
    expect(await createSupabaseReservationStore(a.db).expireHolds(new Date('2026-11-07T00:00:00Z'))).toEqual({ ok: true, value: [{ bookingId: B, projectId: P }] })
    expect(rpcCalls(a.calls)[0]).toMatchObject({ fn: 'reservations_expire_holds', args: { p_now: '2026-11-07T00:00:00.000Z' } })
    const b = fakeDb()
    await createSupabaseReservationStore(b.db).finishLinkAttempt(7, true)
    expect(rpcCalls(b.calls)[0]).toMatchObject({ fn: 'reservations_finish_link_attempt', args: { p_attempt_id: 7, p_succeeded: true } })
  })
  it('maps results: confirm full, record payment, link attempt row', async () => {
    const c = fakeDb({ data: { confirmed: false, full: [O1] } })
    expect(await createSupabaseReservationStore(c.db).confirm(P, B)).toEqual({ ok: true, value: { confirmed: false, replayed: false, full: [O1] } })
    const p = fakeDb({ data: { payment_id: B, payment_status: 'paid', confirm: { confirmed: true, replayed: false } } })
    expect(await createSupabaseReservationStore(p.db).recordPayment(P, B, { method: 'cash', amountCents: 1, paidOn: '2026-11-07' })).toMatchObject({
      ok: true, value: { paymentId: B, paymentStatus: 'paid', confirm: { confirmed: true } },
    })
    const l = fakeDb({ data: [{ allowed: false, attempt_id: null, retry_after_seconds: 600 }] })
    expect(await createSupabaseReservationStore(l.db).reserveLinkAttempt(P, HASH, 600, 5)).toEqual({ ok: true, value: { allowed: false, attemptId: null, retryAfterSeconds: 600 } })
  })
  it('error kinds from every write', async () => {
    const s = (error: { code: string; message: string }) => createSupabaseReservationStore(fakeDb({ error }).db)
    expect(await s({ code: 'P0002', message: 'reservations: booking_not_found' }).confirm(P, B)).toEqual({ ok: false, error: { kind: 'not_found', code: 'booking_not_found' } })
    expect(await s({ code: 'AB422', message: 'reservations: cannot_extend' }).extendHold(P, B, new Date())).toEqual({ ok: false, error: { kind: 'refused', code: 'cannot_extend' } })
    expect(await s({ code: 'AB409', message: 'reservations: places_below_active' }).setPlaces(P, O1, 1)).toMatchObject({ ok: false, error: { kind: 'conflict', code: 'places_below_active' } })
  })
})

describe('unavailable degradation (066 not applied)', () => {
  const missingFn = { code: 'PGRST202', message: 'Could not find the function public.reservations_confirm' }
  const missingTable = { code: '42P01', message: 'relation "public.reservation_settings" does not exist' }
  it('rpc and reads answer unavailable, never throw', async () => {
    const s = createSupabaseReservationStore(fakeDb({ error: missingFn }).db)
    expect(await s.confirm(P, B)).toEqual({ ok: false, error: { kind: 'unavailable' } })
    const t = createSupabaseReservationStore(fakeDb({ error: missingTable }).db)
    expect(await t.getSettings(P)).toEqual({ ok: false, error: { kind: 'unavailable' } })
    expect(await t.sessionAvailability(P, [O1])).toEqual({ ok: false, error: { kind: 'unavailable' } })
    expect(await t.listOptions(P, B)).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
  it('a client that throws (network) is unavailable too', async () => {
    const db = { rpc: () => { throw new Error('fetch failed') }, from: () => { throw new Error('fetch failed') } }
    const s = createSupabaseReservationStore(db)
    expect(await s.confirm(P, B)).toEqual({ ok: false, error: { kind: 'unavailable' } })
    expect(await s.getSettings(P)).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})

describe('reads filter by project_id', () => {
  it('getSettings / getTarget / getBookingByReference', async () => {
    const { db, calls } = fakeDb({ data: [] })
    const s = createSupabaseReservationStore(db)
    expect(await s.getSettings(P)).toEqual({ ok: true, value: null })
    expect(await s.getTarget(P, 'course', O1, null)).toEqual({ ok: true, value: null })
    await s.getTarget(P, 'project', null)
    await s.getBookingByReference(P, 'CYCE-7K2MQ')
    const from = calls.filter((c) => c.kind === 'from')
    expect(from.map((c) => (c as { table: string }).table)).toEqual(['reservation_settings', 'reservable_targets', 'reservable_targets', 'bookings'])
    for (const c of from) expect(hasProjectEq(c)).toBe(true)
    // project target: owner_public_id is null; course target: removed rows excluded
    expect(opsOf(from[2], 'is')).toContainEqual(['owner_public_id', null])
    expect(opsOf(from[1], 'is')).toContainEqual(['removed_at', null])
    expect(opsOf(from[3], 'eq')).toContainEqual(['reference', 'CYCE-7K2MQ'])
  })
  it('getTarget parses a row', async () => {
    const { db } = fakeDb({ data: [{ id: B, project_id: P, owner_type: 'course', owner_public_id: O1, edition_id: null, registration_status: 'open', default_places: 12, version: 3, rules_override: null }] })
    const r = await createSupabaseReservationStore(db).getTarget(P, 'course', O1)
    expect(r).toMatchObject({ ok: true, value: { id: B, projectId: P, registrationStatus: 'open', defaultPlaces: 12, maxPasses: null, version: 3 } })
  })
  it('listOptions: active by default, prices fetched with project_id', async () => {
    const { db, calls } = fakeDb((c) => c.kind === 'from' && c.table === 'booking_options'
      ? { data: [{ id: O1, project_id: P, target_id: B, kind: 'full_edition', label: { en: 'Term' }, status: 'active', sort: 0 }] }
      : { data: [{ id: 'p1', option_id: O1, amount_cents: 12000, price_category_id: null, valid_from: null }] })
    const r = await createSupabaseReservationStore(db).listOptions(P, B)
    expect(r).toMatchObject({ ok: true, value: [{ id: O1, kind: 'full_edition', prices: [{ amountCents: 12000, optionId: O1 }] }] })
    const from = calls.filter((c) => c.kind === 'from')
    expect(from.map((c) => (c as { table: string }).table)).toEqual(['booking_options', 'booking_option_prices'])
    for (const c of from) expect(hasProjectEq(c)).toBe(true)
    expect(opsOf(from[0], 'eq')).toContainEqual(['status', 'active'])
    const all = fakeDb({ data: [] })
    await createSupabaseReservationStore(all.db).listOptions(P, B, { status: 'all' })
    expect(opsOf(all.calls[0], 'neq')).toContainEqual(['status', 'archived'])
  })
  it('token-hash lookups are not project-scoped, return project_id, and refuse malformed hashes without a query', async () => {
    const { db, calls } = fakeDb({ data: [{ id: B, project_id: P, target_id: B, reference: 'T-AAAA', status: 'confirmed', payment_status: 'paid', locale: 'en', source: 'website', total_cents: 0, created_at: '2026-11-07T00:00:00Z', version: 1 }] })
    const s = createSupabaseReservationStore(db)
    const r = await s.getBookingByTokenHash(HASH)
    expect(r).toMatchObject({ ok: true, value: { projectId: P, reference: 'T-AAAA' } })
    expect(opsOf(calls[0], 'eq')).toEqual([['management_token_hash', HASH]])
    expect(await s.getBookingByTokenHash('nope')).toEqual({ ok: true, value: null })
    expect(await s.getPassByTokenHash('nope')).toEqual({ ok: true, value: null })
    expect(calls).toHaveLength(1)
    const p = fakeDb({ data: [{ id: B, project_id: P, booking_id: B, attendee_id: B, option_id: B, target_id: B, scope: 'all_courses', valid_from: '2026-11-01', valid_to: '2027-01-01', status: 'active' }] })
    expect(await createSupabaseReservationStore(p.db).getPassByTokenHash(HASH)).toMatchObject({ ok: true, value: { projectId: P, scope: 'all_courses', entriesTotal: null } })
  })
})

describe('sessionAvailability', () => {
  const NOW = new Date('2026-11-07T12:00:00Z')
  it('counts like reservations_active_count and filters by project_id', async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.kind === 'from' && c.table === 'session_capacity') return { data: [{ occurrence_id: O1, places: 3 }] }
      return {
        data: [
          { occurrence_id: O1, kind: 'confirmed', expires_at: null },
          { occurrence_id: O1, kind: 'pass_attendance', expires_at: null },
          { occurrence_id: O1, kind: 'hold', expires_at: '2026-11-08T00:00:00+00:00' }, // live hold
          { occurrence_id: O1, kind: 'hold', expires_at: '2026-11-07T11:00:00+00:00' }, // lapsed hold
          { occurrence_id: O2, kind: 'confirmed', expires_at: null },
        ],
      }
    })
    const r = await createSupabaseReservationStore(db).sessionAvailability(P, [O1, O2, O1], { now: NOW, defaultPlaces: 10 })
    expect(r).toEqual({
      ok: true,
      value: [
        { occurrenceId: O1, places: 3, active: 3 },
        { occurrenceId: O2, places: 10, active: 1 }, // no place row yet: target default
      ],
    })
    const from = calls.filter((c) => c.kind === 'from')
    expect(from.map((c) => (c as { table: string }).table)).toEqual(['session_capacity', 'booking_allocations'])
    for (const c of from) expect(hasProjectEq(c)).toBe(true)
    expect(opsOf(from[1], 'is')).toContainEqual(['released_at', null])
    expect(opsOf(from[1], 'or')).toContainEqual([`kind.neq.hold,expires_at.gt.${NOW.toISOString()}`])
  })
  it('unlimited places stay null; empty input needs no query; bad ids are refused', async () => {
    const { db, calls } = fakeDb((c) => (c.kind === 'from' && c.table === 'session_capacity' ? { data: [{ occurrence_id: O1, places: null }] } : { data: [] }))
    const s = createSupabaseReservationStore(db)
    expect(await s.sessionAvailability(P, [O1])).toEqual({ ok: true, value: [{ occurrenceId: O1, places: null, active: 0 }] })
    calls.length = 0
    expect(await s.sessionAvailability(P, [])).toEqual({ ok: true, value: [] })
    expect(await s.sessionAvailability(P, ['x'])).toEqual({ ok: false, error: { kind: 'refused', code: 'invalid' } })
    expect(calls).toHaveLength(0)
  })
})

// ── Notification side: the four ServiceStore methods ─────────────────────────
describe('ServiceStore additions (every query filtered by project_id)', () => {
  const A1 = '44444444-4444-4444-8444-444444444441'
  const A2 = '44444444-4444-4444-8444-444444444442'
  const B2 = '33333333-3333-4333-8333-333333333334'
  const future = new Date(Date.now() + 3_600_000).toISOString()
  const past = new Date(Date.now() - 3_600_000).toISOString()

  it('getBookingById filters by project and id; a bad id never reaches the database', async () => {
    const { db, calls } = fakeDb({ data: [{ id: B, project_id: P, reference: 'X-1', locale: 'it', total_cents: 500 }] })
    const s = createSupabaseReservationStore(db)
    const r = await s.getBookingById(P, B)
    expect(r.ok && r.value?.reference).toBe('X-1')
    expect(hasProjectEq(calls[0])).toBe(true)
    expect(opsOf(calls[0], 'eq').some(([k, v]) => k === 'id' && v === B)).toBe(true)
    const { db: db2, calls: c2 } = fakeDb()
    expect(await createSupabaseReservationStore(db2).getBookingById(P, 'nope')).toEqual({ ok: true, value: null })
    expect(c2).toHaveLength(0)
  })

  it('enqueueOutbox upserts on dedupe_key, ignores duplicates, counts only new rows, skips empty recipient lists', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'new' }] })
    const intent = (dedupeKey: string, recipients: unknown[], payload: Record<string, unknown> = {}) =>
      ({ intent: 'booking.confirmed', dedupeKey, recipients, locale: 'it', payload, environment: 'production' as const })
    const r = await createSupabaseReservationStore(db).enqueueOutbox(P, [
      { bookingId: B, intent: intent('booking.confirmed:aaa', [{ email: 'a@x.it' }]) },
      { bookingId: B, intent: intent('booking.confirmed:bbb', [], { skip: 'non_production_no_test_recipient' }) },
    ])
    expect(r).toEqual({ ok: true, value: { queued: 1 } })
    const ops = (calls[0] as Extract<Call, { kind: 'from' }>).ops
    expect(calls[0]).toMatchObject({ table: 'reservation_outbox' })
    const [, [rows, opts]] = ops.find(([n]) => n === 'upsert') ? [0, ops.find(([n]) => n === 'upsert')![1]] : [0, []]
    expect(opts).toEqual({ onConflict: 'dedupe_key', ignoreDuplicates: true })
    const list = rows as Array<Record<string, unknown>>
    expect(list.every((x) => x.project_id === P)).toBe(true)
    expect(list[0].status).toBeUndefined()
    expect(list[1]).toMatchObject({ status: 'skipped', last_error: 'non_production_no_test_recipient' })
  })

  it('enqueueOutbox with nothing to do makes no call', async () => {
    const { db, calls } = fakeDb()
    expect(await createSupabaseReservationStore(db).enqueueOutbox(P, [])).toEqual({ ok: true, value: { queued: 0 } })
    expect(calls).toHaveLength(0)
  })

  it('listAffectedBookings: active allocations only, lapsed holds ignored, pass holder mailed at own address', async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.kind !== 'from') return {}
      if (c.table === 'booking_allocations') {
        const byBooking = opsOf(c, 'in').some(([k]) => k === 'booking_id')
        if (byBooking) return { data: [
          { booking_id: B, kind: 'confirmed', expires_at: null }, { booking_id: B, kind: 'confirmed', expires_at: null },
          { booking_id: B2, kind: 'pass_attendance', expires_at: null },
        ] }
        return { data: [
          { booking_id: B, attendee_id: A1, pass_id: null, kind: 'confirmed', expires_at: null },
          { booking_id: B2, attendee_id: A2, pass_id: 'pass-1', kind: 'pass_attendance', expires_at: null },
          { booking_id: 'lapsed', attendee_id: A1, pass_id: null, kind: 'hold', expires_at: past },
          { booking_id: 'live-hold', attendee_id: A1, pass_id: null, kind: 'hold', expires_at: future },
        ] }
      }
      if (c.table === 'bookings') return { data: [
        { id: B, purchaser_name: 'Anna Rossi', purchaser_email: 'anna@x.it', locale: 'it', total_cents: 4000, payment_status: 'paid' },
        { id: B2, purchaser_name: 'Buyer', purchaser_email: 'buyer@x.it', locale: 'de', total_cents: 0, payment_status: 'unpaid' },
        { id: 'live-hold', purchaser_name: 'H', purchaser_email: 'h@x.it', locale: 'en', total_cents: 100, payment_status: 'unpaid' },
      ] }
      if (c.table === 'booking_attendees') return { data: [{ id: A2, name: 'Pass Holder', email: 'holder@x.it' }] }
      return {}
    })
    const r = await createSupabaseReservationStore(db).listAffectedBookings(P, [O1, O2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const byId = Object.fromEntries(r.value.map((x) => [x.bookingId, x]))
    expect(byId[B]).toMatchObject({ email: 'anna@x.it', passId: null, sessionCount: 2, paymentStatus: 'paid', totalCents: 4000 })
    expect(byId[B2]).toMatchObject({ email: 'holder@x.it', name: 'Pass Holder', passId: 'pass-1', locale: 'de' })
    expect(byId['live-hold']).toBeDefined()
    expect(byId['lapsed']).toBeUndefined()
    for (const c of calls.filter((x) => x.kind === 'from')) expect(hasProjectEq(c)).toBe(true)
  })

  it('listAffectedBookings rejects malformed ids without a query', async () => {
    const { db, calls } = fakeDb()
    const r = await createSupabaseReservationStore(db).listAffectedBookings(P, ['x'])
    expect(r).toEqual({ ok: false, error: { kind: 'refused', code: 'invalid' } })
    expect(calls).toHaveLength(0)
  })

  it('listNoticeRecipients (target): open bookings of that target in this project; (session): from allocations', async () => {
    const T = '11111111-1111-4111-8111-111111111111'
    const { db, calls } = fakeDb({ data: [{ id: B, purchaser_name: 'Anna', purchaser_email: 'anna@x.it', locale: 'it' }] })
    const r = await createSupabaseReservationStore(db).listNoticeRecipients(P, { kind: 'target', targetId: T })
    expect(r).toEqual({ ok: true, value: [{ bookingId: B, name: 'Anna', email: 'anna@x.it', locale: 'it' }] })
    expect(hasProjectEq(calls[0])).toBe(true)
    expect(opsOf(calls[0], 'eq').some(([k, v]) => k === 'target_id' && v === T)).toBe(true)
    expect(opsOf(calls[0], 'in')[0]).toEqual(['status', ['held', 'awaiting_payment', 'confirmed']])

    const f2 = fakeDb((c) => {
      if (c.kind !== 'from') return {}
      if (c.table === 'booking_allocations') return { data: [{ booking_id: B, attendee_id: A1, pass_id: null, kind: 'confirmed', expires_at: null }] }
      if (c.table === 'bookings') return { data: [{ id: B, purchaser_name: 'Anna', purchaser_email: 'anna@x.it', locale: 'it', total_cents: 0, payment_status: 'unpaid' }] }
      return {}
    })
    const s = await createSupabaseReservationStore(f2.db).listNoticeRecipients(P, { kind: 'session', occurrenceIds: [O1] })
    expect(s).toEqual({ ok: true, value: [{ bookingId: B, name: 'Anna', email: 'anna@x.it', locale: 'it' }] })
    for (const c of f2.calls) expect(hasProjectEq(c)).toBe(true)
  })

  it('a missing table (066 not applied) is unavailable, not a throw', async () => {
    const { db } = fakeDb({ error: { code: '42P01', message: 'relation does not exist' } })
    const s = createSupabaseReservationStore(db)
    expect(await s.enqueueOutbox(P, [{ bookingId: B, intent: { intent: 'x.y', dedupeKey: 'abcd', recipients: [{ email: 'a@b.it' }], locale: 'it', environment: 'production' } }]))
      .toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})
