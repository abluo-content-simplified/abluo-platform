/**
 * Project-scoped resolution (performance handoff 2026-10-16, fix 2).
 *
 * Server actions resolve their caller with `{ project }`: the grant for that
 * one project must be exactly the grant the full resolution yields (same role,
 * same permissions — isolation unchanged), other projects are absent, and the
 * per-project Sanity module lookup runs for the requested project only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, type Tables } from '@/lib/invitations/__tests__/fake-db'

let admin: ReturnType<typeof fakeAdmin>
const moduleLookups: string[] = []
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: async (_r: string, fn: (c: unknown) => unknown) => fn(admin) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => admin }))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: (slug: string) => ({ fetchForTenant: async () => (moduleLookups.push(slug), ['catalogue', 'blog']) }),
}))

import { loadTenantAuthorizationContext } from '../tenant-context'

const users = { tom: { id: 'u-tom', email: 't@x.it' }, other: { id: 'u-other', email: 'o@x.it' } }
beforeEach(() => {
  moduleLookups.length = 0
  const tables: Tables = {
    tenants: [{ id: 'tA', display_name: 'A' }, { id: 'tB', display_name: 'B' }, { id: 'tC', display_name: 'C' }],
    projects: [
      { id: 'p1', slug: 'tmz', name: 'TMZ', tenant_id: 'tA' },
      { id: 'p2', slug: 'livener', name: 'L', tenant_id: 'tA' },
      { id: 'p3', slug: 'cyce', name: 'C', tenant_id: 'tB' },
      { id: 'p4', slug: 'secret', name: 'S', tenant_id: 'tC' },
    ],
    tenant_members: [
      { id: 'tm1', tenant_id: 'tA', user_id: 'u-tom', role: 'owner', extra_permissions: [] },
      { id: 'tm2', tenant_id: 'tC', user_id: 'u-other', role: 'owner', extra_permissions: [] },
    ],
    project_members: [{ id: 'pm1', project_id: 'p3', user_id: 'u-tom', role: 'editor', extra_permissions: [] }],
    profiles: [],
    invitations: [],
  }
  admin = fakeAdmin(tables, users)
})
const load = (project?: string) => loadTenantAuthorizationContext(admin as never, { userId: 'u-tom', platformRole: 'tenant_user' }, { project })

describe('project-scoped resolution', () => {
  it('yields the same grant as the full resolution, and only that one', async () => {
    const full = await load()
    expect(full.projects.map((p) => p.projectSlug).sort()).toEqual(['cyce', 'livener', 'tmz'])
    for (const slug of ['tmz', 'cyce']) {
      const scoped = await load(slug)
      expect(scoped.projects).toEqual(full.projects.filter((p) => p.projectSlug === slug))
      expect(scoped.tenants).toEqual(full.tenants)
    }
  })
  it('looks up enabled modules for the requested project only', async () => {
    await load()
    expect(moduleLookups.sort()).toEqual(['cyce', 'livener', 'tmz'])
    moduleLookups.length = 0
    await load('tmz')
    expect(moduleLookups).toEqual(['tmz'])
  })
  it('a project the caller cannot reach stays unreachable when asked for by name', async () => {
    expect((await load('secret')).projects).toEqual([])
    expect((await load('nope')).projects).toEqual([])
  })
})
