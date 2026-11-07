/**
 * Bookings server actions (ADR-044 D5, D6): signed out / no grant are refused
 * before anything is read; the project comes from the caller's grant, never from
 * the input; permission refusals and store failures reach the screen as codes
 * (never a stack, never raw text); `full` carries the session ids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { fail, ok } from '@/lib/reservations/server/errors'
import { bookingRow, makeStore, settings } from '@/lib/reservations/service/__tests__/fake-store'

const h = vi.hoisted(() => ({
  access: null as unknown,
  deps: null as unknown,
  resolved: [] as unknown[],
}))
vi.mock('@/lib/api/project-action', () => ({
  resolveProjectAction: async (slug: unknown) => {
    h.resolved.push(slug)
    return h.access
  },
}))
vi.mock('@/lib/reservations/server/bookings-deps.server', () => ({ getBookingsDeps: () => h.deps }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { cancelBookingAction, confirmBookingAction, extendHoldAction, recordPaymentAction, verifyEligibilityAction } from '../actions'

const PID = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const BID = '22222222-2222-4222-8222-222222222221'
const grantOf = (permissions: string[], projectId = PID) => ({
  ok: true,
  ctx: { userId: 'u1', platformRole: 'tenant_user', projects: [{ projectId, projectSlug: 'cyce', membershipId: 'm', role: 'owner', permissions, enabledModuleIds: ['reservations'] }] },
  grant: { projectId },
})
const ALL = ['reservations.booking.read', 'reservations.booking.write', 'reservations.payment.update']

function setup(storeOpts: Parameters<typeof makeStore>[0] = {}) {
  const s = makeStore({ settings: settings({ acceptBankTransfer: true }), ...storeOpts })
  const reader = {
    listBookings: vi.fn(),
    listTargetOptions: vi.fn(),
    getBookingDetail: vi.fn(async () => ok({ booking: bookingRow({ id: BID, projectId: PID, status: 'awaiting_payment' }), target: { id: 't', ownerType: 'course', ownerPublicId: 'c', editionId: null } })),
  }
  const writer = { verifyEligibility: vi.fn(async () => ok({ verified: 1, reviewCleared: true })) }
  h.deps = { reader, store: s.store, writer, readSite: async () => ({ timeZone: 'Europe/Rome', locales: ['en'] }), now: () => new Date('2026-11-08T10:00:00Z'), randomBytes: (n: number) => new Uint8Array(n), environment: 'production' }
  return { ...s, reader, writer }
}

beforeEach(() => {
  h.access = grantOf(ALL)
  h.resolved.length = 0
  setup()
})

const base = { projectSlug: 'cyce', bookingId: BID }
const payment = { ...base, method: 'cash', amountCents: 1000, paidOn: '2026-11-08' }

describe('signed out and no grant', () => {
  it.each([
    ['unauthenticated', { ok: false, error: 'unauthenticated' }],
    ['forbidden', { ok: false, error: 'forbidden' }],
  ])('%s → the same code, nothing touched', async (code, access) => {
    h.access = access
    const s = setup()
    for (const run of [() => recordPaymentAction(payment), () => confirmBookingAction(base), () => extendHoldAction({ ...base, until: '2026-11-20' }), () => cancelBookingAction(base), () => verifyEligibilityAction(base)]) {
      expect(await run()).toEqual({ ok: false, error: code })
    }
    expect(s.calls).toHaveLength(0)
    expect(s.writer.verifyEligibility).not.toHaveBeenCalled()
  })
})

describe('permission refusals', () => {
  it('without the permission the action answers forbidden and writes nothing', async () => {
    h.access = grantOf(['reservations.booking.read'])
    const s = setup()
    expect(await recordPaymentAction(payment)).toEqual({ ok: false, error: 'forbidden' })
    expect(await confirmBookingAction(base)).toEqual({ ok: false, error: 'forbidden' })
    expect(await cancelBookingAction(base)).toEqual({ ok: false, error: 'forbidden' })
    expect(await extendHoldAction({ ...base, until: '2026-11-20' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await verifyEligibilityAction(base)).toEqual({ ok: false, error: 'forbidden' })
    expect(s.calls).toHaveLength(0)
  })
  it('a payment needs payment.update even for someone who may manage bookings', async () => {
    h.access = grantOf(['reservations.booking.read', 'reservations.booking.write'])
    const s = setup()
    expect(await recordPaymentAction(payment)).toEqual({ ok: false, error: 'forbidden' })
    expect(s.called('recordPayment')).toHaveLength(0)
  })
})

describe('project scoping', () => {
  it('uses the project of the grant, whatever the input says', async () => {
    const s = setup()
    await cancelBookingAction({ ...base, projectId: OTHER } as never)
    await recordPaymentAction({ ...payment, projectId: OTHER } as never)
    expect(s.called('release')[0].args[0]).toBe(PID)
    expect(s.called('recordPayment')[0].args[0]).toBe(PID)
    expect(s.reader.getBookingDetail).toHaveBeenCalledWith(PID, BID)
    expect(h.resolved.every((x) => x === 'cyce')).toBe(true)
  })
})

describe('results', () => {
  it('a payment answers with what happened', async () => {
    setup()
    expect(await recordPaymentAction(payment)).toMatchObject({ ok: true, confirmed: true, paymentStatus: 'paid' })
  })
  it('sessions full → full + the session ids, so the screen can name them', async () => {
    const s = setup()
    ;(s.store.confirm as unknown) = vi.fn(async () => ok({ confirmed: false, replayed: false, full: ['o1'] }))
    expect(await confirmBookingAction(base)).toEqual({ ok: false, error: 'full', occurrenceIds: ['o1'] })
  })
  it('a database refusal maps to its code; an unknown one to the calm fallback', async () => {
    const s = setup()
    ;(s.store.extendHold as unknown) = vi.fn(async () => fail({ kind: 'refused', code: 'cannot_extend' }))
    expect(await extendHoldAction({ ...base, until: '2026-11-20' })).toEqual({ ok: false, error: 'cannot_extend' })
    ;(s.store.extendHold as unknown) = vi.fn(async () => fail({ kind: 'refused', code: 'something_new' }))
    expect(await extendHoldAction({ ...base, until: '2026-11-20' })).toEqual({ ok: false, error: 'failed' })
  })
  it('migration 066 missing → unavailable', async () => {
    setup({ release: fail({ kind: 'unavailable' }) })
    expect(await cancelBookingAction(base)).toEqual({ ok: false, error: 'unavailable' })
  })
  it('an unexpected throw is `failed`, not an exception', async () => {
    const s = setup()
    ;(s.store.release as unknown) = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await cancelBookingAction(base)).toEqual({ ok: false, error: 'failed' })
  })
  it('an authorization error thrown deeper down is `forbidden`', async () => {
    const s = setup()
    ;(s.store.release as unknown) = vi.fn(async () => {
      throw new TenantAuthorizationError('no')
    })
    expect(await cancelBookingAction(base)).toEqual({ ok: false, error: 'forbidden' })
  })
})
