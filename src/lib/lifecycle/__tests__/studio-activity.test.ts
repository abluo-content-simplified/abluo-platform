import { describe, expect, it, vi } from 'vitest'
import { evaluate, parse } from 'groq-js'
import {
  ACTIVITY_WEBHOOK_FILTER,
  ACTIVITY_WEBHOOK_PROJECTION,
  parseStudioChange,
  reconcileActivity,
  recordStudioChange,
  retentionCutoffs,
  RECONCILE_TRANSACTION_LIMIT,
  type StudioDeps,
} from '../studio-activity'
import type { ActivityStore, InsertResult } from '../activity-store'
import type { ContentAuditEntry } from '../audit'

const DASH = 'pO76jQMNa'
const TOM = 'pCL36Ex6z'
const PAST = '2026-10-01T09:00:00.000Z'
const NOW = new Date('2026-10-13T12:00:00.000Z')

function fakeStore(o: { insert?: InsertResult; recorded?: Array<[string, string]> } = {}) {
  const rows: ContentAuditEntry[] = []
  const store: ActivityStore = {
    insert: vi.fn(async (e: ContentAuditEntry) => (rows.push(e), o.insert ?? 'ok')),
    hasTransaction: vi.fn(async (txn: string, ids: string[]) => (o.recorded ?? []).some(([t, id]) => t === txn && ids.includes(id))),
    projectIdForSlug: vi.fn(async (slug: string) => (slug === 'tmz' ? 'project-tmz' : null)),
    purge: vi.fn(async () => ({ ok: 0, short: 0 })),
    issuesSince: vi.fn(async () => []),
  }
  return { store, rows }
}

const body = (o: Record<string, unknown> = {}) => ({
  documentId: 'post-1',
  type: 'post',
  projectSlug: 'tmz',
  publicId: null,
  operation: 'update',
  before: { publishedAt: PAST },
  after: { publishedAt: PAST, expiresAt: '2026-10-13T11:59:00.000Z' },
  ...o,
})

const deps = (store: ActivityStore, author: string | null | Error = TOM): StudioDeps => ({
  store,
  authorOf: vi.fn(async () => {
    if (author instanceof Error) throw author
    return author
  }),
  dashboardIdentity: async () => DASH,
  now: () => NOW,
})

describe('the webhook configuration is valid GROQ', () => {
  it('filter and projection parse', () => {
    expect(() => parse(`*[${ACTIVITY_WEBHOOK_FILTER}]`, { mode: 'delta' })).not.toThrow()
    expect(() => parse(`*[]${ACTIVITY_WEBHOOK_PROJECTION}`, { mode: 'delta' })).not.toThrow()
  })
})

describe('the webhook filter fires only on publication changes, and the projection feeds the parser', () => {
  // In a webhook the filter's document is the changed one (after, or before for a deletion).
  const run = async (q: string, before: unknown, after: unknown) => (await evaluate(parse(q, { mode: 'delta' }), { before, after, root: after ?? before } as never)).get()
  const filter = (b: unknown, a: unknown) => run(ACTIVITY_WEBHOOK_FILTER, b, a)
  const doc = (o: Record<string, unknown> = {}) => ({ _id: 'post-1', _type: 'post', projectSlug: 'tmz', publishedAt: PAST, title: 'x', ...o })

  it('date changes, creation and deletion fire; a content edit or another type does not', async () => {
    expect(await filter(doc(), doc({ expiresAt: '2026-10-13T11:59:00.000Z' }))).toBe(true)
    expect(await filter(doc(), doc({ archivedAt: '2026-10-13T11:59:00.000Z' }))).toBe(true)
    expect(await filter(null, doc())).toBe(true)
    expect(await filter(doc(), null)).toBe(true)
    expect(await filter(doc(), doc({ title: 'edited' }))).toBe(false)
    expect(await filter({ ...doc(), _type: 'page' }, { ...doc({ expiresAt: PAST }), _type: 'page' })).toBe(false)
  })

  it('the projection is exactly what parseStudioChange reads', async () => {
    const payload = await run(`*[0]${ACTIVITY_WEBHOOK_PROJECTION}`.replace('*[0]', ''), doc(), doc({ expiresAt: '2026-10-13T11:59:00.000Z' }))
    expect(parseStudioChange(payload)).toEqual({
      documentId: 'post-1',
      type: 'post',
      projectSlug: 'tmz',
      publicId: null,
      before: { publishedAt: PAST, expiresAt: null, archivedAt: null },
      after: { publishedAt: PAST, expiresAt: '2026-10-13T11:59:00.000Z', archivedAt: null },
    })
  })
})

