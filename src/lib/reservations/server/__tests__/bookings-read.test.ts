/**
 * Bookings list and detail reads (ADR-044 D16.15): every query carries the project
 * id, filters and paging reach the database, search terms cannot break out of the
 * filter, snapshot titles are read tolerantly, and a database without 066 answers
 * `unavailable`.
 */
import { describe, expect, it } from 'vitest'
import {
  BOOKINGS_PAGE_SIZE, createBookingsReader, safeSearchTerm, searchExpression, snapshotSessions, snapshotTitle,
} from '../bookings-read'
import { fakeDb, opsOf, type Call } from './fake-db'

const P = '11111111-1111-4111-8111-111111111111'
const B1 = '22222222-2222-4222-8222-222222222221'
const B2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333331'

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, reference: `CYCE-${id.slice(-5).toUpperCase()}`, status: 'confirmed', payment_status: 'paid', payment_review: false, eligibility_review: true,
  purchaser_name: 'Anna Rossi', purchaser_email: 'anna@example.test', total_cents: 4500, snapshot: { title: { en: 'Yoga', it: 'Yoga IT' } },
  anonymised_at: null, created_at: '2026-11-07T10:00:00Z', ...over,
})

const FUTURE = '2999-01-01T00:00:00Z'
function listDb() {
  return fakeDb((c: Call) => {
    if (c.kind !== 'from') return {}
    if (c.table === 'bookings') return { data: [row(B1), row(B2, { snapshot: {}, anonymised_at: '2026-11-01T00:00:00Z', purchaser_name: null })] }
    if (c.table === 'booking_allocations') return { data: [
      { booking_id: B1, kind: 'confirmed', expires_at: null },
      { booking_id: B1, kind: 'confirmed', expires_at: null },
      { booking_id: B2, kind: 'hold', expires_at: '2000-01-01T00:00:00Z' }, // lapsed: not a place
      { booking_id: B2, kind: 'hold', expires_at: FUTURE },
    ] }
    if (c.table === 'booking_passes') return { data: [{ booking_id: B2 }] }
    return {}
  })
}

