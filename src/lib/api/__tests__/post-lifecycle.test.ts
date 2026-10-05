/**
 * Wave 2 — editing live posts and their lifecycle. Every refusal happens
 * before anything is written; ownership comes from the grant; writes are
 * revision-guarded.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  canDeletePublished,
  canOpenPublishedPost,
  deletePostDraft,
  deletePublishedPost,
  discardPostChanges,
  openPostForEdit,
  putPostBackOnline,
  takePostOffline,
} from '../post-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ID = 'hoffmann-post-coltivare-la-consapevolezza'
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
const owner = () => grant({ role: 'owner' })
const viewer = () => grant({ role: 'viewer', permissions: ['blog.post.read'] })
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

/** Claudia's real shape: fields the dashboard never edits must survive. */
const published = () => ({
  _id: ID,
  _type: 'post',
  _rev: 'p1',
  _createdAt: '2026-09-03T11:45:41Z',
  _updatedAt: '2026-10-02T10:13:15Z',
  projectSlug: 'hoffmann',
  title: { _type: 'localizedString', it: 'Coltivare la consapevolezza' },
  body: { _type: 'localizedPortableText', it: [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text: 'Ciao' }] }] },
  author: { _type: 'reference', _ref: 'hoffmann-author-claudia-hoffmann' },
  faq: [{ _key: 'f1', _type: 'faqItem', question: { it: 'Che cos’è?' }, answer: { it: 'Una pratica.' } }],
  redirectFrom: { de: ['old-slug'] },
  seoTitle: { _type: 'localizedString', it: 'SEO', translationStatus: { de: { provider: 'google' } } },
  featured: false,
  relatedEvent: { _type: 'reference', _ref: 'event-1' },
  publishedAt: '2025-11-22T18:01:44.181Z',
  slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'coltivare' } },
})

function fakeClient(o: { published?: Record<string, unknown> | null; draft?: Record<string, unknown> | null; commitError?: unknown; createError?: unknown; projectCount?: number } = {}) {
  const pub = o.published === undefined ? published() : o.published
  const draft = o.draft ?? null
  const ops: Array<[string, ...unknown[]]> = []
  const patch = {
    ifRevisionId: (r: string) => (ops.push(['ifRevisionId', r]), patch),
    set: (v: unknown) => (ops.push(['set', v]), patch),
    unset: (v: unknown) => (ops.push(['unset', v]), patch),
    commit: vi.fn(async () => {
      if (o.commitError) throw o.commitError
      ops.push(['commit'])
      return { _rev: 'p2' }
    }),
  }
  const tx = {
    patch: (id: string, p: unknown) => (ops.push(['tx.patch', id, p]), tx),
    delete: (id: string) => (ops.push(['tx.delete', id]), tx),
    commit: vi.fn(async () => {
      if (o.commitError) throw o.commitError
      ops.push(['tx.commit'])
      return {}
    }),
  }
  const client = {
    getDocument: vi.fn(async (id: string) => (id.startsWith('drafts.') ? draft : pub) ?? undefined),
    create: vi.fn(async (d: Record<string, unknown>) => {
      if (o.createError) throw o.createError
      ops.push(['create', d])
      return { ...d, _rev: 'd1' }
    }),
    patch: vi.fn((id: string) => (ops.push(['patch', id]), patch)),
    transaction: vi.fn(() => tx),
    // The single-Sanity-project write guard (sanity-project-guard.ts).
    fetch: vi.fn(async (q: string) => (q.startsWith('count(') ? (o.projectCount ?? 1) : null)),
  }
  return { client, ops }
}
const deps = (c: ReturnType<typeof fakeClient>) => ({ client: c.client as never, now: () => NOW })
const wrote = (c: ReturnType<typeof fakeClient>) =>
  c.ops.filter(([o]) => o === 'create' || o === 'commit' || o === 'tx.commit').length