describe('parseStudioChange', () => {
  it('drafts, other types and junk', () => {
    expect(parseStudioChange(body({ documentId: 'drafts.post-1' }))).toBeNull()
    expect(parseStudioChange(body({ type: 'page' }))).toBeNull()
    expect(parseStudioChange('x')).toBe('invalid')
    expect(parseStudioChange({ type: 'post' })).toBe('invalid')
  })
})

describe('recordStudioChange — a person in Studio, confirmed by Sanity', () => {
  const input = (o: Record<string, unknown> = {}, txn = 'txn-studio-1') => ({ body: body(o), transactionId: txn, transactionTime: '2026-10-13T11:59:00.000Z' })

  it('records one studio row: "the Abluo team", never a person id', async () => {
    const { store, rows } = fakeStore()
    expect(await recordStudioChange(input(), deps(store))).toEqual({ status: 204, result: 'recorded' })
    expect(rows).toEqual([
      expect.objectContaining({
        projectId: 'project-tmz',
        contentType: 'post',
        contentId: 'post-1',
        action: 'unpublished',
        actorKind: 'studio',
        actorId: null,
        outcome: 'ok',
        transactionId: 'txn-studio-1',
        occurredAt: '2026-10-13T11:59:00.000Z',
        detail: { sanityUserId: TOM, state: { publishedAt: PAST, expiresAt: '2026-10-13T11:59:00.000Z', archivedAt: null } },
      }),
    ])
  })

  it('an event is keyed by its publicId', async () => {
    const { store, rows } = fakeStore()
    await recordStudioChange(input({ type: 'event', publicId: 'pub-9', before: null, after: {} }), deps(store))
    expect(rows[0]).toMatchObject({ contentType: 'event', contentId: 'pub-9', action: 'published' })
  })

  it('a content edit with unchanged dates is ignored', async () => {
    const { store, rows } = fakeStore()
    expect(await recordStudioChange(input({ after: { publishedAt: PAST } }), deps(store))).toEqual({ status: 204, result: 'ignored' })
    expect(rows).toEqual([])
  })

  it('a dashboard transaction is the dashboard’s to record — no lookup, no row', async () => {
    const { store, rows } = fakeStore()
    const d = deps(store)
    expect(await recordStudioChange(input({}, 'abluo-dash-123'), d)).toEqual({ status: 204, result: 'dashboard' })
    expect(d.authorOf).not.toHaveBeenCalled()
    expect(rows).toEqual([])
  })

  it('written with the dashboard token but not by the dashboard → never a person; left to reconciliation', async () => {
    const { store, rows } = fakeStore()
    expect(await recordStudioChange(input(), deps(store, DASH))).toEqual({ status: 204, result: 'dashboard' })
    expect(rows).toEqual([])
  })

  it('author not confirmable (unknown or lookup error) → 503 so Sanity retries; nothing recorded', async () => {
    for (const a of [null, new Error('down')]) {
      const { store, rows } = fakeStore()
      expect(await recordStudioChange(input(), deps(store, a))).toEqual({ status: 503, result: 'retry' })
      expect(rows).toEqual([])
    }
  })

  it('storage failure → 503; a retry of an already stored change → 204 duplicate', async () => {
    expect(await recordStudioChange(input(), deps(fakeStore({ insert: 'error' }).store))).toEqual({ status: 503, result: 'retry' })
    expect(await recordStudioChange(input(), deps(fakeStore({ insert: 'duplicate' }).store))).toEqual({ status: 204, result: 'duplicate' })
  })

  it('no transaction id or a malformed body → 400', async () => {
    const { store } = fakeStore()
    expect(await recordStudioChange({ body: body(), transactionId: null, transactionTime: null }, deps(store))).toEqual({ status: 400, result: 'invalid' })
    expect(await recordStudioChange({ body: 42, transactionId: 't', transactionTime: null }, deps(store))).toEqual({ status: 400, result: 'invalid' })
  })
})

