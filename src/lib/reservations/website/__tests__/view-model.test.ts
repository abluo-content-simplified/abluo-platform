import { describe, expect, it } from 'vitest'
import { DEFAULT_BOOKING_RULES, resolveRules } from '../../rules'
import type { BookingRulesOverride } from '../../types'
import { bookingRow, passRow, NOW } from '../../service/__tests__/fake-store'
import { buildBookingView, buildPassView, entriesUsed, passCoversSession, type AllocationFact, type SessionFact } from '../view-model'

const rules = (o: BookingRulesOverride = {}) => resolveRules(DEFAULT_BOOKING_RULES as never, o)
const TZ = 'Europe/Rome'
// NOW = Sat 2026-11-07T10:00:00Z
const sess = (id: string, startsAt: string, over: Partial<SessionFact> = {}): SessionFact => ({
  occurrenceId: id, startsAt, endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(), timeZone: TZ, status: 'scheduled',
  ownerType: 'course', ownerPublicId: 'c-yoga', title: 'Yoga', placeRef: null, place: 'Studio 1', rulesOverride: null, ...over,
})
const alloc = (occurrenceId: string, over: Partial<AllocationFact> = {}): AllocationFact => ({
  occurrenceId, kind: 'confirmed', passId: null, expiresAt: null, releasedAt: null, releaseReason: null, usesEntry: false, entryReturned: false, ...over,
})
const IN_5D = '2026-11-12T17:00:00Z' // 18:00 in Rome
const IN_9D = '2026-11-16T17:00:00Z'
const ANY = { siteTimeZone: TZ, locale: 'en', paymentInstructions: null, bankDetails: null, now: NOW }

