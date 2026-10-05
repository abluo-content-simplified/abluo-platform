/**
 * S5 — the publish server action, with the real guard and grant resolution.
 * Only the I/O boundaries are faked (session context, Sanity write client),
 * as in `src/app/api/__tests__/route-auth-matrix.test.ts`. Every refusal must
 * happen with NO Sanity call at all.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

const ID = '11111111-2222-4333-8444-555555555555'
const sanityCalls: string[] = []
const ops: Array<[string, ...unknown[]]> = []

vi.mock('@/lib/sanity/server-clients', () => {
  const tx = {
    patch: (id: string, p: unknown) => (sanityCalls.push('tx:patch'), ops.push(['patch', id, p]), tx),
    createOrReplace: (d: unknown) => (sanityCalls.push('tx:createOrReplace'), ops.push(['createOrReplace', d]), tx),
    delete: (id: string) => (sanityCalls.push('tx:delete'), ops.push(['delete', id]), tx),
    commit: async () => (sanityCalls.push('tx:commit'), { results: [] }),
  }
  const client = {
    getDocument: async (id: string) => {
      sanityCalls.push(`getDocument:${id}`)
      return id.startsWith('drafts.')
        ? { _id: id, _type: 'post', _rev: 'r1', projectSlug: 'tenant-a-site', title: { it: 'Ciao mondo' }, body: { it: [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text: 'Ciao' }] }] }, wizard: { step: 'publish' } }
        : undefined
    },
    fetch: async (q: string) => {
      sanityCalls.push('fetch')
      return q.includes('siteConfig') ? { defaultLocale: 'it', supportedLocales: ['it'] } : []
    },
    transaction: () => (sanityCalls.push('transaction'), tx),
    create: async () => (sanityCalls.push('create'), {}),
    patch: () => (sanityCalls.push('patch'), {}),
  }
  return { sanityWriteClient: client, sanityServerReadClient: client }
})
vi.mock('@/lib/sanity/client', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, sanityClient: { fetch: async () => (sanityCalls.push('website:fetch'), null) } }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let tenantCtx: unknown = null
vi.mock('@/lib/api/tenant-context', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, getTenantAuthorizationContext: async () => tenantCtx }
})

const grantA = {
  projectId: 'project-a',
  projectSlug: 'tenant-a-site',
  membershipId: 'tenant-owner:tenant-a',
  role: 'owner',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
}
const viewerA = { ...grantA, role: 'viewer', permissions: ['blog.post.read'] }
const load = () => import('../publish-actions')
const input = (o: Record<string, unknown> = {}) => ({ projectSlug: 'tenant-a-site', id: ID, rev: 'r1', mode: 'now' as const, ...o })

beforeAll(async () => {
  await load()
}, 30_000)

beforeEach(() => {
  tenantCtx = null
  sanityCalls.length = 0
  ops.length = 0
})

describe('publishPostDraftAction', () => {
  it('unauthenticated → refused, no Sanity call', async () => {
    const a = await load()
    expect(await a.publishPostDraftAction(input())).toEqual({ ok: false, error: 'unauthenticated' })
    expect(sanityCalls).toEqual([])
  })

  it("tenant A cannot publish in tenant B's project", async () => {
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    expect(await a.publishPostDraftAction(input({ projectSlug: 'tenant-b-site' }))).toEqual({ ok: false, error: 'forbidden' })
    expect(sanityCalls).toEqual([])
  })

  it('a viewer cannot publish', async () => {
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    const a = await load()
    expect(await a.publishPostDraftAction(input())).toEqual({ ok: false, error: 'forbidden' })
    expect(sanityCalls).toEqual([])
  })

  it('a schedule in the past is refused before any Sanity call', async () => {
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    const r = await a.publishPostDraftAction(input({ mode: 'schedule', publishAt: '2020-01-01T00:00:00Z' }))
    expect(r).toEqual({ ok: false, error: 'invalid_schedule' })
    expect(sanityCalls).toEqual([])
  })

  it('an owner publishes; id, type and projectSlug come from the server', async () => {
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    const r = await a.publishPostDraftAction({ ...input(), projectId: 'project-b', _type: 'page' } as never)
    expect(r).toMatchObject({ ok: true, id: ID, slugs: { it: 'ciao-mondo' } })
    const doc = ops.find(([o]) => o === 'createOrReplace')![1] as Record<string, unknown>
    expect(doc).toMatchObject({ _id: ID, _type: 'post', projectSlug: 'tenant-a-site' })
    expect(doc).not.toHaveProperty('wizard')
    expect(ops.at(-1)).toEqual(['delete', `drafts.${ID}`])
    expect(sanityCalls.at(-1)).toBe('tx:commit')
  })
})
