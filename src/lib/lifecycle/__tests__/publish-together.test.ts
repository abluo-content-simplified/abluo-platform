/**
 * ADR-032 Amendment B — publishTogether (ADR-033 D-4 / D-5). Generic service
 * behaviour, exercised with the catalogue descriptors (the first module that
 * declares `references`) and a trivial `prepare`, so what is tested is the
 * service: the tree walk, validation and permissions BEFORE any write, one
 * atomic transaction, schedule inheritance, untouched published dependencies,
 * explicit strengthening and one Activity row per document.
 */
import { describe, expect, it, vi } from 'vitest'
import { evaluate, parse } from 'groq-js'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { planPublish, publishTogether, strengthenReferences, type Doc, type LifecycleClient, type PublishPrepare } from '../service'
import { CATALOGUE_COLLECTION_LIFECYCLE, CATALOGUE_ITEM_LIFECYCLE, CATALOGUE_OPTION_LIST_LIFECYCLE } from '@/lib/api/catalogue-lifecycle'
import { POST_LIFECYCLE } from '@/lib/api/post-lifecycle'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const NOW = new Date('2026-10-14T10:00:00.000Z')
const LATER = '2026-11-01T09:00:00.000Z'
const D = [CATALOGUE_ITEM_LIFECYCLE, CATALOGUE_COLLECTION_LIFECYCLE, CATALOGUE_OPTION_LIST_LIFECYCLE]
const ALL = ['catalogue.item.read', 'catalogue.item.write', 'catalogue.collection.write']
const ctx = (permissions = ALL): TenantAuthorizationContext => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: [{ projectId: 'p', projectSlug: asSupabaseProjectSlug('lucia'), membershipId: 'm', role: 'owner', permissions, enabledModuleIds: ['catalogue'] } as ProjectGrant],
})

const base = { projectSlug: 'lucia' }
const weak = (id: string, type = 'catalogueItem') => ({ _type: 'reference', _ref: id, _key: `k-${id}`, _weak: true, _strengthenOnPublish: { type } })
const strong = (id: string) => ({ _type: 'reference', _ref: id, _key: `k-${id}` })
const coll = (id: string, refs: unknown[], extra: Record<string, unknown> = {}) => ({ _id: `drafts.${id}`, _type: 'catalogueCollection', ...base, name: { it: id }, sections: [{ _key: 's', items: refs }], ...extra })
const item = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, _type: 'catalogueItem', ...base, name: { it: id.replace(/^drafts\./, '') }, ...extra })
const list = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, _type: 'catalogueOptionList', ...base, name: { it: id }, options: [], ...extra })

function world(dataset: Array<Record<string, unknown>>, opts: { commitFails?: boolean } = {}) {
  const docs = new Map(dataset.map((d) => [d._id as string, { _rev: `r-${d._id}`, ...structuredClone(d) }]))
  const ops: Array<[string, unknown]> = []
  const commits: unknown[] = []
  const client = {
    getDocument: vi.fn(async (id: string) => docs.get(id)),
    fetch: vi.fn(async (q: string, params: Record<string, unknown> = {}) => {
      if (q.startsWith('count(') && !q.includes('$id')) return 1 // single-project guard
      return (await evaluate(parse(q, { params }), { dataset: [...docs.values()], params, timestamp: NOW })).get()
    }),
    patch: vi.fn(),
    transaction: vi.fn(() => {
      const tx = {
        patch: (id: string, v: unknown) => (ops.push(['patch', [id, v]]), tx),
        create: (d: unknown) => (ops.push(['create', d]), tx),
        createOrReplace: (d: unknown) => (ops.push(['createOrReplace', d]), tx),
        delete: (id: string) => (ops.push(['delete', id]), tx),
        commit: vi.fn(async (o: unknown) => {
          if (opts.commitFails) throw new Error('boom')
          commits.push(o)
          return {}
        }),
      }
      return tx
    }),
  }
  const audit = vi.fn(async () => undefined)
  return { client: client as unknown as LifecycleClient, ops, commits, audit, deps: { client: client as unknown as LifecycleClient, now: () => NOW, audit } }
}

