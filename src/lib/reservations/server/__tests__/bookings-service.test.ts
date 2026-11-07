/**
 * Bookings service (ADR-044 D5, D6, D16.15): permission refused before any I/O,
 * the project always comes from the grant, input validation, payments go through
 * the payment service (rules + confirmation mail), and store failures map to
 * machine codes.
 */
import { describe, expect, it, vi } from 'vitest'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { bookingRow, makeStore, settings } from '../../service/__tests__/fake-store'
import { fail, ok } from '../errors'
import type { BookingDetail, BookingsReader } from '../bookings-read'
import {
  bookingsSiteFactsOf, cancelBooking, confirmBooking, extendBookingHold, loadBookingDetail, loadBookingList, markEligibilityVerified,
  recordBookingPayment, type BookingsDeps,
} from '../bookings-service'
import type { BookingsWriteStore } from '../bookings-write'

const PID = '11111111-1111-4111-8111-111111111111'
const BID = '22222222-2222-4222-8222-222222222221'
const NOW = new Date('2026-11-08T10:00:00Z')

const grant = (permissions: string[], o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID, projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm1', role: 'owner', permissions, enabledModuleIds: ['reservations'], ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })
const OWNER = ['reservations.booking.read', 'reservations.booking.write', 'reservations.payment.update']
const owner = () => ctx(grant(OWNER))

const detail = (over: Partial<BookingDetail['booking']> = {}): BookingDetail => ({
  booking: bookingRow({ id: BID, projectId: PID, status: 'awaiting_payment', paymentStatus: 'unpaid', ...over }),
  what: 'Yoga', optionLabel: null,
  target: { id: 't1', ownerType: 'course', ownerPublicId: 'c-yoga', editionId: null },
  attendees: [], lines: [], payments: [], passes: [], allocations: [], sessions: [], activity: [], paidCents: 0,
})

function harness(o: { detail?: BookingDetail | null; storeOpts?: Parameters<typeof makeStore>[0] } = {}) {
  const s = makeStore({ settings: settings({ acceptBankTransfer: true }), ...o.storeOpts })
  const reader: BookingsReader = {
    listBookings: vi.fn(async (projectId: string) => ok({ rows: [], total: 0, page: 1, pageSize: 25, projectId } as never)),
    listTargetOptions: vi.fn(async () => ok([])),
    getBookingDetail: vi.fn(async (_p: string, id: string) => ok(o.detail === undefined ? (id === BID ? detail() : null) : o.detail)),
  }
  const writer: BookingsWriteStore = { verifyEligibility: vi.fn(async () => ok({ verified: 1, reviewCleared: true })) }
  const deps: BookingsDeps = {
    reader, store: s.store, writer, readSite: vi.fn(async () => ({ timeZone: 'Europe/Rome', locales: ['en'] })),
    now: () => NOW, randomBytes: (n) => new Uint8Array(n), environment: 'production',
  }
  return { deps, reader, writer, ...s }
}

const pay = (over: Record<string, unknown> = {}) => ({ bookingId: BID, method: 'bank_transfer', amountCents: 2500, paidOn: '2026-11-08', reference: ' CRO123 ', note: '', ...over })

describe('permissions: refused before any read or write', () => {
  const cases: Array<[string, string[], (h: ReturnType<typeof harness>) => Promise<unknown>]> = [
    ['list needs booking.read', [], (h) => loadBookingList(ctx(grant([])), PID, {}, h.deps)],
    ['detail needs booking.read', [], (h) => loadBookingDetail(ctx(grant([])), PID, BID, h.deps)],
    ['a payment needs payment.update (booking.write is not enough)', ['reservations.booking.read', 'reservations.booking.write'], (h) => recordBookingPayment(ctx(grant(['reservations.booking.read', 'reservations.booking.write'])), PID, pay(), h.deps)],
    ['confirm needs booking.write', ['reservations.booking.read', 'reservations.payment.update'], (h) => confirmBooking(ctx(grant(['reservations.booking.read', 'reservations.payment.update'])), PID, BID, h.deps)],
    ['extend needs booking.write', ['reservations.booking.read'], (h) => extendBookingHold(ctx(grant(['reservations.booking.read'])), PID, { bookingId: BID, until: '2026-11-20' }, h.deps)],
    ['cancel needs booking.write', ['reservations.booking.read'], (h) => cancelBooking(ctx(grant(['reservations.booking.read'])), PID, BID, h.deps)],
    ['eligibility needs booking.write', ['reservations.booking.read'], (h) => markEligibilityVerified(ctx(grant(['reservations.booking.read'])), PID, BID, h.deps)],
    ['nothing works when the module is not installed', [], (h) => loadBookingList(ctx(grant(OWNER, { enabledModuleIds: ['courses'] })), PID, {}, h.deps)],
    ['nothing works for a project the caller has no grant on', [], (h) => cancelBooking(ctx(grant(OWNER)), '99999999-9999-4999-8999-999999999999', BID, h.deps)],
  ]
  it.each(cases)('%s', async (_n, _p, run) => {
    const h = harness()
    await expect(run(h)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(h.calls).toHaveLength(0)
    expect(h.reader.getBookingDetail).not.toHaveBeenCalled()
    expect(h.reader.listBookings).not.toHaveBeenCalled()
    expect(h.writer.verifyEligibility).not.toHaveBeenCalled()
    expect(h.deps.readSite).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('list: scoped to the grant\'s project, with what the person may do', async () => {
    const h = harness()
    const r = await loadBookingList(ctx(grant(['reservations.booking.read'])), PID, { status: 'held' }, h.deps)
    expect(r.ok && r.view.can).toEqual({ write: false, pay: false })
    expect(h.reader.listBookings).toHaveBeenCalledWith(PID, { status: 'held' }, ['en'])
    const all = await loadBookingList(owner(), PID, {}, h.deps)
    expect(all.ok && all.view.can).toEqual({ write: true, pay: true })
  })
  it('list: unavailable when 066 is not applied', async () => {
    const h = harness()
    ;(h.reader.listBookings as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail({ kind: 'unavailable' }))
    expect(await loadBookingList(owner(), PID, {}, h.deps)).toEqual({ ok: false, error: 'unavailable' })
  })
  it('detail: not_found for a booking that is not in this project', async () => {
    const h = harness({ detail: null })
    expect(await loadBookingDetail(owner(), PID, BID, h.deps)).toEqual({ ok: false, error: 'not_found' })
    expect(h.reader.getBookingDetail).toHaveBeenCalledWith(PID, BID, ['en'])
  })
})

describe('recordBookingPayment', () => {
  it('records through the payment service with the project from the grant, trimmed text and the user as actor', async () => {
    const h = harness()
    const r = await recordBookingPayment(owner(), PID, pay(), h.deps)
    expect(r).toMatchObject({ ok: true, paymentStatus: 'paid', confirmed: true })
    const [projectId, bookingId, input] = h.called('recordPayment')[0].args as [string, string, Record<string, unknown>]
    expect(projectId).toBe(PID)
    expect(bookingId).toBe(BID)
    expect(input).toMatchObject({ method: 'bank_transfer', amountCents: 2500, paidOn: '2026-11-08', reference: 'CRO123', note: null, actor: { kind: 'user', id: 'u1' } })
    expect(h.outbox[0].intent.intent).toBe('booking.confirmed')
  })
  it('several payments are fine (a partial one does not confirm)', async () => {
    const h = harness({ storeOpts: { recordPayment: ok({ paymentId: 'p', paymentStatus: 'partially_paid', confirm: null }) } })
    expect(await recordBookingPayment(owner(), PID, pay({ amountCents: 1000 }), h.deps)).toMatchObject({ ok: true, paymentStatus: 'partially_paid', confirmed: false, paymentReview: false })
  })
  it('the places are gone: payment kept, booking flagged for review', async () => {
    const h = harness({ storeOpts: { recordPayment: ok({ paymentId: 'p', paymentStatus: 'paid', confirm: { confirmed: false, replayed: false, full: ['o1'] } }) } })
    expect(await recordBookingPayment(owner(), PID, pay(), h.deps)).toMatchObject({ ok: true, paymentReview: true, fullOccurrenceIds: ['o1'] })
  })
  it.each([
    ['amount 0', { amountCents: 0 }, 'invalid_amount'],
    ['fractional cents', { amountCents: 10.5 }, 'invalid_amount'],
    ['text amount', { amountCents: '25' }, 'invalid_amount'],
    ['unknown method', { method: 'stripe' }, 'invalid_method'],
    ['bad date', { paidOn: '08/11/2026' }, 'invalid_date'],
    ['a date in the future', { paidOn: '2026-12-31' }, 'invalid_date'],
    ['long reference', { reference: 'x'.repeat(201) }, 'invalid_reference'],
    ['long note', { note: 'x'.repeat(2001) }, 'invalid_note'],
  ])('refuses %s without writing', async (_n, over, code) => {
    const h = harness()
    expect(await recordBookingPayment(owner(), PID, pay(over), h.deps)).toEqual({ ok: false, code })
    expect(h.called('recordPayment')).toHaveLength(0)
  })
  it('unknown booking, cancelled booking, bank transfer switched off', async () => {
    expect(await recordBookingPayment(owner(), PID, pay({ bookingId: '33333333-3333-4333-8333-333333333333' }), harness().deps)).toEqual({ ok: false, code: 'booking_not_found' })
    expect(await recordBookingPayment(owner(), PID, pay(), harness({ detail: detail({ status: 'cancelled' }) }).deps)).toEqual({ ok: false, code: 'already_closed' })
    const off = harness({ storeOpts: { settings: settings({ acceptBankTransfer: false }) } })
    expect(await recordBookingPayment(owner(), PID, pay(), off.deps)).toEqual({ ok: false, code: 'payment_method_not_available' })
  })
  it('a store failure comes back as its code', async () => {
    const h = harness({ storeOpts: { recordPayment: fail({ kind: 'unavailable' }) } })
    expect(await recordBookingPayment(owner(), PID, pay(), h.deps)).toEqual({ ok: false, code: 'unavailable' })
  })
})

describe('confirmBooking', () => {
  it('confirms, and queues the email once', async () => {
    const h = harness()
    const seen: unknown[][] = []
    ;(h.store.confirm as unknown) = vi.fn(async (...a: unknown[]) => { seen.push(a); return ok({ confirmed: true, replayed: false, full: [] }) })
    expect(await confirmBooking(owner(), PID, BID, h.deps)).toEqual({ ok: true })
    expect(seen[0]).toEqual([PID, BID, { kind: 'user', id: 'u1' }])
    expect(h.outbox[0].intent).toMatchObject({ intent: 'booking.confirmed', dedupeKey: `booking.confirmed:b1:manual` })
  })
  it('sessions full: the code is `full` and names the sessions', async () => {
    const h = harness()
    ;(h.store.confirm as unknown) = vi.fn(async () => ok({ confirmed: false, replayed: false, full: ['o1', 'o2'] }))
    expect(await confirmBooking(owner(), PID, BID, h.deps)).toEqual({ ok: false, code: 'full', occurrenceIds: ['o1', 'o2'] })
    expect(h.outbox).toHaveLength(0)
  })
  it('database refusals map to codes', async () => {
    const h = harness()
    ;(h.store.confirm as unknown) = vi.fn(async () => fail({ kind: 'refused', code: 'cannot_confirm' }))
    expect(await confirmBooking(owner(), PID, BID, h.deps)).toEqual({ ok: false, code: 'cannot_confirm' })
  })
})

describe('extendBookingHold', () => {
  it('holds to the end of the chosen day in the site\'s time zone', async () => {
    const h = harness()
    const calls: unknown[][] = []
    ;(h.store.extendHold as unknown) = vi.fn(async (...a: unknown[]) => { calls.push(a); return ok({ extended: true }) })
    const r = await extendBookingHold(owner(), PID, { bookingId: BID, until: '2026-11-20' }, h.deps)
    expect(r).toEqual({ ok: true, until: '2026-11-20T22:59:00.000Z' }) // 23:59 CET = 22:59 UTC
    expect(calls[0].slice(0, 2)).toEqual([PID, BID])
  })
  it.each(['2026-11-07', 'soon', '2028-01-01', '2026-02-30'])('refuses %s', async (until) => {
    const h = harness()
    expect(await extendBookingHold(owner(), PID, { bookingId: BID, until }, h.deps)).toEqual({ ok: false, code: 'invalid_date' })
    expect(h.called('extendHold')).toHaveLength(0)
  })
})

describe('cancelBooking and eligibility', () => {
  it('cancels the whole booking through the store, as the user', async () => {
    const h = harness()
    expect(await cancelBooking(owner(), PID, BID, h.deps)).toEqual({ ok: true, released: 1 })
    const [projectId, bookingId, reason, opts] = h.called('release')[0].args as [string, string, string, Record<string, unknown>]
    expect([projectId, bookingId, reason]).toEqual([PID, BID, 'cancelled'])
    expect(opts).toMatchObject({ cancelBooking: true, actor: { kind: 'user', id: 'u1' } })
  })
  it('a missing booking is booking_not_found', async () => {
    const h = harness({ storeOpts: { release: fail({ kind: 'not_found', code: 'booking_not_found' }) } })
    expect(await cancelBooking(owner(), PID, BID, h.deps)).toEqual({ ok: false, code: 'booking_not_found' })
  })
  it('marks eligibility verified for this project only', async () => {
    const h = harness()
    expect(await markEligibilityVerified(owner(), PID, BID, h.deps)).toEqual({ ok: true, verified: 1 })
    expect(h.writer.verifyEligibility).toHaveBeenCalledWith(PID, BID, { kind: 'user', id: 'u1' })
  })
})

describe('site facts', () => {
  it('falls back to a usable zone and puts the default language first', () => {
    expect(bookingsSiteFactsOf(null)).toEqual({ timeZone: 'Europe/Rome', locales: ['en'] })
    expect(bookingsSiteFactsOf({ timeZone: 'Nope/Zone', defaultLocale: 'it', supportedLocales: ['de', 'it'] })).toEqual({ timeZone: 'Europe/Rome', locales: ['it', 'de', 'en'] })
    expect(bookingsSiteFactsOf({ timeZone: 'America/New_York' }).timeZone).toBe('America/New_York')
  })
})
