/**
 * Bookings → Booking rules route (ADR-044 D13): signed out → sign in; no grant,
 * no Reservations module or no `reservations.booking.read` → 404 with nothing
 * read; an allowed person gets the screen; a database without migration 066 gets
 * the calm "not available yet" state (initial = null), never an error. `/bookings`
 * redirects to the rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  reads: [] as string[],
  load: { ok: true, view: { version: 1 } } as { ok: boolean; view?: unknown; error?: string },
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => h.ctx }))
vi.mock('@/lib/reservations/server/settings-site.server', () => ({ readSiteFacts: async () => ({}) }))
vi.mock('@/lib/reservations/server/settings-store.server', () => ({ getSettingsStore: () => ({}) }))
vi.mock('@/lib/reservations/server/settings-service', () => ({
  BOOKING_READ_PERMISSION: 'reservations.booking.read',
  loadBookingRules: async () => {
    h.reads.push('rules')
    return h.load
  },
}))
vi.mock('@/components/client/reservations/BookingRules', () => ({ BookingRules: (p: unknown) => ({ type: 'BookingRules', props: p }) }))

import BookingsIndexPage from '../../page'
import BookingRulesPage from '../page'

const PID = '11111111-1111-4111-8111-111111111111'
const ctx = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: [{ projectId: PID, projectSlug: 'cyce', membershipId: 'm', role: 'owner', permissions: ['reservations.booking.read'], enabledModuleIds: ['reservations'], ...over }],
})
const open = () => BookingRulesPage({ params: Promise.resolve({ tenant: 'cyce' }) })

beforeEach(() => {
  h.reads.length = 0
  h.ctx = ctx()
  h.load = { ok: true, view: { version: 1 } }
})

describe('Booking rules route', () => {
  it('signed out → sign in, back to the rules', async () => {
    h.ctx = null
    await expect(open()).rejects.toThrow('REDIRECT /login?next=/cyce/bookings/rules')
  })
  it.each([
    ['no grant on the project', () => ({ projects: [] })],
    ['Reservations not installed', () => ctx({ enabledModuleIds: ['courses'] })],
    ['no booking.read', () => ctx({ permissions: [] })],
  ])('%s → 404, nothing read', async (_n, make) => {
    h.ctx = make()
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.reads).toEqual([])
  })
  it('opens the screen with the loaded view', async () => {
    const page = (await open()) as { props: { children: { props: { projectSlug: string; initial: unknown } } } }
    expect(h.reads).toEqual(['rules'])
    expect(page.props.children.props).toEqual({ projectSlug: 'cyce', initial: { version: 1 } })
  })
  it('migration 066 missing → the screen with no data (calm state), not an error', async () => {
    h.load = { ok: false, error: 'unavailable' }
    const page = (await open()) as { props: { children: { props: { initial: unknown } } } }
    expect(page.props.children.props.initial).toBeNull()
  })
  it('/bookings redirects to the rules', async () => {
    await expect(BookingsIndexPage({ params: Promise.resolve({ tenant: 'cyce' }) })).rejects.toThrow('REDIRECT /cyce/bookings/rules')
  })
})
