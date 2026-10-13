/**
 * ADR-032 slice 4 — posts on the lifecycle service: Archive, Restore, the two
 * deletes and every route back online. Runs against an in-memory Sanity that
 * applies transactions atomically and enforces revision guards, so whole
 * sequences (archive → edit → publish refused → restore → republish) are
 * checked on the stored documents, not on the calls made.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  archivePost,
  deletePostDraft,
  deletePublishedPost,
  POST_LIFECYCLE,
  putPostBackOnline,
  restorePost,
  runPostBatch,
  setPostEndDate,
  takePostOffline,
} from '../post-lifecycle'
import { publishPostDraft } from '../post-publish'
import { lifecycleGuard, wasEverPublished, LIFECYCLE_OPERATIONS } from '@/lib/lifecycle/service'
import type { ContentAuditEntry } from '@/lib/lifecycle/audit'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

type Doc = Record<string, unknown> & { _id: string; _rev?: string }

const ID = 'tmz-post-lifecycle-test'
const NOW = new Date('2026-10-13T10:00:00Z')
const T = NOW.toISOString()
const READ = 'blog.post.read'
const WRITE = 'blog.post.write'
const DELETE = 'blog.post.delete'
const DELETE_PUBLISHED = 'blog.published.delete'

const grant = (permissions: string[], role = 'editor'): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('tmz'),
  membershipId: 'm1',
  role: role as ProjectGrant['role'],
  permissions,
  enabledModuleIds: ['blog'],
})
const editor = () => grant([READ, WRITE, DELETE])
const owner = () => grant([READ, WRITE, DELETE, DELETE_PUBLISHED], 'owner')
const ctx = (g: ProjectGrant, userId = 'u-editor'): TenantAuthorizationContext => ({ userId, platformRole: 'tenant_user', projects: [g] })

const body = [{ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's1', text: 'Ciao', marks: [] }] }]
const publishedPost = (o: Record<string, unknown> = {}): Doc => ({
  _id: ID,
  _type: 'post',
  _rev: 'p1',
  projectSlug: 'tmz',
  title: { _type: 'localizedString', it: 'Prova' },
  body: { _type: 'localizedPortableText', it: body },
  slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'prova' } },
  relatedEvent: { _type: 'reference', _ref: 'tmz-event-1' },
  publishedAt: '2026-09-01T08:00:00.000Z',
  ...o,
})
const draftOf = (doc: Doc, o: Record<string, unknown> = {}): Doc => ({ ...doc, _id: `drafts.${doc._id}`, _rev: 'd1', ...o })

/** A small Sanity: revision-guarded patches, atomic transactions, 409 on a moved revision. */
function memorySanity(initial: Doc[], opts: { refs?: number } = {}) {
  const docs = new Map<string, Doc>(initial.map((d) => [d._id, structuredClone(d)]))
  let n = 0
  const transactions: string[] = []
  const conflict = () => Object.assign(new Error('revision mismatch'), { statusCode: 409 })
  type Change = { ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] }
  type Op = { kind: 'patch'; id: string; change: Change } | { kind: 'create' | 'createOrReplace'; doc: Doc } | { kind: 'delete'; id: string }

  function apply(store: Map<string, Doc>, op: Op) {
    if (op.kind === 'patch') {
      const cur = store.get(op.id)
      if (!cur) throw Object.assign(new Error('missing'), { statusCode: 404 })
      if (op.change.ifRevisionID !== undefined && cur._rev !== op.change.ifRevisionID) throw conflict()
      const next: Doc = { ...cur, ...(op.change.set ?? {}) }
      for (const k of op.change.unset ?? []) delete next[k]
      store.set(op.id, next)
    } else if (op.kind === 'delete') {
      store.delete(op.id)
    } else {
      if (op.kind === 'create' && store.has(op.doc._id)) throw conflict()
      store.set(op.doc._id, structuredClone(op.doc))
    }
  }
  function commitOps(ops: Op[], transactionId?: string) {
    const draft = new Map(docs)
    for (const op of ops) apply(draft, op)
    const rev = `r${++n}`
    const touched = new Set(ops.map((o) => ('id' in o ? o.id : o.doc._id)))
    for (const id of touched) if (draft.has(id)) draft.set(id, { ...draft.get(id)!, _rev: rev })
    docs.clear()
    for (const [k, v] of draft) docs.set(k, v)
    if (transactionId) transactions.push(transactionId)
    return { _rev: rev }
  }
  const client = {
    getDocument: vi.fn(async (id: string) => (docs.has(id) ? structuredClone(docs.get(id)!) : undefined)),
    create: vi.fn(async (doc: Doc) => commitOps([{ kind: 'create', doc }])),
    patch: vi.fn((id: string) => {
      const change: Change = {}
      const b = {
        ifRevisionId: (r: string) => ((change.ifRevisionID = r), b),
        set: (v: Record<string, unknown>) => ((change.set = { ...change.set, ...v }), b),
        unset: (v: string[]) => ((change.unset = [...(change.unset ?? []), ...v]), b),
        commit: async (o?: { transactionId?: string }) => commitOps([{ kind: 'patch', id, change }], o?.transactionId),
      }
      return b
    }),
    transaction: vi.fn(() => {
      const ops: Op[] = []
      const tx = {
        patch: (id: string, change: Change) => (ops.push({ kind: 'patch', id, change }), tx),
        create: (doc: Doc) => (ops.push({ kind: 'create', doc }), tx),
        createOrReplace: (doc: Doc) => (ops.push({ kind: 'createOrReplace', doc }), tx),
        delete: (id: string) => (ops.push({ kind: 'delete', id }), tx),
        commit: async (o?: { transactionId?: string }) => commitOps(ops, o?.transactionId),
      }
      return tx
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so tests can read the params
    fetch: vi.fn(async (q: string, _params?: unknown) => {
      if (q.includes('references(')) return opts.refs ?? 0
      if (q.startsWith('count(')) return 1
      if (q.includes('"siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it'] }
      if (q.includes('_type == "post"')) return []
      return null
    }),
  }
  const audit: ContentAuditEntry[] = []
  const deps = { client: client as never, now: () => NOW, audit: async (e: ContentAuditEntry) => void audit.push(e) }
  return { docs, client, deps, audit, transactions, get: (id: string) => docs.get(id) }
}

const rev = (s: ReturnType<typeof memorySanity>, id = ID) => s.get(id)?._rev ?? ''

// ── The guard ─────────────────────────────────────────────────────────────────

describe('lifecycleGuard (D7, amended)', () => {
  it('maps every operation to its permissions', () => {
    const map = Object.fromEntries(LIFECYCLE_OPERATIONS.map((op) => [op, lifecycleGuard(POST_LIFECYCLE, op)]))
    expect(map).toEqual({
      unpublishNow: [WRITE],
      backOnline: [WRITE],
      setEndDate: [WRITE],
      archive: [WRITE],
      restore: [WRITE],
      deleteDraft: [DELETE],
      deletePermanently: [DELETE, DELETE_PUBLISHED],
    })
  })

  it('"previously published" comes from stored fields only', () => {
    expect(wasEverPublished(publishedPost(), null)).toBe(true)
    expect(wasEverPublished(null, { _id: 'drafts.x', title: 'x' })).toBe(false)
    expect(wasEverPublished(null, { _id: 'drafts.x', publishedAt: '2026-01-01T00:00:00Z' })).toBe(true)
    expect(wasEverPublished(null, { _id: 'drafts.x', archivedAt: '2026-01-01T00:00:00Z' })).toBe(true)
  })
})

// ── Archive ──────────────────────────────────────────────────────────────────

describe('archive', () => {
  it('sets archivedAt, archivedBy and expiresAt = now on both versions, in one transaction', async () => {
    const pub = publishedPost()
    const s = memorySanity([pub, draftOf(pub, { title: { it: 'Prova (bozza)' } })])
    const live = await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    for (const id of [ID, `drafts.${ID}`]) {
      expect(s.get(id)).toMatchObject({ archivedAt: T, archivedBy: 'u-editor', expiresAt: T })
    }
    expect(s.get(`drafts.${ID}`)!.title).toEqual({ it: 'Prova (bozza)' })
    expect(live.archivedAt).toBe(T)
    expect(s.transactions).toHaveLength(1)
  })

  it('keeps an earlier expiresAt; replaces a later one', async () => {
    const earlier = '2026-10-01T00:00:00.000Z'
    const s1 = memorySanity([publishedPost({ expiresAt: earlier })])
    await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s1.deps)
    expect(s1.get(ID)!.expiresAt).toBe(earlier)
    const s2 = memorySanity([publishedPost({ expiresAt: '2027-01-01T00:00:00.000Z' })])
    await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s2.deps)
    expect(s2.get(ID)!.expiresAt).toBe(T)
  })

  it('works from scheduled and unpublished too', async () => {
    for (const o of [{ publishedAt: '2026-12-01T00:00:00.000Z' }, { expiresAt: '2026-10-01T00:00:00.000Z' }]) {
      const s = memorySanity([publishedPost(o)])
      await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
      expect(s.get(ID)!.archivedAt).toBe(T)
    }
  })

  it('refuses a never-published draft, an archived post, a stale revision and a viewer', async () => {
    const draftOnly = memorySanity([draftOf(publishedPost(), { publishedAt: undefined })])
    draftOnly.docs.delete(ID)
    await expect(archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'd1' }, draftOnly.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    const archived = memorySanity([publishedPost({ archivedAt: T })])
    await expect(archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, archived.deps)).rejects.toMatchObject({ code: 'archived' })
    const stale = memorySanity([publishedPost()])
    await expect(archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'old' }, stale.deps)).rejects.toMatchObject({ code: 'conflict' })
    const v = memorySanity([publishedPost()])
    await expect(archivePost(ctx(grant([READ], 'viewer')), 'project-a', { id: ID, rev: 'p1' }, v.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(v.client.getDocument).not.toHaveBeenCalled()
    for (const s of [archived, stale, v]) expect(s.transactions).toHaveLength(0)
  })

  it('a draft edited since the read (moved revision) fails the whole transaction — nothing half-archived', async () => {
    const pub = publishedPost()
    const s = memorySanity([pub, draftOf(pub)])
    const realGet = s.client.getDocument.getMockImplementation()!
    // The draft moves between the read and the commit.
    s.client.getDocument.mockImplementation(async (id: string) => {
      const d = await realGet(id)
      if (id.startsWith('drafts.')) s.docs.set(id, { ...s.docs.get(id)!, _rev: 'moved' })
      return d
    })
    await expect(archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toMatchObject({ code: 'conflict' })
    expect(s.get(ID)!.archivedAt).toBeUndefined()
    expect(s.get(`drafts.${ID}`)!.archivedAt).toBeUndefined()
  })
})

