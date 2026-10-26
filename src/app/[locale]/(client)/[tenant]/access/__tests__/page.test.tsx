/**
 * ADR-040 B2.5 — the Access page is a 404 (like a page that does not exist)
 * for a project without the module, for people without
 * `members.access.read`, and for a project the caller has no grant on; a
 * support visit renders read-only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ ctx: null as unknown, load: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => h.ctx }))
vi.mock('@/lib/access/dashboard', () => ({
  ACCESS_READ_PERMISSION: 'members.access.read',
  ACCESS_MANAGE_PERMISSION: 'members.access.manage',
  loadAccessDashboard: (...a: unknown[]) => h.load(...a),
}))
vi.mock('@/components/client/access/AccessScreen', () => ({ AccessScreen: (p: unknown) => ({ type: 'AccessScreen', props: p }) }))
vi.mock('@/components/app/ui/PageShell', () => ({ PageShell: ({ children }: { children: unknown }) => children }))

import AccessPage from '../page'

const grant = (over: Record<string, unknown> = {}) => ({
  projectId: 'p-a', projectSlug: 'site-a', membershipId: 'm', role: 'owner',
  permissions: ['members.access.read', 'members.access.manage'], enabledModuleIds: ['members'], ...over,
})
const open = () => AccessPage({ params: Promise.resolve({ tenant: 'site-a' }) })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const screenProps = (el: any) => el.props.children.props

beforeEach(() => {
  h.load.mockReset().mockResolvedValue({ notReady: true })
})

describe('the Access page', () => {
  it('anonymous → sign in', async () => {
    h.ctx = null
    await expect(open()).rejects.toThrow('REDIRECT /login?next=/site-a/access')
  })
  it('module off, no read permission, or no grant on this project → 404, and nothing is loaded', async () => {
    for (const g of [grant({ enabledModuleIds: ['blog'] }), grant({ permissions: [] }), grant({ projectSlug: 'site-b' })]) {
      h.ctx = { userId: 'u', platformRole: 'tenant_user', projects: [g] }
      await expect(open()).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(h.load).not.toHaveBeenCalled()
  })
  it('an Owner can manage; a reader and a support visit cannot', async () => {
    h.ctx = { userId: 'u', platformRole: 'tenant_user', projects: [grant()] }
    expect(screenProps(await open())).toMatchObject({ canManage: true, supportVisit: false })
    h.ctx = { userId: 'u', platformRole: 'tenant_user', projects: [grant({ permissions: ['members.access.read'] })] }
    expect(screenProps(await open())).toMatchObject({ canManage: false })
    h.ctx = { userId: 'u', platformRole: 'tenant_user', projects: [grant()], support: { mode: 'live_edit' } }
    expect(screenProps(await open())).toMatchObject({ canManage: false, supportVisit: true })
  })
})