describe('listBookings', () => {
  it('scopes every query to the project and maps the rows', async () => {
    const { db, calls } = listDb()
    const r = await createBookingsReader(db).listBookings(P)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const c of calls) {
      if (c.kind !== 'from') continue
      expect(opsOf(c, 'eq').some(([k, v]) => k === 'project_id' && v === P), c.table).toBe(true)
    }
    expect(r.value.rows[0]).toMatchObject({ id: B1, what: 'Yoga', sessionCount: 2, hasPass: false, paymentReview: false, eligibilityReview: true, totalCents: 4500 })
    expect(r.value.rows[1]).toMatchObject({ anonymised: true, name: null, what: null, sessionCount: 1, hasPass: true })
    expect(r.value.page).toBe(1)
    expect(r.value.pageSize).toBe(BOOKINGS_PAGE_SIZE)
  })

  it('sends filters and the page range to the database', async () => {
    const { db, calls } = listDb()
    await createBookingsReader(db).listBookings(P, { status: 'held', paymentStatus: 'unpaid', targetId: T1, q: 'cyce 7k2', page: 3 })
    const main = calls.find((c) => c.kind === 'from' && c.table === 'bookings')!
    const eq = opsOf(main, 'eq')
    expect(eq).toContainEqual(['status', 'held'])
    expect(eq).toContainEqual(['payment_status', 'unpaid'])
    expect(eq).toContainEqual(['target_id', T1])
    expect(opsOf(main, 'or')[0][0]).toBe('reference.ilike.CYCE-7K2%,purchaser_name.ilike.%cyce 7k2%,purchaser_email.ilike.%cyce 7k2%')
    expect(opsOf(main, 'range')[0]).toEqual([2 * BOOKINGS_PAGE_SIZE, 3 * BOOKINGS_PAGE_SIZE - 1])
    expect(opsOf(main, 'order')[0][0]).toBe('created_at')
  })

  it('a target id that is not a uuid finds nothing, without asking the database', async () => {
    const { db, calls } = listDb()
    const r = await createBookingsReader(db).listBookings(P, { targetId: 'x; drop' })
    expect(r).toMatchObject({ ok: true, value: { rows: [], total: 0 } })
    expect(calls).toHaveLength(0)
  })

  it('a database without 066 answers unavailable', async () => {
    const { db } = fakeDb({ error: { code: '42P01', message: 'relation "bookings" does not exist' } })
    const r = await createBookingsReader(db).listBookings(P)
    expect(r).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})

describe('search', () => {
  it('strips what could break out of an or() filter or act as a wildcard', () => {
    expect(safeSearchTerm('a,b)(c%d*e_f"g')).toBe('a b c d e f g')
    expect(searchExpression('   ')).toBeNull()
    const e = searchExpression('x),status.eq.cancelled')!
    // still exactly three conditions, and no bracket or comma of the user's survives to open another one
    expect(e.split(',')).toHaveLength(3)
    expect(e).not.toMatch(/[()]/)
  })
  it('normalises a reference typed loosely', () => {
    expect(searchExpression('cyce 7k2mq')!.startsWith('reference.ilike.CYCE-7K2MQ%,')).toBe(true)
  })
})

describe('snapshot readers', () => {
  it('prefers the session language, then any text, then the option label', () => {
    expect(snapshotTitle({ title: { en: 'Yoga', it: 'Yoga IT' } }, ['it', 'en'])).toBe('Yoga IT')
    expect(snapshotTitle({ title: { de: 'Yoga DE' } }, ['en'])).toBe('Yoga DE')
    expect(snapshotTitle({ optionLabel: { en: 'Workshop' } })).toBe('Workshop')
    expect(snapshotTitle({})).toBeNull()
    expect(snapshotTitle(null)).toBeNull()
  })
  it('reads sessions in either casing and ignores junk', () => {
    expect(snapshotSessions({ sessions: [{ occurrenceId: 'o1', startsAt: '2026-11-10T18:00:00Z', title: 'Class' }, { occurrence_id: 'o2' }, 'x', null] })).toEqual([
      { occurrenceId: 'o1', startsAt: '2026-11-10T18:00:00.000Z', title: 'Class' },
      { occurrenceId: 'o2', startsAt: null, title: null },
    ])
    expect(snapshotSessions({})).toEqual([])
  })
})

describe('getBookingDetail', () => {
  const booking = { ...row(B1), project_id: P, target_id: T1, option_id: null, locale: 'it', source: 'website', purchaser_phone: null, hold_expires_at: null, confirmed_at: null, cancelled_at: null, version: 2 }
  function detailDb() {
    return fakeDb((c: Call) => {
      if (c.kind !== 'from') return {}
      switch (c.table) {
        case 'bookings': return { data: [booking] }
        case 'reservable_targets': return { data: [{ id: T1, owner_type: 'course', owner_public_id: 'c-yoga', edition_id: null }] }
        case 'booking_attendees': return { data: [{ id: 'a2', name: 'Bea', email: null, is_minor: true, guardian: { name: 'Mum' }, eligibility_result: 'pending', declared_eligible: true, anonymised_at: null, sort: 1 }, { id: 'a1', name: 'Anna', email: 'a@x.test', is_minor: false, guardian: null, eligibility_result: null, declared_eligible: null, anonymised_at: null, sort: 0 }] }
        case 'booking_lines': return { data: [{ id: 'l1', attendee_id: null, kind: 'item', label: { en: 'Course' }, quantity: 2, unit_cents: 2250, amount_cents: 4500, created_at: '2026-11-07T10:00:00Z' }] }
        case 'booking_payments': return { data: [
          { id: 'p2', method: 'cash', amount_cents: 1000, status: 'succeeded', paid_on: '2026-11-09', reference: null, note: null, created_at: '2026-11-09T09:00:00Z' },
          { id: 'p1', method: 'bank_transfer', amount_cents: 2000, status: 'succeeded', paid_on: '2026-11-08', reference: 'CRO1', note: null, created_at: '2026-11-08T09:00:00Z' },
          { id: 'p3', method: 'cash', amount_cents: 500, status: 'void', paid_on: '2026-11-09', reference: null, note: null, created_at: '2026-11-09T10:00:00Z' },
        ] }
        case 'booking_passes': return { data: [] }
        case 'booking_allocations': return { data: [{ id: 'al1', attendee_id: 'a1', occurrence_id: 'o1', kind: 'confirmed', expires_at: null, released_at: null, release_reason: null }] }
        case 'booking_activity': return { data: [
          { id: 1, action: 'booking.created', actor_kind: 'participant', detail: {}, created_at: '2026-11-07T10:00:00Z' },
          { id: 2, action: 'payment.recorded', actor_kind: 'user', detail: { amount_cents: 2000, method: 'bank_transfer' }, created_at: '2026-11-08T09:00:00Z' },
        ] }
      }
      return {}
    })
  }

  it('assembles the booking, scoped to the project on every table', async () => {
    const { db, calls } = detailDb()
    const r = await createBookingsReader(db).getBookingDetail(P, B1)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.value) return
    for (const c of calls) {
      if (c.kind !== 'from') continue
      expect(opsOf(c, 'eq').some(([k, v]) => k === 'project_id' && v === P), c.table).toBe(true)
    }
    const d = r.value
    expect(d.what).toBe('Yoga')
    expect(d.target).toEqual({ id: T1, ownerType: 'course', ownerPublicId: 'c-yoga', editionId: null })
    expect(d.attendees.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(d.attendees[1]).toMatchObject({ isMinor: true, guardianName: 'Mum', eligibilityResult: 'pending' })
    expect(d.lines[0]).toMatchObject({ label: 'Course', quantity: 2, amountCents: 4500 })
    // oldest first; a voided payment is listed but does not count
    expect(d.payments.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(d.paidCents).toBe(3000)
    // history: newest first
    expect(d.activity.map((a) => a.id)).toEqual(['2', '1'])
  })

  it('a malformed id, or another project\'s booking, is null (nothing leaks)', async () => {
    const { db, calls } = detailDb()
    expect(await createBookingsReader(db).getBookingDetail(P, 'not-a-uuid')).toEqual({ ok: true, value: null })
    expect(calls).toHaveLength(0)
    const empty = fakeDb({ data: [] })
    expect(await createBookingsReader(empty.db).getBookingDetail(P, B2)).toEqual({ ok: true, value: null })
  })

  it('unavailable when 066 is missing', async () => {
    const { db } = fakeDb({ error: { code: 'PGRST205', message: 'not in schema cache' } })
    expect(await createBookingsReader(db).getBookingDetail(P, B1)).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})

describe('listTargetOptions', () => {
  it('offers each course / event that has bookings, by its snapshot title', async () => {
    const { db } = fakeDb((c: Call) => {
      if (c.kind !== 'from') return {}
      if (c.table === 'bookings') return { data: [{ target_id: T1, snapshot: {} }, { target_id: T1, snapshot: { title: 'Yoga' } }, { target_id: 'gone', snapshot: { title: 'X' } }] }
      return { data: [{ id: T1, owner_type: 'course' }] }
    })
    const r = await createBookingsReader(db).listTargetOptions(P)
    expect(r).toEqual({ ok: true, value: [{ targetId: T1, label: 'Yoga', ownerType: 'course' }] })
  })
})
