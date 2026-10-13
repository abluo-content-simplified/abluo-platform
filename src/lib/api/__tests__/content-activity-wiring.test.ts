/**
 * ADR-032 D9 (slice 3a) — every dashboard lifecycle write is recorded, with
 * the Sanity transaction id the write itself used, and the right actor.
 *
 *  1. Posts end to end against a fake Sanity client: the recorded action, the
 *     state after the change, and that the row's transaction id IS the one
 *     committed (the correlation slice 3b relies on).
 *  2. A source scan: in the dashboard's post / event / gallery write modules,
 *     every Sanity commit or create either passes the audited transaction id
 *     or sits in a function listed here as "not a lifecycle change".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { deletePostDraft, deletePublishedPost, putPostBackOnline, setPostEndDate, takePostOffline } from '../post-lifecycle'
import { createPostDraft } from '../post-drafts'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import type { ContentAuditEntry } from '@/lib/lifecycle/audit'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ID = 'post-123'
const NOW = new Date('2026-10-13T10:00:00Z')
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'
const grant = (permissions = ['blog.post.read', 'blog.post.write', 'blog.post.delete', 'blog.published.delete']): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('tmz'),
  membershipId: 'm1',
  role: 'owner',
  permissions,
  enabledModuleIds: ['blog'],
})
const ctx = (g: ProjectGrant, support = false): TenantAuthorizationContext =>
  ({ userId: 'u1', platformRole: 'tenant_user', projects: [g], ...(support && { support: { sessionId: 's1' } }) }) as TenantAuthorizationContext

function fake(o: { published?: Record<string, unknown> | null; draft?: Record<string, unknown> | null; failWith?: number } = {}) {
  const pub = o.published === undefined ? { _id: ID, _type: 'post', _rev: 'p1', projectSlug: 'tmz', publishedAt: PAST } : o.published
  const committed: Array<Record<string, unknown> | undefined> = []
  const commit = vi.fn(async (opts?: Record<string, unknown>) => {
    if (o.failWith) throw Object.assign(new Error('x'), { statusCode: o.failWith })
    committed.push(opts)
    return { _rev: 'p2' }
  })
  const patch: Record<string, unknown> = {}
  Object.assign(patch, { ifRevisionId: () => patch, set: () => patch, unset: () => patch, commit })
  const tx: Record<string, unknown> = {}
  Object.assign(tx, { patch: () => tx, delete: () => tx, commit })
  const client = {
    getDocument: vi.fn(async (id: string) => (id.startsWith('drafts.') ? o.draft : pub) ?? undefined),
    create: vi.fn(async (d: Record<string, unknown>, opts?: Record<string, unknown>) => (committed.push(opts), { ...d, _rev: 'd1' })),
    patch: vi.fn(() => patch),
    transaction: vi.fn(() => tx),
    fetch: vi.fn(async (q: string) => (q.startsWith('count(*[_type == "post"') ? 0 : q.startsWith('count(') ? 1 : null)),
  }
  const rows: ContentAuditEntry[] = []
  const deps = { client: client as never, now: () => NOW, uuid: () => ID, audit: async (e: ContentAuditEntry) => void rows.push(e) }
  return { deps, rows, committed }
}

describe('posts: the recorded row matches the write', () => {
  it('take offline → unpublished, with the committed transaction id', async () => {
    const f = fake()
    await takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, f.deps)
    expect(f.rows).toHaveLength(1)
    const [r] = f.rows
    expect(r).toMatchObject({ projectId: 'project-a', contentType: 'post', contentId: ID, action: 'unpublished', outcome: 'ok', actorKind: 'user', actorId: 'u1' })
    expect(r.transactionId).toMatch(/^abluo-dash-/)
    expect(f.committed).toEqual([{ transactionId: r.transactionId }])
    expect(r.detail).toEqual({ state: { publishedAt: PAST, expiresAt: NOW.toISOString(), archivedAt: null } })
  })

  it('back online → published', async () => {
    const f = fake({ published: { _id: ID, _type: 'post', _rev: 'p1', projectSlug: 'tmz', publishedAt: PAST, expiresAt: PAST } })
    await putPostBackOnline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, f.deps)
    expect(f.rows.map((r) => r.action)).toEqual(['published'])
    expect(f.committed[0]).toEqual({ transactionId: f.rows[0].transactionId })
  })

  it('an end date → schedule_changed', async () => {
    const f = fake()
    await setPostEndDate(ctx(grant()), 'project-a', { id: ID, rev: 'p1', expiresAt: FUTURE }, f.deps)
    expect(f.rows.map((r) => [r.action, r.outcome])).toEqual([['schedule_changed', 'ok']])
  })

  it('delete live post → deleted (state: gone); delete draft → deleted (draftOnly)', async () => {
    const a = fake()
    await deletePublishedPost(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, a.deps)
    expect(a.rows[0]).toMatchObject({ action: 'deleted', outcome: 'ok', detail: { state: null } })
    const b = fake({ published: null, draft: { _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'tmz' } })
    await deletePostDraft(ctx(grant()), 'project-a', { id: ID, rev: 'd1' }, b.deps)
    expect(b.rows[0]).toMatchObject({ action: 'deleted', outcome: 'ok', detail: { state: null, draftOnly: true } })
  })

  it('a new draft → created, with the create call carrying the transaction id', async () => {
    const f = fake()
    await createPostDraft(ctx(grant()), 'project-a', f.deps)
    expect(f.rows[0]).toMatchObject({ action: 'created', contentId: ID, outcome: 'ok' })
    expect(f.committed).toEqual([{ transactionId: f.rows[0].transactionId }])
  })

  it('support mode: recorded under the admin, flagged support', async () => {
    const f = fake()
    await takePostOffline(ctx(grant(), true), 'project-a', { id: ID, rev: 'p1' }, f.deps)
    expect(f.rows[0]).toMatchObject({ actorId: 'u1', detail: expect.objectContaining({ support: true }) })
  })

  it('refused (conflict, no permission) and failed (Sanity error) are recorded, and the caller sees the same error', async () => {
    const stale = fake()
    await expect(takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'old' }, stale.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(stale.rows[0]).toMatchObject({ action: 'unpublished', outcome: 'refused', transactionId: null })

    const viewer = fake()
    await expect(takePostOffline(ctx(grant(['blog.post.read'])), 'project-a', { id: ID, rev: 'p1' }, viewer.deps)).rejects.toThrow()
    expect(viewer.rows[0]).toMatchObject({ outcome: 'refused' })

    const broken = fake({ failWith: 500 })
    await expect(takePostOffline(ctx(grant()), 'project-a', { id: ID, rev: 'p1' }, broken.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(broken.rows[0]).toMatchObject({ outcome: 'failed', transactionId: expect.stringMatching(/^abluo-dash-/) })
  })
})

// ── 2. Every dashboard write to a lifecycle type is correlated ───────────────

const FILES = ['src/lib/api/post-lifecycle.ts', 'src/lib/api/post-publish.ts', 'src/lib/api/post-drafts.ts', 'src/lib/api/event-drafts.ts', 'src/lib/api/gallery-drafts.ts']

/** Writes that change no lifecycle state (draft edits, tags, topics, featured, discarding changes of a live item). */
const NOT_LIFECYCLE: Record<string, string[]> = {
  'src/lib/api/post-lifecycle.ts': ['openPostForEdit', 'discardPostChanges', 'setPostCategories', 'setPostFeatured'],
  'src/lib/api/post-publish.ts': [],
  'src/lib/api/post-drafts.ts': ['patchPostDraft'],
  'src/lib/api/event-drafts.ts': ['openEventForEdit', 'patchEventDraft', 'setEventCover'],
  'src/lib/api/gallery-drafts.ts': ['openGalleryForEdit', 'rebuildItems', 'patchGalleryDraft', 'discardGalleryDraft', 'batchGalleries'],
}

/** The enclosing top-level function of each Sanity write call. */
function writesByFunction(src: string): Array<{ fn: string; call: string }> {
  const out: Array<{ fn: string; call: string }> = []
  const re = /\.(commit|create|createOrReplace)\(([^)]*)\)/g
  for (const m of src.matchAll(re)) {
    const before = src.slice(0, m.index)
    const fn = [...before.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].pop()?.[1] ?? '?'
    out.push({ fn, call: m[0] })
  }
  return out
}

describe('every dashboard lifecycle write commits with the audited transaction id', () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      const unaudited = writesByFunction(src).filter(
        (w) => !/transactionId/.test(w.call) && !NOT_LIFECYCLE[f].includes(w.fn) && !/^(tx|\w+)\.create(OrReplace)?\(doc as/.test(w.call) && !/\.create(OrReplace)?\(doc as/.test(w.call)
      )
      expect(unaudited, 'commit it with { transactionId } inside audited(), or list the function as NOT_LIFECYCLE').toEqual([])
    })
  }
})