describe('buildBookingView', () => {
  const base = { ...ANY, booking: bookingRow(), rules: rules({ selfCancel: { enabled: true, deadlineHours: 48 }, absenceNotice: { enabled: true } }), isPass: false }

  it('lists sessions in the site time zone, 24-hour, with title and place', () => {
    const v = buildBookingView({ ...base, allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(v.sessions).toEqual([expect.objectContaining({ id: 's1', title: 'Yoga', place: 'Studio 1', state: 'attending', timeLabel: '18:00–19:00' })])
    expect(v.sessions[0].dateLabel).toMatch(/12 November 2026/)
  })

  it('shows the amount and reference', () => {
    const v = buildBookingView({ ...base, booking: bookingRow({ totalCents: 2000 }), allocations: [], sessions: [] })
    expect(v.reference).toBe('CYCE-AAAAA')
    expect(v.amountLabel).toMatch(/20[.,]00/)
    expect(buildBookingView({ ...base, booking: bookingRow({ totalCents: 0 }), allocations: [], sessions: [] }).amountLabel).toBeNull()
  })

  it('payment instructions and bank details only while payment is awaited, in the booking language', () => {
    const texts = { paymentInstructions: { en: 'Pay by transfer', it: 'Paga con bonifico' }, bankDetails: { en: 'IBAN IT00' } }
    const awaiting = bookingRow({ status: 'awaiting_payment', paymentStatus: 'unpaid', holdExpiresAt: '2026-11-10T22:00:00Z' })
    const v = buildBookingView({ ...base, ...texts, booking: awaiting, locale: 'it', allocations: [], sessions: [] })
    expect(v.paymentInstructions).toBe('Paga con bonifico')
    expect(v.bankDetails).toBe('IBAN IT00') // falls back to English
    expect(v.payByLabel).toMatch(/10 novembre 2026, 23:00/)
    const paid = buildBookingView({ ...base, ...texts, booking: bookingRow(), allocations: [], sessions: [] })
    expect(paid.paymentInstructions).toBeNull()
    expect(paid.bankDetails).toBeNull()
    expect(paid.payByLabel).toBeNull()
  })

  it('cancel is offered only when the rule is on and the deadline (from the earliest live session) has not passed', () => {
    const open = buildBookingView({ ...base, allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(open.cancel.allowed).toBe(true)
    expect(open.cancel.untilLabel).toMatch(/10 November 2026, 18:00/)
    // 1 day before the start, deadline 48 h -> too late
    const late = buildBookingView({ ...base, allocations: [alloc('s1')], sessions: [sess('s1', '2026-11-08T10:00:00Z')] })
    expect(late.cancel.allowed).toBe(false)
    const off = buildBookingView({ ...base, rules: rules(), allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(off.cancel.allowed).toBe(false)
  })

  it('cancel deadline counts only live sessions; a released earlier one does not hold it back', () => {
    const v = buildBookingView({
      ...base,
      allocations: [alloc('s0', { releasedAt: '2026-11-01T00:00:00Z', releaseReason: 'absence' }), alloc('s1')],
      sessions: [sess('s0', '2026-11-08T10:00:00Z'), sess('s1', IN_9D)],
    })
    expect(v.cancel.allowed).toBe(true)
  })

  it('no cancel on a closed booking', () => {
    for (const status of ['cancelled', 'expired', 'pending'] as const) {
      expect(buildBookingView({ ...base, booking: bookingRow({ status }), allocations: [], sessions: [] }).cancel.allowed).toBe(false)
    }
  })

  it("'I can't come' needs a confirmed booking, the rule, a live future session; a session override can switch it off", () => {
    const ok = buildBookingView({ ...base, allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(ok.sessions[0].canAbsent).toBe(true)
    const held = buildBookingView({ ...base, booking: bookingRow({ status: 'held', holdExpiresAt: IN_5D }), allocations: [alloc('s1', { kind: 'hold', expiresAt: IN_5D })], sessions: [sess('s1', IN_5D)] })
    expect(held.sessions[0].canAbsent).toBe(false)
    const offRule = buildBookingView({ ...base, rules: rules(), allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(offRule.sessions[0].canAbsent).toBe(false)
    const overridden = buildBookingView({ ...base, allocations: [alloc('s1')], sessions: [sess('s1', IN_5D, { rulesOverride: { absenceNotice: { enabled: false } } })] })
    expect(overridden.sessions[0].canAbsent).toBe(false)
    const pass = buildBookingView({ ...base, isPass: true, allocations: [alloc('s1')], sessions: [sess('s1', IN_5D)] })
    expect(pass.sessions[0].canAbsent).toBe(false)
  })

  it('states: released by the person, cancelled by the organiser or the session, past', () => {
    const v = buildBookingView({
      ...base,
      allocations: [
        alloc('a', { releasedAt: '2026-11-02T00:00:00Z', releaseReason: 'absence' }),
        alloc('b', { releasedAt: '2026-11-02T00:00:00Z', releaseReason: 'organiser_cancelled' }),
        alloc('c'), alloc('d'),
      ],
      sessions: [sess('a', IN_5D), sess('b', IN_9D), sess('c', '2026-11-03T17:00:00Z'), sess('d', '2026-11-20T17:00:00Z', { status: 'cancelled' })],
    })
    const state = Object.fromEntries(v.sessions.map((s) => [s.id, s.state]))
    expect(state).toEqual({ c: 'past', a: 'released', b: 'cancelled', d: 'cancelled' })
    expect(v.sessions.every((s) => !s.canAbsent)).toBe(true)
  })

  it('sessions without an allocation are not shown; a live allocation beats a released one on the same session', () => {
    const v = buildBookingView({
      ...base,
      allocations: [alloc('s1', { releasedAt: '2026-11-02T00:00:00Z', releaseReason: 'replaced' }), alloc('s1')],
      sessions: [sess('s1', IN_5D), sess('ghost', IN_9D)],
    })
    expect(v.sessions.map((s) => [s.id, s.state])).toEqual([['s1', 'attending']])
  })
})

describe('buildPassView', () => {
  const OPT_IN = rules({ passSignUp: 'opt_in', signUpOpensDaysBefore: 7, answerChangeUntilHoursBefore: 2 })
  const owner = { ownerType: 'course' as const, ownerPublicId: 'c-yoga' }
  const base = { ...ANY, pass: passRow({ entriesTotal: 5 }), targetOwner: owner, rules: OPT_IN, allocations: [] as AllocationFact[], availability: new Map() }
  const row = (v: ReturnType<typeof buildPassView>, id: string) => v.sessions.find((s) => s.id === id)!

  it('validity, entries left (used = consumed and not returned), unlimited', () => {
    const used: AllocationFact[] = [
      alloc('x1', { kind: 'pass_attendance', passId: 'pass1', usesEntry: true }),
      alloc('x2', { kind: 'pass_attendance', passId: 'pass1', usesEntry: true, entryReturned: true, releasedAt: '2026-11-01T00:00:00Z', releaseReason: 'withdrawn' }),
      alloc('x3', { kind: 'pass_attendance', passId: 'pass1', usesEntry: true, releasedAt: '2026-11-01T00:00:00Z', releaseReason: 'withdrawn' }),
    ]
    expect(entriesUsed(used)).toBe(2)
    const v = buildPassView({ ...base, allocations: used, sessions: [] })
    expect(v.entriesLeft).toBe(3)
    expect(v.status).toBe('active')
    expect(v.validFromLabel).toBe('1 November 2026')
    expect(v.validToLabel).toBe('30 June 2027')
    expect(buildPassView({ ...base, pass: passRow({ entriesTotal: null }), sessions: [] }).entriesLeft).toBeNull()
    expect(buildPassView({ ...base, pass: passRow({ entriesTotal: 1 }), allocations: used, sessions: [] }).entriesLeft).toBe(0)
  })

  it('status: cancelled, expired, not started — and then no classes are listed', () => {
    const s = [sess('s1', IN_5D)]
    expect(buildPassView({ ...base, pass: passRow({ status: 'cancelled' }), sessions: s })).toMatchObject({ status: 'cancelled', sessions: [] })
    expect(buildPassView({ ...base, pass: passRow({ validTo: '2026-11-06' }), sessions: s })).toMatchObject({ status: 'expired', sessions: [] })
    expect(buildPassView({ ...base, pass: passRow({ validFrom: '2026-11-08' }), sessions: s })).toMatchObject({ status: 'not_started', sessions: [] })
  })

  it('coverage: scope (all / listed courses / the target) and validity; past sessions are dropped', () => {
    const mk = (over: Partial<SessionFact>) => sess('s', IN_5D, over)
    const all = passRow({ scope: 'all_courses' })
    expect(passCoversSession(all, owner, mk({}), TZ)).toBe(true)
    expect(passCoversSession(all, owner, mk({ ownerType: 'event' }), TZ)).toBe(false)
    const listed = passRow({ scope: 'courses', scopeOwnerIds: ['c-yoga'] })
    expect(passCoversSession(listed, owner, mk({}), TZ)).toBe(true)
    expect(passCoversSession(listed, owner, mk({ ownerPublicId: 'c-other' }), TZ)).toBe(false)
    const target = passRow({ scope: 'target' })
    expect(passCoversSession(target, owner, mk({}), TZ)).toBe(true)
    expect(passCoversSession(target, owner, mk({ ownerPublicId: 'c-other' }), TZ)).toBe(false)
    expect(passCoversSession(target, null, mk({}), TZ)).toBe(false)
    // validity is judged by the LOCAL date: 23:30 UTC on the 30th of June is already 1 July in Rome
    expect(passCoversSession(all, owner, mk({ startsAt: '2027-06-30T22:30:00Z' }), TZ)).toBe(false)
    expect(passCoversSession(all, owner, mk({ startsAt: '2027-06-30T21:30:00Z' }), TZ)).toBe(true)

    const v = buildPassView({ ...base, pass: all, sessions: [sess('past', '2026-11-05T17:00:00Z'), sess('ok', IN_5D), sess('other', IN_9D, { ownerType: 'event' })] })
    expect(v.sessions.map((s) => s.id)).toEqual(['ok'])
  })

  it('opt_in: Coming offered inside the window; before it the opening date is given; after the deadline it is closed', () => {
    const v = buildPassView({ ...base, sessions: [sess('open', '2026-11-12T17:00:00Z'), sess('early', '2026-11-20T17:00:00Z'), sess('late', '2026-11-07T11:00:00Z')] })
    expect(row(v, 'open')).toMatchObject({ mode: 'opt_in', canCome: true, blocked: null, attending: false })
    expect(row(v, 'early')).toMatchObject({ canCome: false, blocked: 'not_open_yet' })
    expect(row(v, 'early').opensLabel).toMatch(/13 November 2026/)
    expect(row(v, 'late')).toMatchObject({ canCome: false, blocked: 'closed' })
  })

  it('off (default): no buttons at all — just come along', () => {
    const v = buildPassView({ ...base, rules: rules(), sessions: [sess('s1', IN_5D)] })
    expect(row(v, 's1')).toMatchObject({ mode: 'off', canCome: false, canLeave: false, blocked: null })
  })

  it('a class can switch the mode for itself (session override)', () => {
    const v = buildPassView({ ...base, rules: rules(), sessions: [sess('s1', IN_5D, { rulesOverride: { passSignUp: 'opt_in' } })] })
    expect(row(v, 's1')).toMatchObject({ mode: 'opt_in', canCome: true })
  })

  it('full: Coming is not offered; an attending person can still step out; unlimited places are never full', () => {
    const full = new Map([['s1', { places: 10, active: 10 }], ['s2', { places: 10, active: 9 }], ['s3', { places: null, active: 99 }]])
    const v = buildPassView({
      ...base, availability: full,
      allocations: [alloc('s4', { kind: 'pass_attendance', passId: 'pass1', usesEntry: true })],
      sessions: [sess('s1', IN_5D), sess('s2', IN_5D), sess('s3', IN_5D), sess('s4', IN_5D)],
    })
    expect(row(v, 's1')).toMatchObject({ canCome: false, blocked: 'full' })
    expect(row(v, 's2')).toMatchObject({ canCome: true, blocked: null })
    expect(row(v, 's3')).toMatchObject({ canCome: true })
    expect(row(v, 's4')).toMatchObject({ attending: true, canLeave: true, canCome: false })
  })

  it('no entries left: Coming blocked, but leaving a booked class is still possible', () => {
    const used = [alloc('s9', { kind: 'pass_attendance', passId: 'pass1', usesEntry: true })]
    const v = buildPassView({ ...base, pass: passRow({ entriesTotal: 1 }), allocations: used, sessions: [sess('s1', IN_5D), sess('s9', IN_9D)] })
    expect(row(v, 's1')).toMatchObject({ canCome: false, blocked: 'no_entries' })
    expect(row(v, 's9')).toMatchObject({ attending: true, canLeave: true })
  })

  it('a released attendance is not "coming"; a cancelled class has no buttons', () => {
    const v = buildPassView({
      ...base,
      allocations: [alloc('s1', { kind: 'pass_attendance', passId: 'pass1', releasedAt: '2026-11-06T00:00:00Z', releaseReason: 'withdrawn' })],
      sessions: [sess('s1', IN_5D), sess('s2', IN_5D, { status: 'cancelled' })],
    })
    expect(row(v, 's1').attending).toBe(false)
    expect(row(v, 's2')).toMatchObject({ cancelled: true, canCome: false, canLeave: false })
  })
})