// ── Nothing goes back online while archived ──────────────────────────────────

describe('an archived post cannot go back online by any route', () => {
  const archivedPair = () => {
    const pub = publishedPost({ archivedAt: T, archivedBy: 'u1', expiresAt: T })
    return memorySanity([pub, draftOf(pub)])
  }

  it.each([
    ['back online', (s: ReturnType<typeof memorySanity>) => putPostBackOnline(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)],
    ['take offline', (s: ReturnType<typeof memorySanity>) => takePostOffline(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)],
    ['end date', (s: ReturnType<typeof memorySanity>) => setPostEndDate(ctx(editor()), 'project-a', { id: ID, rev: 'p1', expiresAt: '2027-01-01T00:00:00Z' }, s.deps)],
    ['remove end date', (s: ReturnType<typeof memorySanity>) => setPostEndDate(ctx(editor()), 'project-a', { id: ID, rev: 'p1', expiresAt: null }, s.deps)],
    ['publish now', (s: ReturnType<typeof memorySanity>) => publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1', mode: 'now' }, s.deps)],
    ['update post', (s: ReturnType<typeof memorySanity>) => publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1', mode: 'keep' }, s.deps)],
    [
      'schedule',
      (s: ReturnType<typeof memorySanity>) =>
        publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1', mode: 'schedule', publishAt: '2026-11-01T10:00:00Z' }, s.deps),
    ],
  ])('%s → "archived", nothing written', async (_label, run) => {
    const s = archivedPair()
    await expect(run(s)).rejects.toMatchObject({ code: 'archived' })
    expect(s.transactions).toHaveLength(0)
    expect(s.get(ID)).toMatchObject({ archivedAt: T, expiresAt: T })
  })

  it('batch online / offline / end date report "archived" per post', async () => {
    const s = archivedPair()
    for (const op of ['online', 'offline', 'endDate'] as const) {
      expect(await runPostBatch(ctx(editor()), 'project-a', { ids: [ID], op, expiresAt: null }, s.deps)).toEqual([{ id: ID, ok: false, error: 'archived' }])
    }
  })
})

describe('publishing never takes lifecycle fields from the draft', () => {
  it('a stale archivedAt / archivedBy on the draft is not copied to the published post', async () => {
    const pub = publishedPost()
    const s = memorySanity([pub, draftOf(pub, { archivedAt: '2026-01-01T00:00:00Z', archivedBy: 'someone', expiresAt: '2026-01-02T00:00:00Z' })])
    await publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1', mode: 'keep' }, s.deps)
    expect(s.get(ID)!.archivedAt).toBeUndefined()
    expect(s.get(ID)!.archivedBy).toBeUndefined()
    expect(s.get(ID)!.expiresAt).toBeUndefined()
  })
})

// ── Restore ──────────────────────────────────────────────────────────────────

describe('restore', () => {
  it('lands on unpublished: both versions lose archivedAt / archivedBy, expiresAt stays in the past', async () => {
    const pub = publishedPost({ archivedAt: T, archivedBy: 'u1', expiresAt: '2026-10-10T00:00:00.000Z' })
    const s = memorySanity([pub, draftOf(pub)])
    const live = await restorePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    for (const id of [ID, `drafts.${ID}`]) {
      expect(s.get(id)!.archivedAt).toBeUndefined()
      expect(s.get(id)!.archivedBy).toBeUndefined()
      expect(s.get(id)!.expiresAt).toBe('2026-10-10T00:00:00.000Z')
    }
    expect(live).toMatchObject({ archivedAt: null, publishedAt: '2026-09-01T08:00:00.000Z' })
  })

  it('never reactivates an old schedule: a future publishedAt is removed', async () => {
    const s = memorySanity([publishedPost({ publishedAt: '2026-12-01T00:00:00.000Z', archivedAt: T, expiresAt: T })])
    await restorePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    expect(s.get(ID)!.publishedAt).toBeUndefined()
    expect(s.get(ID)!.expiresAt).toBe(T)
  })

  it('a restored post whose expiresAt was cleared outside the dashboard still lands offline (expiresAt = now)', async () => {
    const s = memorySanity([publishedPost({ archivedAt: T })])
    await restorePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    expect(s.get(ID)!.expiresAt).toBe(T)
  })

  it('refuses a post that is not archived', async () => {
    const s = memorySanity([publishedPost()])
    await expect(restorePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

// ── The full sequence ───────────────────────────────────────────────────────

describe('archive → edit → publish refused → restore → explicit republish', () => {
  it('keeps identity, slug and references throughout', async () => {
    const pub = publishedPost()
    const s = memorySanity([pub, draftOf(pub)])

    await archivePost(ctx(editor()), 'project-a', { id: ID, rev: rev(s) }, s.deps)

    // Edit the draft while archived (the wizard's autosave is a plain draft patch).
    await s.client.patch(`drafts.${ID}`).ifRevisionId(rev(s, `drafts.${ID}`)).set({ title: { _type: 'localizedString', it: 'Prova 2' } }).commit()

    await expect(publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: rev(s, `drafts.${ID}`), mode: 'keep' }, s.deps)).rejects.toMatchObject({
      code: 'archived',
    })
    expect(s.get(ID)!.title).toEqual({ _type: 'localizedString', it: 'Prova' })

    await restorePost(ctx(editor()), 'project-a', { id: ID, rev: rev(s) }, s.deps)
    // Restored = unpublished: the update goes in but the post stays offline…
    await publishPostDraft(ctx(editor()), 'project-a', { id: ID, rev: rev(s, `drafts.${ID}`), mode: 'keep' }, s.deps)
    expect(s.get(ID)!.expiresAt).toBe(T)
    // …until "Put back online", the explicit step.
    await putPostBackOnline(ctx(editor()), 'project-a', { id: ID, rev: rev(s) }, s.deps)

    const final = s.get(ID)!
    expect(final._id).toBe(ID)
    expect(final.title).toEqual({ _type: 'localizedString', it: 'Prova 2' })
    expect(final.slug).toEqual(pub.slug)
    expect(final.relatedEvent).toEqual(pub.relatedEvent)
    expect(final.publishedAt).toBe(pub.publishedAt)
    expect(final.expiresAt).toBeUndefined()
    expect(final.archivedAt).toBeUndefined()
    expect(s.get(`drafts.${ID}`)).toBeUndefined()
    expect(s.audit.filter((e) => e.outcome === 'ok').map((e) => e.action)).toEqual(['archived', 'restored', 'published'])
    expect(s.audit.filter((e) => e.outcome === 'refused').map((e) => e.action)).toEqual(['published'])
  })

  it('back online after restoring a formerly scheduled post publishes it from now', async () => {
    const s = memorySanity([publishedPost({ publishedAt: '2026-12-01T00:00:00.000Z', archivedAt: T, expiresAt: T })])
    await restorePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    await putPostBackOnline(ctx(editor()), 'project-a', { id: ID, rev: rev(s) }, s.deps)
    expect(s.get(ID)).toMatchObject({ publishedAt: T })
    expect(s.get(ID)!.expiresAt).toBeUndefined()
  })
})

// ── Deleting ─────────────────────────────────────────────────────────────────

describe('permanent delete', () => {
  const archivedPair = (o: { refs?: number } = {}) => {
    const pub = publishedPost({ archivedAt: T, archivedBy: 'u1', expiresAt: T })
    return memorySanity([pub, draftOf(pub)], o)
  }

  it('Owner / Site admin: removes both versions of an archived post', async () => {
    const s = archivedPair()
    await deletePublishedPost(ctx(owner(), 'u-owner'), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    expect(s.get(ID)).toBeUndefined()
    expect(s.get(`drafts.${ID}`)).toBeUndefined()
    expect(s.audit).toMatchObject([{ action: 'deleted', outcome: 'ok', actorId: 'u-owner', contentId: ID }])
  })

  it('needs blog.published.delete — an Editor holding blog.post.delete is refused before any read', async () => {
    const s = archivedPair()
    await expect(deletePublishedPost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(s.client.getDocument).not.toHaveBeenCalled()
    expect(s.get(ID)).toBeDefined()
  })

  it('refuses a post that is not archived (offline included): archive_first', async () => {
    for (const o of [{}, { expiresAt: '2026-10-01T00:00:00.000Z' }]) {
      const s = memorySanity([publishedPost(o)])
      await expect(deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toMatchObject({ code: 'archive_first' })
      expect(s.get(ID)).toBeDefined()
    }
  })

  it('refuses while other content still references the post: in_use', async () => {
    const s = archivedPair({ refs: 2 })
    await expect(deletePublishedPost(ctx(owner()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toMatchObject({ code: 'in_use' })
    expect(s.get(ID)).toBeDefined()
    expect(s.get(`drafts.${ID}`)).toBeDefined()
    const refQuery = s.client.fetch.mock.calls.find(([q]) => String(q).includes('references('))!
    expect(refQuery[1]).toEqual({ id: ID, draftId: `drafts.${ID}` })
  })
})

describe('deleting drafts', () => {
  it('an Editor deletes a never-published draft', async () => {
    const s = memorySanity([{ _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'tmz', title: { it: 'Bozza' } }])
    await deletePostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1' }, s.deps)
    expect(s.get(`drafts.${ID}`)).toBeUndefined()
  })

  it('a draft whose stored fields show it was published before needs blog.published.delete', async () => {
    for (const o of [{ publishedAt: '2026-09-01T00:00:00Z' }, { archivedAt: T }]) {
      const doc = { _id: `drafts.${ID}`, _type: 'post', _rev: 'd1', projectSlug: 'tmz', ...o }
      const s = memorySanity([doc])
      await expect(deletePostDraft(ctx(editor()), 'project-a', { id: ID, rev: 'd1' }, s.deps)).rejects.toThrow(TenantAuthorizationError)
      expect(s.get(`drafts.${ID}`)).toBeDefined()
      const o2 = memorySanity([doc])
      await deletePostDraft(ctx(owner()), 'project-a', { id: ID, rev: 'd1' }, o2.deps)
      expect(o2.get(`drafts.${ID}`)).toBeUndefined()
    }
  })

  it('never deletes a published post through the draft route', async () => {
    const pub = publishedPost()
    const s = memorySanity([pub, draftOf(pub)])
    await expect(deletePostDraft(ctx(owner()), 'project-a', { id: ID, rev: 'd1' }, s.deps)).rejects.toMatchObject({ code: 'archive_first' })
    expect(s.get(`drafts.${ID}`)).toBeDefined()
  })
})

// ── Batch ───────────────────────────────────────────────────────────────────

describe('batch archive / restore', () => {
  it('per post; archived posts are skipped by archive, live ones by restore', async () => {
    const a = publishedPost({ _id: 'tmz-a' })
    const b = publishedPost({ _id: 'tmz-b', archivedAt: T, expiresAt: T })
    const s = memorySanity([a, b])
    expect(await runPostBatch(ctx(editor()), 'project-a', { ids: ['tmz-a', 'tmz-b'], op: 'archive' }, s.deps)).toEqual([
      { id: 'tmz-a', ok: true },
      { id: 'tmz-b', ok: false, error: 'archived' },
    ])
    expect(await runPostBatch(ctx(editor()), 'project-a', { ids: ['tmz-a', 'tmz-b'], op: 'restore' }, s.deps)).toEqual([
      { id: 'tmz-a', ok: true },
      { id: 'tmz-b', ok: true },
    ])
    expect(s.get('tmz-a')!.archivedAt).toBeUndefined()
    expect(s.get('tmz-b')!.archivedAt).toBeUndefined()
  })
})

// ── Activity ─────────────────────────────────────────────────────────────────

describe('Activity', () => {
  it('records archive and restore with the transaction id the write used', async () => {
    const s = memorySanity([publishedPost()])
    await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)
    await restorePost(ctx(editor()), 'project-a', { id: ID, rev: rev(s) }, s.deps)
    expect(s.audit.map((e) => [e.action, e.outcome, e.transactionId])).toEqual([
      ['archived', 'ok', s.transactions[0]],
      ['restored', 'ok', s.transactions[1]],
    ])
  })

  it('records nothing as done when the change failed; a refusal is recorded as refused', async () => {
    const s = memorySanity([publishedPost({ archivedAt: T })])
    await expect(archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, s.deps)).rejects.toMatchObject({ code: 'archived' })
    expect(s.audit).toMatchObject([{ action: 'archived', outcome: 'refused', transactionId: null }])
  })

  it('an Activity writer that fails after the change does not turn it into an error — it is logged instead', async () => {
    const s = memorySanity([publishedPost()])
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = { ...s.deps, audit: async () => Promise.reject(new Error('supabase down')) }
    const live = await archivePost(ctx(editor()), 'project-a', { id: ID, rev: 'p1' }, deps)
    expect(live.archivedAt).toBe(T)
    expect(s.get(ID)!.archivedAt).toBe(T)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[content-audit] not recorded'))
    log.mockRestore()
  })
})
