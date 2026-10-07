/**
 * Posts list — end date, topics and the batch runner. Each post goes through
 * its own lifecycle checks; per-item results; refusals before any write.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { POST_BATCH_LIMIT, runPostBatch, setPostCategories, setPostEndDate, setPostFeatured } from '../post-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const NOW = new Date('2026-10-06T10:00:00Z')
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write', 'blog.post.delete'],
  enabledModuleIds: ['blog'],
  ...o,
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })
const post = (id: string, o: Record<string, unknown> = {}) => ({ _id: id, _type: 'post', _rev: `r-${id}`, projectSlug: 'hoffmann', publishedAt: '2026-09-01T00:00:00Z', ...o })

function fake(docs: Record<string, Record<string, unknown>>) {
  const ops: Array<[string, ...unknown[]]> = []
  const mk = () => {
    const tx = {
      patch: (id: string, p: unknown) => (ops.push(['tx.patch', id, p]), tx),
      delete: (id: string) => (ops.push(['tx.delete', id]), tx),
      commit: vi.fn(async () => (ops.push(['tx.commit']), {})),
    }
    return tx
  }
  const patch = (id: string) => {
    const p = {
      ifRevisionId: (r: string) => (ops.push(['ifRevisionId', id, r]), p),
      set: (v: unknown) => (ops.push(['set', id, v]), p),
      unset: (v: unknown) => (ops.push(['unset', id, v]), p),
      commit: vi.fn(async () => (ops.push(['commit', id]), { _rev: 'new' })),
    }
    return p
  }
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    create: vi.fn(),
    patch: vi.fn(patch),
    transaction: vi.fn(mk),
    fetch: vi.fn(async (q: string) => (q.startsWith('count(') ? 1 : q.includes('config.categories') ? ['cura', 'studio'] : null)),
  }
  return { client, ops, deps: { client: client as never, now: () => NOW } }
}
const writes = (f: ReturnType<typeof fake>) => f.ops.filter(([o]) => o === 'commit' || o === 'tx.commit').length

describe('setPostEndDate', () => {
  it('sets expiresAt on the live post and its draft, guarded by both revisions', async () => {
    const f = fake({ p1: post('p1'), 'drafts.p1': post('drafts.p1', { _rev: 'd1' }) })
    const live = await setPostEndDate(ctx(grant()), 'project-a', { id: 'p1', rev: 'r-p1', expiresAt: '2026-12-01T09:00:00Z' }, f.deps)
    expect(live.expiresAt).toBe('2026-12-01T09:00:00.000Z')
    expect(f.ops).toContainEqual(['tx.patch', 'p1', { ifRevisionID: 'r-p1', set: { expiresAt: '2026-12-01T09:00:00.000Z' } }])
    expect(f.ops).toContainEqual(['tx.patch', 'drafts.p1', { ifRevisionID: 'd1', set: { expiresAt: '2026-12-01T09:00:00.000Z' } }])
  })
  it('null removes it; a past date or a stale revision is refused before writing', async () => {
    const f = fake({ p1: post('p1', { expiresAt: '2026-12-01T00:00:00Z' }) })
    await setPostEndDate(ctx(grant()), 'project-a', { id: 'p1', rev: 'r-p1', expiresAt: null }, f.deps)
    expect(f.ops).toContainEqual(['tx.patch', 'p1', { ifRevisionID: 'r-p1', unset: ['expiresAt'] }])
    const g = fake({ p1: post('p1') })
    await expect(setPostEndDate(ctx(grant()), 'project-a', { id: 'p1', rev: 'r-p1', expiresAt: '2026-01-01T00:00:00Z' }, g.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(setPostEndDate(ctx(grant()), 'project-a', { id: 'p1', rev: 'old', expiresAt: '2026-12-01T00:00:00Z' }, g.deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(setPostEndDate(ctx(grant()), 'project-a', { id: 'p1', rev: 'r-p1', expiresAt: 'soon' }, g.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(writes(g)).toBe(0)
  })
})

describe('setPostCategories', () => {
  it("only this site's topics; applied to live and draft", async () => {
    const f = fake({ p1: post('p1'), 'drafts.p1': post('drafts.p1', { _rev: 'd1' }) })
    await setPostCategories(ctx(grant()), 'project-a', { id: 'p1', categories: ['cura', 'cura'] }, f.deps)
    expect(f.ops).toContainEqual(['tx.patch', 'p1', { ifRevisionID: 'r-p1', set: { categories: ['cura'] } }])
    expect(f.ops).toContainEqual(['tx.patch', 'drafts.p1', { ifRevisionID: 'd1', set: { categories: ['cura'] } }])
    const g = fake({ p1: post('p1') })
    await expect(setPostCategories(ctx(grant()), 'project-a', { id: 'p1', categories: ['hacked'] }, g.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(writes(g)).toBe(0)
  })
  it("another project's post is not_found", async () => {
    const f = fake({ p1: post('p1', { projectSlug: 'livener' }) })
    await expect(setPostCategories(ctx(grant()), 'project-a', { id: 'p1', categories: [] }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('setPostFeatured', () => {
  it('sets featured on the live post and its draft, guarded by both revisions', async () => {
    const f = fake({ p1: post('p1'), 'drafts.p1': post('drafts.p1', { _rev: 'd1' }) })
    await setPostFeatured(ctx(grant()), 'project-a', { id: 'p1', featured: true }, f.deps)
    expect(f.ops).toContainEqual(['tx.patch', 'p1', { ifRevisionID: 'r-p1', set: { featured: true } }])
    expect(f.ops).toContainEqual(['tx.patch', 'drafts.p1', { ifRevisionID: 'd1', set: { featured: true } }])
    const g = fake({ 'drafts.d1': post('drafts.d1', { _rev: 'dr', publishedAt: undefined }) })
    await setPostFeatured(ctx(grant()), 'project-a', { id: 'd1', featured: false }, g.deps)
    expect(g.ops).toContainEqual(['tx.patch', 'drafts.d1', { ifRevisionID: 'dr', set: { featured: false } }])
    expect(g.ops.filter(([o, id]) => o === 'tx.patch' && id === 'd1')).toHaveLength(0)
  })
  it('refuses a viewer before any read; foreign, unknown and non-boolean input write nothing', async () => {
    const f = fake({ p1: post('p1'), p2: post('p2', { projectSlug: 'livener' }) })
    await expect(setPostFeatured(ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a', { id: 'p1', featured: true }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    await expect(setPostFeatured(ctx(grant()), 'project-a', { id: 'p2', featured: true }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(setPostFeatured(ctx(grant()), 'project-a', { id: 'nope', featured: true }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(setPostFeatured(ctx(grant()), 'project-a', { id: 'p1', featured: 'yes' as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(writes(f)).toBe(0)
  })
  it('a moved revision is a conflict', async () => {
    const f = fake({ p1: post('p1') })
    f.client.transaction.mockImplementationOnce(() => {
      const tx = { patch: () => tx, commit: async () => { throw Object.assign(new Error('rev'), { statusCode: 409 }) } }
      return tx as never
    })
    await expect(setPostFeatured(ctx(grant()), 'project-a', { id: 'p1', featured: true }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('runPostBatch', () => {
  it('refuses a viewer, another project, unknown ops and too many ids before any read', async () => {
    const f = fake({})
    await expect(runPostBatch(ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a', { ids: ['p1'], op: 'offline' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(runPostBatch(ctx(grant()), 'project-b', { ids: ['p1'], op: 'offline' }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(runPostBatch(ctx(grant()), 'project-a', { ids: ['p1'], op: 'nuke' as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    const many = Array.from({ length: POST_BATCH_LIMIT + 1 }, (_, i) => `p${i}`)
    await expect(runPostBatch(ctx(grant()), 'project-a', { ids: many, op: 'offline' }, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('takes several offline with per-item results (unknown and foreign ids fail alone)', async () => {
    const f = fake({ p1: post('p1'), p2: post('p2'), p3: post('p3', { projectSlug: 'livener' }) })
    const r = await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1', 'p2', 'p3', 'nope', '../x'], op: 'offline' }, f.deps)
    expect(r).toEqual([
      { id: 'p1', ok: true },
      { id: 'p2', ok: true },
      { id: 'p3', ok: false, error: 'not_found' },
      { id: 'nope', ok: false, error: 'not_found' },
      { id: '../x', ok: false, error: 'not_found' },
    ])
    expect(f.ops.filter(([o, , v]) => o === 'set' && JSON.stringify(v).includes('expiresAt'))).toHaveLength(2)
  })

  it('delete: drafts go, live posts need an owner', async () => {
    const f = fake({ p1: post('p1'), 'drafts.d1': post('drafts.d1', { _rev: 'dr', publishedAt: undefined }) })
    const r = await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1', 'd1'], op: 'delete' }, f.deps)
    expect(r).toEqual([
      { id: 'p1', ok: false, error: 'forbidden' },
      { id: 'd1', ok: true },
    ])
    const o = fake({ p1: post('p1') })
    expect(await runPostBatch(ctx(grant({ role: 'owner', permissions: ['blog.post.read', 'blog.post.write', 'blog.post.delete', 'blog.published.delete'] })), 'project-a', { ids: ['p1'], op: 'delete' }, o.deps)).toEqual([{ id: 'p1', ok: true }])
  })

  it('end date and topics run per post', async () => {
    const f = fake({ p1: post('p1'), p2: post('p2') })
    expect(await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1', 'p2'], op: 'endDate', expiresAt: '2026-12-01T00:00:00Z' }, f.deps)).toEqual([
      { id: 'p1', ok: true },
      { id: 'p2', ok: true },
    ])
    expect(await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1'], op: 'categories', categories: ['studio'] }, f.deps)).toEqual([{ id: 'p1', ok: true }])
    expect(await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1', 'p2'], op: 'featured', featured: true }, f.deps)).toEqual([
      { id: 'p1', ok: true },
      { id: 'p2', ok: true },
    ])
    expect(await runPostBatch(ctx(grant()), 'project-a', { ids: ['p1'], op: 'featured' }, f.deps)).toEqual([{ id: 'p1', ok: false, error: 'invalid_value' }])
  })
})
