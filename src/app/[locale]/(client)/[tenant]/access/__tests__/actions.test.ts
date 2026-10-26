/**
 * ADR-040 B2.5 — the dashboard's Access actions, through the REAL permission
 * resolver and the REAL assertModuleAction (via authorizeAccessManagement):
 * support visits, a module that is off, roles without `members.access.manage`
 * and ids from another project are all refused before anything changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import type { AccessRole } from '@/lib/authz/roles'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createFakeStore, type FakeStore } from '@/lib/access/__tests__/fake-store'
import { createFakeFiles, type FakeFiles } from '@/lib/access/__tests__/fake-files'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
const h = vi.hoisted(() => ({ store: null as unknown as FakeStore, files: null as unknown as FakeFiles, opened: 0, sanityDocs: new Map<string, Record<string, unknown>>(), commits: [] as unknown[] }))
vi.mock('@/lib/access/server', () => ({
  withSiteAccessStore: async (_reason: string, fn: (s: unknown, f: unknown) => Promise<unknown>) => {
    h.opened++
    return fn(h.store, h.files)
  },
  accessEnvironment: () => 'production',
}))
vi.mock('@/lib/sanity/client', async (orig) => ({
  ...((await orig()) as object),
  sanityClient: { fetch: async () => ({ defaultLocale: 'it', supportedLocales: ['it', 'en'] }) },
}))
vi.mock('@/lib/sanity/server-clients', () => ({
  sanityWriteClient: {
    getDocument: async (id: string) => h.sanityDocs.get(id),
    fetch: async () => 1,
    transaction() {
      const ops: unknown[] = []
      const tx = { patch: (id: string, p: unknown) => (ops.push({ id, p }), tx), commit: async () => void h.commits.push(ops) }
      return tx
    },
  },
}))

import {
  createAccessGroupAction,
  renameAccessGroupAction,
  setAccessGroupArchivedAction,
  setAccessGroupPasswordAction,
  signOutEveryoneAction,
} from '../actions'

const P_A = randomUUID(), P_B = randomUUID()
function grant(projectId: string, role: AccessRole, enabled = true): ProjectGrant {
  const enabledModuleIds = enabled ? ['blog', 'members'] : ['blog']
  return {
    projectId,
    projectSlug: asSupabaseProjectSlug(projectId === P_A ? 'site-a' : 'site-b'),
    membershipId: `m-${role}`,
    role,
    permissions: resolveProjectPermissions({ role, enabledModuleIds }).permissions,
    enabledModuleIds,
  }
}
function as(g: ProjectGrant, extra: Partial<TenantAuthorizationContext> = {}) {
  const ctx: TenantAuthorizationContext = { userId: 'u1', platformRole: 'tenant_user', projects: [g], ...extra }
  access.mockResolvedValue({ ok: true, ctx, grant: g })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.store = createFakeStore()
  h.files = createFakeFiles()
  h.opened = 0
  h.sanityDocs.clear()
  h.commits.length = 0
  as(grant(P_A, 'owner'))
})

describe('who may act', () => {
  it('an Owner creates a group with its password; the name is stored in the site language', async () => {
    const r = await createAccessGroupAction({ projectSlug: 'site-a', name: 'Genitori', password: 'kitchen-table-7' })
    expect(r).toMatchObject({ ok: true })
    expect(h.store.groups[0]).toMatchObject({ projectId: P_A, name: { it: 'Genitori' } })
    expect(JSON.stringify(r)).not.toContain('kitchen-table-7')
  })

  it('a support visit is refused before the store is even opened — even with live-edit approval', async () => {
    as(grant(P_A, 'owner'), { support: { mode: 'live_edit' } as never })
    for (const r of [
      await createAccessGroupAction({ projectSlug: 'site-a', name: 'x', password: 'kitchen-table-7' }),
      await setAccessGroupPasswordAction({ projectSlug: 'site-a', groupId: randomUUID(), password: 'kitchen-table-7' }),
      await signOutEveryoneAction({ projectSlug: 'site-a' }),
    ]) expect(r).toEqual({ ok: false, error: 'support_mode' })
    expect(h.opened).toBe(0)
    expect(h.store.groups).toHaveLength(0)
  })

  it('with the module off, nothing can be managed (forbidden), and nothing is written', async () => {
    as(grant(P_A, 'owner', false))
    expect(await createAccessGroupAction({ projectSlug: 'site-a', name: 'x', password: 'kitchen-table-7' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await signOutEveryoneAction({ projectSlug: 'site-a' })).toEqual({ ok: false, error: 'forbidden' })
    expect(h.store.groups).toHaveLength(0)
  })

  it('an editor (no members.access.manage) is forbidden', async () => {
    as(grant(P_A, 'editor'))
    expect(await createAccessGroupAction({ projectSlug: 'site-a', name: 'x', password: 'kitchen-table-7' })).toEqual({ ok: false, error: 'forbidden' })
  })

  it('unauthenticated and unknown-project callers never reach the store', async () => {
    access.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    expect(await signOutEveryoneAction({ projectSlug: 'site-a' })).toEqual({ ok: false, error: 'unauthenticated' })
    access.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect(await signOutEveryoneAction({ projectSlug: 'site-x' })).toEqual({ ok: false, error: 'forbidden' })
    expect(h.opened).toBe(0)
  })
})

describe('tenant isolation', () => {
  it('ids from another project are not found — groups and passwords', async () => {
    as(grant(P_B, 'owner'))
    await createAccessGroupAction({ projectSlug: 'site-b', name: 'B', password: 'garden-gate-42' })
    const gB = h.store.groups[0].id
    const cB = h.store.creds[0].id
    as(grant(P_A, 'owner'))
    expect(await setAccessGroupPasswordAction({ projectSlug: 'site-a', groupId: gB, credentialId: cB, password: 'stolen-pass-123' })).toEqual({ ok: false, error: 'not_found' })
    expect(await renameAccessGroupAction({ projectSlug: 'site-a', groupId: gB, name: 'x' })).toEqual({ ok: false, error: 'not_found' })
    expect((await setAccessGroupArchivedAction({ projectSlug: 'site-a', groupId: gB, archived: true })).ok).toBe(false)
    expect(h.store.groups[0].archivedAt).toBeNull()
  })
})

describe('destructive actions and their feedback', () => {
  it('changing a password reports how many visitors were signed out; sign out everyone too', async () => {
    await createAccessGroupAction({ projectSlug: 'site-a', name: 'A', password: 'kitchen-table-7' })
    const g = h.store.groups[0].id, c = h.store.creds[0].id
    const sign = () => h.store.unlock({ projectId: P_A, environment: 'production', credentialId: c, credentialVersion: h.store.creds[0].version, currentTokenHash: null, newTokenHash: createHash('sha256').update(randomUUID()).digest('hex'), sessionSeconds: 3600, attemptId: null, deviceLabel: null })
    await sign(); await sign()
    expect(await setAccessGroupPasswordAction({ projectSlug: 'site-a', groupId: g, credentialId: c, password: 'new-password-99' })).toEqual({ ok: true, signedOut: 2 })
    await sign()
    expect(await signOutEveryoneAction({ projectSlug: 'site-a' })).toEqual({ ok: true, signedOut: 1 })
  })

  it('password problems come back as codes, never the password', async () => {
    expect(await createAccessGroupAction({ projectSlug: 'site-a', name: 'A', password: 'short' })).toEqual({ ok: false, error: 'password_too_short' })
    await createAccessGroupAction({ projectSlug: 'site-a', name: 'A', password: 'kitchen-table-7' })
    expect(await createAccessGroupAction({ projectSlug: 'site-a', name: 'B', password: 'kitchen-table-7' })).toEqual({ ok: false, error: 'password_duplicate' })
    expect(await createAccessGroupAction({ projectSlug: 'site-a', name: '  ', password: 'other-pass-123' })).toEqual({ ok: false, error: 'name_needed' })
  })
})