describe('openPostForEdit', () => {
  it('creates drafts.<id> as an exact copy — unknown fields kept — plus the edit marker', async () => {
    const c = fakeClient()
    expect(await openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))).toEqual({ id: ID, created: true })
    const [, doc] = c.ops.find(([o]) => o === 'create')! as [string, Record<string, unknown>]
    const rest: Record<string, unknown> = { ...published() }
    for (const k of ['_rev', '_createdAt', '_updatedAt']) delete rest[k]
    expect(doc).toEqual({
      ...rest,
      _id: `drafts.${ID}`,
      wizard: { step: 'review', furthest: 'review', mode: 'edit', updatedAt: NOW.toISOString() },
    })
    expect(doc.faq).toEqual(published().faq)
    expect(doc.redirectFrom).toEqual({ de: ['old-slug'] })
    expect(doc.relatedEvent).toEqual({ _type: 'reference', _ref: 'event-1' })
  })

  it('an existing draft is reused, nothing written', async () => {
    const c = fakeClient({ draft: { _id: `drafts.${ID}`, _type: 'post', _rev: 'd', projectSlug: 'hoffmann' } })
    expect(await openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))).toEqual({ id: ID, created: false })
    expect(wrote(c)).toBe(0)
  })

  it('a concurrent open (409 on create) reuses the other draft', async () => {
    const c = fakeClient({ createError: Object.assign(new Error('exists'), { statusCode: 409 }) })
    expect(await openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))).toEqual({ id: ID, created: false })
  })

  it("another project's post, a missing post and a non-post are all not_found", async () => {
    for (const pub of [{ ...published(), projectSlug: 'livener' }, null, { ...published(), _type: 'page' }]) {
      const c = fakeClient({ published: pub })
      await expect(openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))).rejects.toMatchObject({ code: 'not_found' })
      expect(wrote(c)).toBe(0)
    }
  })

  it("a foreign draft under the same id is not_found", async () => {
    const c = fakeClient({ draft: { _id: `drafts.${ID}`, _type: 'post', projectSlug: 'livener' } })
    await expect(openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))).rejects.toMatchObject({ code: 'not_found' })
  })

  it.each(['drafts.x', '../x', 'a/b', 'a.b', ''])('unsafe id %j → not_found before any read', async (id) => {
    const c = fakeClient()
    await expect(openPostForEdit(ctx(grant()), 'project-a', id, deps(c))).rejects.toMatchObject({ code: 'not_found' })
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['a viewer', viewer(), 'project-a'],
    ['blog not installed', grant({ enabledModuleIds: ['forms'] }), 'project-a'],
    ["another tenant's project", grant(), 'project-b'],
  ])('refuses %s before any read', async (_l, g, projectId) => {
    const c = fakeClient()
    await expect(openPostForEdit(ctx(g), projectId, ID, deps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })

  it('canOpenPublishedPost answers for own published posts only', async () => {
    expect(await canOpenPublishedPost(ctx(grant()), 'project-a', ID, deps(fakeClient()))).toBe(true)
    expect(await canOpenPublishedPost(ctx(grant()), 'project-a', ID, deps(fakeClient({ published: { ...published(), projectSlug: 'x' } })))).toBe(false)
    expect(await canOpenPublishedPost(ctx(grant()), 'project-a', '../x', deps(fakeClient()))).toBe(false)
  })
})

describe('take offline / put back online', () => {
  it('take offline = guarded expiresAt = now on the published doc', async () => {
    const c = fakeClient()
    const live = await takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c))
    expect(c.ops).toEqual([['patch', ID], ['ifRevisionId', 'p1'], ['set', { expiresAt: NOW.toISOString() }], ['commit']])
    expect(live).toEqual({ rev: 'p2', publishedAt: '2025-11-22T18:01:44.181Z', expiresAt: NOW.toISOString(), slugs: { it: 'coltivare' } })
  })

  it('put back online = guarded unset of expiresAt', async () => {
    const c = fakeClient({ published: { ...published(), expiresAt: '2026-01-01T00:00:00Z' } })
    const live = await putPostBackOnline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c))
    expect(c.ops).toEqual([['patch', ID], ['ifRevisionId', 'p1'], ['unset', ['expiresAt']], ['commit']])
    expect(live.expiresAt).toBeNull()
  })

  it('stale rev → conflict, nothing written; 409 on commit → conflict; other failure → failed', async () => {
    const c = fakeClient()
    await expect(takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'old' }, deps(c))).rejects.toMatchObject({ code: 'conflict' })
    expect(wrote(c)).toBe(0)
    const c409 = fakeClient({ commitError: Object.assign(new Error('x'), { statusCode: 409 }) })
    await expect(takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c409))).rejects.toMatchObject({ code: 'conflict' })
    const cBoom = fakeClient({ commitError: new Error('secret detail') })
    await expect(putPostBackOnline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(cBoom))).rejects.toMatchObject({
      code: 'failed',
      message: 'Could not save.',
    })
  })

  it("another project's post → not_found; viewer / other tenant refused before reading", async () => {
    const c = fakeClient({ published: { ...published(), projectSlug: 'livener' } })
    await expect(takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c))).rejects.toMatchObject({ code: 'not_found' })
    for (const [g, pid] of [[viewer(), 'project-a'], [grant(), 'project-b']] as const) {
      const c2 = fakeClient()
      await expect(putPostBackOnline(ctx(g), pid, { id: ID, rev: 'p1' }, deps(c2))).rejects.toThrow(TenantAuthorizationError)
      expect(c2.client.getDocument).not.toHaveBeenCalled()
    }
  })
})