describe('reconcileActivity — missing dashboard and Studio records are found', () => {
  type Doc = Record<string, unknown>
  function history(docs: Record<string, { before: Doc | null; after: Doc | null }>, txns: Array<{ id: string; author: string; documentIDs: string[] }>) {
    return {
      transactionsBetween: vi.fn(async () => txns.map((t) => ({ ...t, timestamp: '2026-10-13T09:00:00.000Z' }))),
      documentAt: vi.fn(async (id: string, at: { revision: string } | { time: string }) => {
        const d = docs[id]
        if (!d) return null
        if ('revision' in at) return d.after ? { ...d.after, _rev: at.revision } : null
        return d.before
      }),
    }
  }
  const post = (o: Doc = {}) => ({ _id: 'post-1', _type: 'post', projectSlug: 'tmz', publishedAt: PAST, ...o })

  it('a dashboard-token change without a row → unattributed system row; a person’s → studio row', async () => {
    const { store, rows } = fakeStore()
    const h = history(
      {
        'post-1': { before: post(), after: post({ expiresAt: '2026-10-13T09:00:00.000Z' }) },
        'post-2': { before: post({ _id: 'post-2' }), after: post({ _id: 'post-2', archivedAt: '2026-10-13T09:00:00.000Z' }) },
      },
      [
        { id: 'abluo-dash-lost', author: DASH, documentIDs: ['post-1', 'drafts.post-1'] },
        { id: 'studio-txn', author: TOM, documentIDs: ['post-2'] },
      ]
    )
    const s = await reconcileActivity({ store, dashboardIdentity: async () => DASH, ...h, now: () => NOW })
    expect(s).toMatchObject({ transactions: 2, checked: 2, repairedStudio: 1, repairedUnattributed: 1, failed: 0, capped: false })
    expect(rows).toEqual([
      expect.objectContaining({ contentId: 'post-1', action: 'unpublished', actorKind: 'system', actorId: null, transactionId: 'abluo-dash-lost', detail: expect.objectContaining({ reconciled: true, unattributed: true }) }),
      expect.objectContaining({ contentId: 'post-2', action: 'archived', actorKind: 'studio', transactionId: 'studio-txn', detail: expect.objectContaining({ reconciled: true, sanityUserId: TOM }) }),
    ])
    // Drafts are never looked at.
    expect(h.documentAt.mock.calls.some(([id]) => String(id).startsWith('drafts.'))).toBe(false)
  })

  it('already recorded, not a lifecycle change, or not a lifecycle type → nothing', async () => {
    const { store, rows } = fakeStore({ recorded: [['abluo-dash-ok', 'post-1']] })
    const h = history(
      {
        'post-1': { before: post(), after: post({ expiresAt: '2026-10-13T09:00:00.000Z' }) },
        'post-3': { before: post({ _id: 'post-3' }), after: post({ _id: 'post-3', title: 'edited' }) },
        'page-1': { before: { _type: 'page' }, after: { _type: 'page', expiresAt: PAST } },
      },
      [
        { id: 'abluo-dash-ok', author: DASH, documentIDs: ['post-1'] },
        { id: 't3', author: TOM, documentIDs: ['post-3'] },
        { id: 't4', author: TOM, documentIDs: ['page-1'] },
      ]
    )
    const s = await reconcileActivity({ store, dashboardIdentity: async () => DASH, ...h, now: () => NOW })
    expect(rows).toEqual([])
    expect(s).toMatchObject({ repairedStudio: 0, repairedUnattributed: 0, checked: 2 })
  })

  it('a deletion is recorded as deleted', async () => {
    const { store, rows } = fakeStore()
    const h = history({ 'post-1': { before: post(), after: null } }, [{ id: 'del', author: TOM, documentIDs: ['post-1'] }])
    await reconcileActivity({ store, dashboardIdentity: async () => DASH, ...h, now: () => NOW })
    expect(rows[0]).toMatchObject({ action: 'deleted', actorKind: 'studio' })
  })

  it('reads the settled 26-hour window and reports when it is capped', async () => {
    const { store } = fakeStore()
    const many = Array.from({ length: RECONCILE_TRANSACTION_LIMIT }, (_, i) => ({ id: `t${i}`, author: TOM, documentIDs: [] as string[] }))
    const h = history({}, many)
    const s = await reconcileActivity({ store, dashboardIdentity: async () => DASH, ...h, now: () => NOW })
    expect(s.capped).toBe(true)
    const [from, to] = h.transactionsBetween.mock.calls[0] as unknown as [Date, Date]
    expect(from.toISOString()).toBe('2026-10-12T10:00:00.000Z')
    expect(to.toISOString()).toBe('2026-10-13T11:00:00.000Z')
  })
})

describe('retention (provisional)', () => {
  it('ok rows 5 years, the rest 12 months', () => {
    expect(retentionCutoffs(NOW)).toEqual({ okBefore: '2021-10-13T12:00:00.000Z', shortBefore: '2025-10-13T12:00:00.000Z' })
  })
})