const prepare: PublishPrepare = async (n) => {
  const out: Doc = {}
  for (const [k, v] of Object.entries(n.draft)) if (!['_id', '_rev', '_createdAt', '_updatedAt'].includes(k)) out[k] = v
  return out
}
const now = () => ({ publishedAt: NOW.toISOString(), expiresAt: null })
const run = (w: ReturnType<typeof world>, root: { type: string; id: string }, o: { withDependencies?: boolean; timing?: () => { publishedAt: string; expiresAt: string | null }; prepare?: PublishPrepare; c?: TenantAuthorizationContext } = {}) =>
  publishTogether(D, o.c ?? ctx(), 'p', { root: { ...root, rev: `r-drafts.${root.id}` }, withDependencies: o.withDependencies ?? true, timing: o.timing ?? now }, o.prepare ?? prepare, w.deps)
const created = (w: ReturnType<typeof world>) => w.ops.filter(([op]) => op === 'create' || op === 'createOrReplace').map(([, d]) => d as Doc)

describe('single publish (withDependencies: false) — D-4', () => {
  it('is refused while the document references never-published content, naming each; nothing is written', async () => {
    const w = world([coll('c', [weak('i1'), weak('i2'), strong('i3')]), item('drafts.i1'), item('drafts.i2', { name: { it: 'Diavola' } }), item('i3')])
    const err = await run(w, { type: 'catalogueCollection', id: 'c' }, { withDependencies: false }).catch((e) => e)
    expect(err.code).toBe('unpublished_dependencies')
    expect(err.dependencies).toEqual([
      { id: 'i1', type: 'catalogueItem', label: 'i1' },
      { id: 'i2', type: 'catalogueItem', label: 'Diavola' },
    ])
    expect(w.client.transaction).not.toHaveBeenCalled()
  })

  it('with only published targets it publishes and strengthens every reference explicitly', async () => {
    const w = world([coll('c', [{ ...strong('i3'), _weak: true, _strengthenOnPublish: { type: 'catalogueItem' } }]), item('i3')])
    await run(w, { type: 'catalogueCollection', id: 'c' }, { withDependencies: false })
    const [doc] = created(w)
    expect(JSON.stringify(doc)).not.toContain('_weak')
    expect(JSON.stringify(doc)).not.toContain('_strengthenOnPublish')
    expect(doc).toMatchObject({ _id: 'c', _type: 'catalogueCollection', projectSlug: 'lucia', publishedAt: NOW.toISOString() })
  })

  it('a reference to a document that exists in no version is refused', async () => {
    const w = world([coll('c', [weak('gone')])])
    await expect(run(w, { type: 'catalogueCollection', id: 'c' })).rejects.toMatchObject({ code: 'unpublished_dependencies', dependencies: [{ id: 'gone' }] })
    expect(w.client.transaction).not.toHaveBeenCalled()
  })
})