describe('discard changes / delete draft', () => {
  const draft = { _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'hoffmann' }

  it('discard deletes only the draft of a published post, revision-guarded', async () => {
    const c = fakeClient({ draft })
    await discardPostChanges(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(c))
    expect(c.ops).toEqual([
      ['tx.patch', `drafts.${ID}`, { ifRevisionID: 'd1', unset: ['_lifecycleGuard'] }],
      ['tx.delete', `drafts.${ID}`],
      ['tx.commit'],
    ])
  })

  it('discard without a published version or without a draft is not_found', async () => {
    await expect(discardPostChanges(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(fakeClient({ published: null, draft })))).rejects.toMatchObject({ code: 'not_found' })
    await expect(discardPostChanges(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(fakeClient()))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('delete draft removes a never-published draft; refuses when a live version exists', async () => {
    const c = fakeClient({ published: null, draft })
    await deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(c))
    expect(c.ops.at(-2)).toEqual(['tx.delete', `drafts.${ID}`])
    const live = fakeClient({ draft })
    await expect(deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(live))).rejects.toMatchObject({ code: 'invalid_value' })
    expect(wrote(live)).toBe(0)
  })

  it("stale rev → conflict; another project's draft → not_found; viewer refused", async () => {
    await expect(deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'old' }, deps(fakeClient({ published: null, draft })))).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(fakeClient({ published: null, draft: { ...draft, projectSlug: 'livener' } })))
    ).rejects.toMatchObject({ code: 'not_found' })
    const c = fakeClient({ published: null, draft })
    await expect(deletePostDraft(ctx(viewer()), 'project-a', { id: ID, rev: 'd1' }, deps(c))).rejects.toThrow(TenantAuthorizationError)
    expect(c.client.getDocument).not.toHaveBeenCalled()
  })
})

describe('delete a published post', () => {
  it('owners with blog.post.delete: deletes the post and its draft in one guarded transaction', async () => {
    const c = fakeClient({ draft: { _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'hoffmann' } })
    await deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'p1' }, deps(c))
    expect(c.ops).toEqual([
      ['tx.patch', ID, { ifRevisionID: 'p1', unset: ['_lifecycleGuard'] }],
      ['tx.patch', `drafts.${ID}`, { ifRevisionID: 'd1', unset: ['_lifecycleGuard'] }],
      ['tx.delete', ID],
      ['tx.delete', `drafts.${ID}`],
      ['tx.commit'],
    ])
  })

  it('an editor (even holding blog.post.delete) cannot; neither can an owner without it', async () => {
    for (const g of [grant(), grant({ role: 'owner', permissions: ['blog.post.read', 'blog.post.write'] })]) {
      const c = fakeClient()
      await expect(deletePublishedPost(ctx(g), 'project-a', { id: ID, rev: 'p1' }, deps(c))).rejects.toThrow(TenantAuthorizationError)
      expect(c.client.getDocument).not.toHaveBeenCalled()
    }
    expect(canDeletePublished(owner())).toBe(true)
    expect(canDeletePublished(grant())).toBe(false)
  })

  it("stale rev → conflict; another project's post → not_found", async () => {
    await expect(deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'x' }, deps(fakeClient()))).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'p1' }, deps(fakeClient({ published: { ...published(), projectSlug: 'livener' } })))
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('single-Sanity-project write guard', () => {
  it('every lifecycle mutation is refused (forbidden) unless exactly one Sanity project carries the slug', async () => {
    const draftDoc = { _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'hoffmann' }
    for (const projectCount of [0, 2]) {
      const runs: Array<[ReturnType<typeof fakeClient>, (c: ReturnType<typeof fakeClient>) => Promise<unknown>]> = [
        [fakeClient({ projectCount }), (c) => openPostForEdit(ctx(grant()), 'project-a', ID, deps(c))],
        [fakeClient({ projectCount }), (c) => takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c))],
        [fakeClient({ projectCount }), (c) => putPostBackOnline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, deps(c))],
        [fakeClient({ projectCount, draft: draftDoc }), (c) => discardPostChanges(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(c))],
        [fakeClient({ projectCount, published: null, draft: draftDoc }), (c) => deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, deps(c))],
        [fakeClient({ projectCount, draft: draftDoc }), (c) => deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'p1' }, deps(c))],
      ]
      for (const [c, run] of runs) {
        await expect(run(c)).rejects.toThrow(TenantAuthorizationError)
        expect(wrote(c)).toBe(0)
      }
    }
  })
})
