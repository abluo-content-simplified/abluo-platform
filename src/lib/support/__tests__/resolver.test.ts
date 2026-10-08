/**
 * Support mode — the acting-principal resolver (ADR-028 §8). Support plugs into
 * `getTenantAuthorizationContext()` at ONE place; this proves who gets it:
 * only an Abluo admin, at AAL2, with a cookie naming an open visit of their
 * own, on a project whose slug is unique. Everyone else resolves exactly as
 * before (their own memberships). Every mutation-purpose resolution inside a
 * visit is audited; page renders are not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ADMIN = '00000000-0000-4000-8000-00000000000a'
const CLIENT = '00000000-0000-4000-8000-00000000000c'
const PROJECT = '00000000-0000-4000-8000-000000000101'
const SESSION = '00000000-0000-4000-8000-000000000001'

const state = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown> },
  aal: 'aal2' as string | null,
  cookie: null as string | null,
  visit: null as unknown,
  slugCount: 1,
}))

const support = vi.hoisted(() => ({
  readSupportCookie: vi.fn(async () => state.cookie),
  loadOpenVisit: vi.fn(async () => state.visit),
  auditSupportAction: vi.fn(async () => {}),
}))
vi.mock('@/lib/support/server', () => support)

/** A thenable query chain that answers every select with no rows. */
function emptyChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order']) chain[m] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.aal }, error: null }) },
    },
    from: () => emptyChain(),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
  runAsTrustedSystemOperation: async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      from: () => ({
        select: () => ({
          in: async (_col: string, slugs: string[]) => ({
            data: slugs.flatMap((slug) => Array.from({ length: state.slugCount }, () => ({ slug }))),
            error: null,
          }),
        }),
      }),
    }),
}))

vi.mock('@/lib/sanity/client', () => ({
  tenantClient: () => ({ fetchForTenant: async () => ['blog', 'forms'] }),
}))

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { can } from '@/lib/authz/check'

const openVisit = (over: Record<string, unknown> = {}) => ({
  session: {
    id: SESSION,
    projectId: PROJECT,
    adminUserId: ADMIN,
    role: 'owner',
    status: 'viewing',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    requestedAt: null,
    decidedAt: null,
    decidedBy: null,
    expiresAt: null,
    revokedAt: null,
    contactRequestsShownAt: null,
    endedAt: null,
    ...over,
  },
  project: { id: PROJECT, slug: 'studio', name: 'Studio' },
})

const P = { kind: 'project' as const, projectId: PROJECT }

beforeEach(() => {
  state.user = { id: ADMIN, app_metadata: { platform_role: 'abluo_admin' } }
  state.aal = 'aal2'
  state.cookie = SESSION
  state.visit = openVisit()
  state.slugCount = 1
  vi.clearAllMocks()
})

describe('getTenantAuthorizationContext — support mode', () => {
  it('no session → null', async () => {
    state.user = null
    expect(await getTenantAuthorizationContext()).toBeNull()
  })

  it('admin + AAL2 + open visit → the support context for that one project', async () => {
    const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
    expect(ctx?.support).toMatchObject({ sessionId: SESSION, projectId: PROJECT, role: 'owner', purpose: 'render' })
    expect(ctx?.userId).toBe(ADMIN)
    expect(ctx?.projects.map((p) => p.projectSlug)).toEqual(['studio'])
    expect(support.loadOpenVisit).toHaveBeenCalledWith(SESSION, ADMIN)
    expect(support.auditSupportAction).not.toHaveBeenCalled() // renders are not audited per request
  })

  it('defaults to mutation: writes refused in a view-only visit, and the action is audited', async () => {
    const ctx = await getTenantAuthorizationContext()
    expect(ctx?.support?.purpose).toBe('mutation')
    expect(can(ctx, 'blog.post.write', P)).toBe(false)
    expect(can(ctx, 'blog.post.read', P)).toBe(true)
    expect(support.auditSupportAction).toHaveBeenCalledWith(ADMIN, SESSION, PROJECT, false, 'owner')
  })

  it('allowed visit → writes pass in a mutation context, audited as writesAllowed', async () => {
    state.visit = openVisit({ status: 'allowed', requestedAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: CLIENT, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
    const ctx = await getTenantAuthorizationContext()
    expect(can(ctx, 'blog.post.write', P)).toBe(true)
    expect(support.auditSupportAction).toHaveBeenCalledWith(ADMIN, SESSION, PROJECT, true, 'owner')
  })

  it('expired approval → refused again', async () => {
    state.visit = openVisit({ status: 'allowed', requestedAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: CLIENT, expiresAt: new Date(Date.now() - 1_000).toISOString() })
    const ctx = await getTenantAuthorizationContext()
    expect(ctx?.support?.status).toBe('expired')
    expect(can(ctx, 'blog.post.write', P)).toBe(false)
  })

  it('a non-admin with a (forged) cookie gets only their own memberships', async () => {
    state.user = { id: CLIENT, app_metadata: {} }
    const ctx = await getTenantAuthorizationContext()
    expect(ctx?.support).toBeUndefined()
    expect(ctx?.projects).toEqual([])
    expect(support.loadOpenVisit).not.toHaveBeenCalled()
  })

  it('an admin without two-factor (AAL1) is not in support mode', async () => {
    state.aal = 'aal1'
    const ctx = await getTenantAuthorizationContext()
    expect(ctx?.support).toBeUndefined()
    expect(support.loadOpenVisit).not.toHaveBeenCalled()
  })

  it('no cookie, or a visit that is not open / not this admin\'s → normal resolution', async () => {
    state.cookie = null
    expect((await getTenantAuthorizationContext())?.support).toBeUndefined()
    state.cookie = SESSION
    state.visit = null
    expect((await getTenantAuthorizationContext())?.support).toBeUndefined()
  })

  it('a project slug shared across tenants is not honoured (fail closed)', async () => {
    state.slugCount = 2
    expect((await getTenantAuthorizationContext())?.support).toBeUndefined()
  })
})