describe('publishTogether — D-5', () => {
  it('publishes the root and the whole never-published tree in ONE transaction, references strengthened', async () => {
    const w = world([
      coll('c', [weak('i1'), strong('i3')]),
      item('drafts.i1', { optionLists: [{ _key: 'a', list: weak('ol', 'catalogueOptionList') }] }),
      list('drafts.ol', { options: [{ _key: 'o', item: weak('i2') }] }),
      item('drafts.i2'),
      item('i3'),
    ])
    const r = await run(w, { type: 'catalogueCollection', id: 'c' })
    expect(w.client.transaction).toHaveBeenCalledTimes(1)
    expect(w.commits).toHaveLength(1)
    expect(r.published.map((p) => p.id)).toEqual(['c', 'i1', 'ol', 'i2'])
    expect(created(w).map((d) => d._id)).toEqual(['c', 'i1', 'ol', 'i2'])
    expect(JSON.stringify(created(w))).not.toMatch(/_weak|_strengthenOnPublish/)
    // Every draft is deleted, revision-guarded.
    expect(w.ops.filter(([op]) => op === 'delete').map(([, id]) => id)).toEqual(['drafts.c', 'drafts.i1', 'drafts.ol', 'drafts.i2'])
    expect(w.ops.filter(([op]) => op === 'patch').map(([, x]) => [(x as [string, { ifRevisionID: string }])[0], (x as [string, { ifRevisionID: string }])[1].ifRevisionID])).toEqual([
      ['drafts.c', 'r-drafts.c'], ['drafts.i1', 'r-drafts.i1'], ['drafts.ol', 'r-drafts.ol'], ['drafts.i2', 'r-drafts.i2'],
    ])
  })

  it('cycles are detected safely: every document once', async () => {
    const w = world([
      item('drafts.i1', { optionLists: [{ _key: 'a', list: weak('ol', 'catalogueOptionList') }] }),
      list('drafts.ol', { options: [{ _key: 'o', item: weak('i1') }, { _key: 'p', item: weak('i2') }] }),
      item('drafts.i2', { optionLists: [{ _key: 'a', list: weak('ol', 'catalogueOptionList') }] }),
    ])
    const r = await run(w, { type: 'catalogueItem', id: 'i1' })
    expect(r.published.map((p) => p.id)).toEqual(['i1', 'ol', 'i2'])
  })

  it('dependencies inherit the root\'s publication date; an existing schedule is never overwritten', async () => {
    const w = world([coll('c', [weak('i1'), weak('i2')]), item('drafts.i1'), item('drafts.i2', { publishedAt: '2026-12-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z' })])
    const r = await run(w, { type: 'catalogueCollection', id: 'c' }, { timing: () => ({ publishedAt: LATER, expiresAt: '2026-12-31T00:00:00.000Z' }) })
    const byId = Object.fromEntries(created(w).map((d) => [d._id, d]))
    expect(byId.c).toMatchObject({ publishedAt: LATER, expiresAt: '2026-12-31T00:00:00.000Z' })
    expect(byId.i1.publishedAt).toBe(LATER)
    expect(byId.i1).not.toHaveProperty('expiresAt') // the root's end date is the root's
    expect(byId.i2).toMatchObject({ publishedAt: '2026-12-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z' })
    expect(r.published.find((p) => p.id === 'i2')!.publishedAt).toBe('2026-12-01T00:00:00.000Z')
  })

  it('dependencies that already have a published version are never touched — even when not live (a warning)', async () => {
    const w = world([
      coll('c', [strong('live'), strong('arch'), strong('exp'), strong('sched')]),
      item('live'),
      item('arch', { archivedAt: '2026-10-01T00:00:00Z' }),
      item('exp', { expiresAt: '2026-10-02T00:00:00Z' }),
      item('sched', { publishedAt: '2027-01-01T00:00:00Z' }),
      item('drafts.live', { name: { it: 'changed' } }),
    ])
    const r = await run(w, { type: 'catalogueCollection', id: 'c' })
    expect(created(w).map((d) => d._id)).toEqual(['c'])
    const touched = w.ops.map(([op, x]) => (op === 'delete' ? x : op === 'patch' ? (x as [string])[0] : (x as Doc)._id))
    for (const id of ['live', 'drafts.live', 'arch', 'exp', 'sched']) expect(touched).not.toContain(id)
    expect(r.notLive.map((n) => n.id).sort()).toEqual(['arch', 'exp', 'sched'])
  })

  it('a validation failure anywhere (here the LAST dependency) writes nothing', async () => {
    const w = world([coll('c', [weak('i1'), weak('i2')]), item('drafts.i1'), item('drafts.i2')])
    const failing: PublishPrepare = async (n, x) => {
      if (n.id === 'i2') throw Object.assign(new Error('nope'), { code: 'missing_name' })
      return prepare(n, x)
    }
    await expect(run(w, { type: 'catalogueCollection', id: 'c' }, { prepare: failing })).rejects.toMatchObject({ code: 'missing_name' })
    expect(w.client.transaction).not.toHaveBeenCalled()
    expect(w.audit).toHaveBeenCalledTimes(1)
    expect((w.audit.mock.calls as unknown as [[Record<string, unknown>]])[0][0]).toMatchObject({ contentId: 'c', outcome: 'refused' })
  })

  it('a dependency the editor may not publish refuses the whole publish, naming it; nothing is written', async () => {
    const w = world([coll('c', [weak('i1')]), item('drafts.i1', { name: { it: 'Margherita' } })])
    const err = await run(w, { type: 'catalogueCollection', id: 'c' }, { c: ctx(['catalogue.item.read', 'catalogue.collection.write']) }).catch((e) => e)
    expect(err.code).toBe('forbidden')
    expect(err.dependencies).toEqual([{ id: 'i1', type: 'catalogueItem', label: 'Margherita' }])
    expect(w.client.transaction).not.toHaveBeenCalled()
  })

  it('the root permission is checked before any read', async () => {
    const w = world([coll('c', [])])
    await expect(run(w, { type: 'catalogueCollection', id: 'c' }, { c: ctx(['catalogue.item.read', 'catalogue.item.write']) })).rejects.toThrow()
    expect(w.client.getDocument).not.toHaveBeenCalled()
  })

  it('a failed transaction publishes nothing and reports failure (atomic)', async () => {
    const w = world([coll('c', [weak('i1')]), item('drafts.i1')], { commitFails: true })
    await expect(run(w, { type: 'catalogueCollection', id: 'c' })).rejects.toMatchObject({ code: 'failed' })
    expect(w.commits).toEqual([])
  })

  it('one Activity row per document, all with the same transaction id', async () => {
    const w = world([coll('c', [weak('i1'), weak('i2')]), item('drafts.i1'), item('drafts.i2')])
    await run(w, { type: 'catalogueCollection', id: 'c' }, { timing: () => ({ publishedAt: LATER, expiresAt: null }) })
    const rows = (w.audit.mock.calls as unknown as Array<[Record<string, unknown>]>).map(([e]) => e)
    expect(rows.map((e) => [e.contentType, e.contentId, e.action, e.outcome])).toEqual([
      ['catalogueCollection', 'c', 'scheduled', 'ok'],
      ['catalogueItem', 'i1', 'scheduled', 'ok'],
      ['catalogueItem', 'i2', 'scheduled', 'ok'],
    ])
    expect(new Set(rows.map((e) => e.transactionId)).size).toBe(1)
    expect((w.commits[0] as { transactionId: string }).transactionId).toBe(rows[0].transactionId)
  })

  it('the root keeps its published version guarded (Publish changes): createOrReplace after a revision check', async () => {
    const w = world([item('i1', { _rev: 'pub-1' }), item('drafts.i1', { name: { it: 'Nuovo' } })])
    await run(w, { type: 'catalogueItem', id: 'i1' })
    expect(w.ops.find(([op, x]) => op === 'patch' && (x as [string])[0] === 'i1')![1]).toEqual(['i1', { ifRevisionID: 'pub-1', unset: ['_publishGuard'] }])
    expect(w.ops.some(([op]) => op === 'createOrReplace')).toBe(true)
  })

  it('archived roots are refused until restored', async () => {
    const w = world([item('i1', { archivedAt: '2026-10-01T00:00:00Z' }), item('drafts.i1')])
    await expect(run(w, { type: 'catalogueItem', id: 'i1' })).rejects.toMatchObject({ code: 'archived' })
  })
})

