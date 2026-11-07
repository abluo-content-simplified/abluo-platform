/**
 * Bookings routes (ADR-044 D16.15): signed out → sign in; no grant, no Reservations
 * module or no `reservations.booking.read` → 404 with nothing read; an allowed
 * person gets the list / the booking; a database without migration 066 gets the
 * calm "not available yet" state; a booking that is not in this project is a 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  reads: [] as string[],
  list: { ok: true, view: { page: { rows: [], total: 0, page: 1, pageSize: 25 }, targets: [], timeZone: 'Europe/Rome', can: { write: true, pay: true } } } as { ok: boolean; view?: unknown; error?: string },
  detail: { ok: true, view: { detail: { id: 'd' }, timeZone: 'Europe/Rome', can: { write: true, pay: true } } } as { ok: boolean; view?: unknown; error?: string },
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => h.ctx }))
vi.mock('@/lib/reservations/server/bookings-deps.server', () => ({ getBookingsDeps: () => ({}) }))
vi.mock('@/lib/reservations/server/bookings-service', () => ({
  BOOKING_READ_PERMISSION: 'reservations.booking.read',
  loadBookingList: async (_c: unknown, _p: string, filters: unknown) => {
    h.reads.push(`list ${JSON.stringify(filters)}`)
    return h.list
  },
  loadBookingDetail: async (_c: unknown, _p: string, id: string) => {
    h.reads.push(`detail ${id}`)
    return h.detail
  },
}))
vi.mock('@/components/app/ui/BackLink', () => ({ BackLink: () => null }))
vi.mock('@/components/client/reservations/BookingsBrowser', () => ({ BookingsBrowser: (p: unknown) => ({ type: 'BookingsBrowser', props: p }) }))
vi.mock('@/components/client/reservations/BookingDetailView', () => ({ BookingDetailView: (p: unknown) => ({ type: 'BookingDetailView', props: p }) }))

import BookingsPage from '../page'
import BookingDetailPage from '../[id]/page'

const PID = '11111111-1111-4111-8111-111111111111'
const ctx = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: [{ projectId: PID, projectSlug: 'cyce', membershipId: 'm', role: 'owner', permissions: ['reservations.booking.read'], enabledModuleIds: ['reservations'], ...over }],
})
const list = (sp: Record<string, string> = {}) => BookingsPage({ params: Promise.resolve({ tenant: 'cyce' }), searchParams: Promise.resolve(sp) })
const one = () => BookingDetailPage({ params: Promise.resolve({ tenant: 'cyce', id: 'b1' }) })

beforeEach(() => {
  h.reads.length = 0
  h.ctx = ctx()
  h.list = { ok: true, view: { page: { rows: [], total: 0, page: 1, pageSize: 25 }, targets: [], timeZone: 'Europe/Rome', can: { write: true, pay: true } } }
  h.detail = { ok: true, view: { detail: { id: 'd' }, timeZone: 'Europe/Rome', can: { write: true, pay: true } } }
})

describe.each([
  ['list', list, '/cyce/bookings'],
  ['detail', one, '/cyce/bookings/b1'],
])('%s route gate', (_n, open, url) => {
  it('signed out → sign in, back here', async () => {
    h.ctx = null
    await expect(open()).rejects.toThrow(`REDIRECT /login?next=${url}`)
  })
  it.each([
    ['no grant on the project', () => ({ projects: [] })],
    ['Reservations not installed', () => ctx({ enabledModuleIds: ['courses'] })],
    ['no booking.read', () => ctx({ permissions: [] })],
  ])('%s → 404, nothing read', async (_m, make) => {
    h.ctx = make()
    await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.reads).toEqual([])
  })
})

describe('list', () => {
  it('passes the address filters on, dropping unknown ones', async () => {
    const page = (await list({ status: 'held', payment: 'x', q: 'anna', page: '2' })) as { props: { children: { props: { query: unknown } } } }
    expect(h.reads[0]).toContain('"status":"held"')
    expect(h.reads[0]).toContain('"page":2')
    expect(h.reads[0]).not.toContain('x')
    expect(page.props.children.props.query).toMatchObject({ status: 'held', paymentStatus: null, q: 'anna' })
  })
  it('migration 066 missing → the calm unavailable state', async () => {
    h.list = { ok: false, error: 'unavailable' }
    const page = (await list()) as { props: { children: { props: { unavailable?: boolean } } } }
    expect(page.props.children.props.unavailable).toBe(true)
  })
})

describe('detail', () => {
  it('opens the booking', async () => {
    const page = (await one()) as { props: { children: { props: { projectSlug: string } } } }
    expect(h.reads).toEqual(['detail b1'])
    expect(page.props.children.props.projectSlug).toBe('cyce')
  })
  it('a booking that is not in this project → 404', async () => {
    h.detail = { ok: false, error: 'not_found' }
    await expect(one()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