describe('planPublish (read-only preview)', () => {
  it('lists the tree without writing', async () => {
    const w = world([coll('c', [weak('i1'), strong('i3')]), item('drafts.i1'), item('i3', { expiresAt: '2026-10-02T00:00:00Z' })])
    const plan = await planPublish(D, ctx(), 'p', w.client, 'lucia', { type: 'catalogueCollection', id: 'c' }, { liveAt: NOW, withDependencies: true })
    expect(plan.dependencies.map((n) => n.id)).toEqual(['i1'])
    expect(plan.notLive.map((n) => n.id)).toEqual(['i3'])
    expect(w.client.transaction).not.toHaveBeenCalled()
  })
})

describe('strengthenReferences', () => {
  it('removes the weak markers from references only, at any depth', () => {
    expect(strengthenReferences({ a: [{ x: { _ref: 'r', _weak: true, _strengthenOnPublish: { type: 't' }, _key: 'k' } }], _weak: 'not a ref' })).toEqual({
      a: [{ x: { _ref: 'r', _key: 'k' } }],
      _weak: 'not a ref',
    })
  })
})

describe('posts are unaffected', () => {
  it('the post descriptor declares no references and keeps its own delete check', () => {
    expect(POST_LIFECYCLE.references).toBeUndefined()
    expect(POST_LIFECYCLE.deleteReferrers).toBeUndefined()
    expect(POST_LIFECYCLE.dependencies).toBeTypeOf('function')
  })
})

describe('GROQ: weak references dereference like strong ones (public queries unchanged)', () => {
  it('a weak ref to a published document resolves; to a draft-only document it resolves to nothing', async () => {
    const dataset = [
      { _id: 'c', _type: 'catalogueCollection', sections: [{ items: [weak('pub'), weak('only-draft')] }] },
      { _id: 'pub', _type: 'catalogueItem', name: 'Pub' },
      { _id: 'drafts.only-draft', _type: 'catalogueItem', name: 'Draft' },
    ]
    const v = await (await evaluate(parse('*[_id == "c"][0].sections[0].items[]->name'), { dataset })).get()
    expect(v.filter(Boolean)).toEqual(['Pub'])
  })
})
