/**
 * Catalogue lifecycle descriptors (ADR-033 D9, C1, C4; spec §9).
 * The referrer queries run for real on groq-js over a small dataset, so what is
 * asserted is the GROQ's behaviour, not a mock's.
 */
import { describe, it, expect, vi } from 'vitest'
import { evaluate, parse } from 'groq-js'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  CATALOGUE_COLLECTION_LIFECYCLE,
  CATALOGUE_ITEM_LIFECYCLE,
  CATALOGUE_LIFECYCLES,
  CATALOGUE_OPTION_LIST_LIFECYCLE,
  CATALOGUE_PAGE_LIFECYCLE,
  CatalogueLifecycleError,
  isCatalogueId,
} from '../catalogue-lifecycle'
import { LIFECYCLE_OPERATIONS, archive, deleteDraft, deletePermanently, lifecycleGuard, type LifecycleClient } from '@/lib/lifecycle/service'
import { DELETE_REFERRERS, catalogueReferences } from '../catalogue-lifecycle'
import { LIFECYCLE_PUBLIC_RULES, publicFilterFor } from '@/lib/lifecycle/public-types'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const PAST = '2026-10-01T00:00:00.000Z'
const grant = (permissions: string[]): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('lucia'),
  membershipId: 'm1',
  role: 'owner',
  permissions,
  enabledModuleIds: ['catalogue'],
})
const ALL = [
  'catalogue.item.read', 'catalogue.item.write', 'catalogue.item.delete', 'catalogue.item.deletePublished',
  'catalogue.collection.write', 'catalogue.collection.delete', 'catalogue.collection.deletePublished',
]
const ctx = (permissions = ALL): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [grant(permissions)] })

const nm = (it: string) => ({ it })
type D = Record<string, unknown> & { _id: string; _type: string }
const base = { projectSlug: 'lucia' }

/** fetch = real GROQ over `dataset`; reads/writes = a minimal in-memory store. */
function world(dataset: D[], write: { fail?: boolean } = {}) {
  const docs = new Map(dataset.map((d) => [d._id, { _rev: `r-${d._id}`, ...structuredClone(d) }]))
  const fetched: string[] = []
  const deleted: string[] = []
  const client = {
    getDocument: vi.fn(async (id: string) => docs.get(id)),
    fetch: vi.fn(async (q: string, params: Record<string, unknown> = {}) => {
      fetched.push(q)
      if (q.startsWith('count(') && !q.includes('$id')) return 1 // assertSingleSanityProject
      const value = await evaluate(parse(q, { params }), { dataset: [...docs.values()], params, timestamp: NOW })
      return value.get()
    }),
    patch: vi.fn(() => {
      const b = { ifRevisionId: () => b, set: () => b, unset: () => b, commit: async () => ({ _rev: 'x' }) }
      return b
    }),
    transaction: vi.fn(() => {
      const tx = {
        patch: () => tx,
        delete: (id: string) => (deleted.push(id), tx),
        commit: async () => {
          if (write.fail) throw new Error('boom')
          return {}
        },
      }
      return tx
    }),
  }
  return { client: client as unknown as LifecycleClient, fetched, deleted }
}
const deps = (w: ReturnType<typeof world>) => ({ client: w.client, now: () => NOW, audit: async () => {} })

// ── Guard mapping ─────────────────────────────────────────────────────────────

describe('lifecycleGuard per catalogue descriptor (ADR-033 C4)', () => {
  const item = ['catalogue.item.write', 'catalogue.item.delete', 'catalogue.item.deletePublished']
  const coll = ['catalogue.collection.write', 'catalogue.collection.delete', 'catalogue.collection.deletePublished']
  const expected = (p: string[]) => ({
    unpublishNow: [p[0]], backOnline: [p[0]], setEndDate: [p[0]], archive: [p[0]], restore: [p[0]],
    deleteDraft: [p[1]], deletePermanently: [p[1], p[2]],
  })
  const map = (d: Parameters<typeof lifecycleGuard>[0]) => Object.fromEntries(LIFECYCLE_OPERATIONS.map((op) => [op, lifecycleGuard(d, op)]))

  it('items use catalogue.item.*', () => expect(map(CATALOGUE_ITEM_LIFECYCLE)).toEqual(expected(item)))
  it('option lists reuse catalogue.item.* — no catalogue.optionList.* ids exist', () => {
    expect(map(CATALOGUE_OPTION_LIST_LIFECYCLE)).toEqual(expected(item))
    expect(JSON.stringify(map(CATALOGUE_OPTION_LIST_LIFECYCLE))).not.toContain('optionList')
  })
  it('collections and the landing page use catalogue.collection.*', () => {
    expect(map(CATALOGUE_COLLECTION_LIFECYCLE)).toEqual(expected(coll))
    expect(map(CATALOGUE_PAGE_LIFECYCLE)).toEqual(expected(coll))
  })
})

describe('registration', () => {
  it('all four types are registered with the optional publishedAt rule', () => {
    for (const d of CATALOGUE_LIFECYCLES) {
      expect(d.rule).toBe('optional')
      expect(LIFECYCLE_PUBLIC_RULES[d.type as keyof typeof LIFECYCLE_PUBLIC_RULES]).toBe('optional')
      expect(publicFilterFor(d.type as keyof typeof LIFECYCLE_PUBLIC_RULES)).toContain('!defined(archivedAt)')
    }
    expect(CATALOGUE_LIFECYCLES.map((d) => d.type)).toEqual(['catalogueItem', 'catalogueCollection', 'catalogueOptionList', 'cataloguePage'])
  })
  it('ids are safe, draft-less and fail with the module error class', () => {
    expect(isCatalogueId('lucia-item-margherita')).toBe(true)
    for (const bad of ['drafts.x', '', '../x', 'a b', 5, null]) expect(isCatalogueId(bad)).toBe(false)
    expect(CATALOGUE_ITEM_LIFECYCLE.fail('in_use', 'm')).toBeInstanceOf(CatalogueLifecycleError)
  })
  it('only the landing page has no dependency check', () => {
    expect(CATALOGUE_PAGE_LIFECYCLE.referrers).toBeUndefined()
    expect(CATALOGUE_PAGE_LIFECYCLE.dependencies).toBeUndefined()
  })
})

// ── Dependency refusals name their referrers ──────────────────────────────────

const archivedItem = (id = 'item-1'): D => ({ _id: id, _type: 'catalogueItem', ...base, archivedAt: PAST, expiresAt: PAST, name: nm('Margherita') })
const liveItem = (id = 'item-1'): D => ({ _id: id, _type: 'catalogueItem', ...base, name: nm('Margherita') })
const coll = (id: string, name: string, items: string[], extra: Partial<D> = {}): D => ({
  _id: id, _type: 'catalogueCollection', ...base, name: nm(name),
  sections: [{ _key: 's1', name: nm('Pizze'), items: items.map((r) => ({ _type: 'reference', _ref: r, _key: r })) }],
  ...extra,
})

describe('catalogueItem — public collections and option lists block, and are named', () => {
  it('permanent delete is refused naming every public collection and option list', async () => {
    const w = world([
      archivedItem(),
      coll('c1', 'Menu di Natale', ['item-1']),
      coll('c2', 'Carta', ['item-1']),
      { _id: 'ol1', _type: 'catalogueOptionList', ...base, name: nm('Extra'), options: [{ _key: 'o', label: nm('Pizza'), item: { _type: 'reference', _ref: 'item-1' } }] },
    ])
    const err = await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w)).catch((e) => e)
    expect(err).toBeInstanceOf(CatalogueLifecycleError)
    expect(err.code).toBe('in_use')
    expect(err.message).toBe('Still used by: Menu di Natale, Carta, Extra.')
    expect(err.referrers.map((r: { id: string; type: string }) => [r.id, r.type])).toEqual([
      ['c1', 'catalogueCollection'], ['c2', 'catalogueCollection'], ['ol1', 'catalogueOptionList'],
    ])
    expect(w.deleted).toEqual([])
  })

  it('archive is refused the same way — before anything is written', async () => {
    const w = world([liveItem(), coll('c1', 'Menu', ['item-1'])])
    const err = await archive(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: Menu.' })
    expect(w.client.transaction).not.toHaveBeenCalled()
  })

  it('ARCHIVE: draft, archived, expired, scheduled and other-project collections do NOT block (D-8 table)', async () => {
    const w = world([
      liveItem(),
      { ...coll('drafts.c-draft', 'Bozza', ['item-1']) },
      coll('c-arch', 'Vecchio', ['item-1'], { archivedAt: PAST }),
      coll('c-exp', 'Scaduto', ['item-1'], { publishedAt: '2026-01-01T00:00:00Z', expiresAt: PAST }),
      coll('c-sched', 'Futuro', ['item-1'], { publishedAt: '2027-01-01T00:00:00Z' }),
      coll('c-other', 'Altro', ['item-1'], { projectSlug: 'someone-else' }),
    ])
    await archive(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w))
    expect(w.client.transaction).toHaveBeenCalled()
  })

  it('PERMANENT DELETE: ANY reference blocks — draft, archived, expired, scheduled — each named; other projects do not (D-8)', async () => {
    const w = world([
      archivedItem(),
      { ...coll('drafts.c-draft', 'Bozza', ['item-1']) },
      coll('c-arch', 'Vecchio', ['item-1'], { archivedAt: PAST }),
      coll('c-exp', 'Scaduto', ['item-1'], { publishedAt: '2026-01-01T00:00:00Z', expiresAt: PAST }),
      coll('c-sched', 'Futuro', ['item-1'], { publishedAt: '2027-01-01T00:00:00Z' }),
      coll('c-other', 'Altro', ['item-1'], { projectSlug: 'someone-else' }),
      coll('c-unrelated', 'Altro ancora', ['item-2']),
    ])
    const err = await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use' })
    expect(err.referrers.map((r: { id: string }) => r.id).sort()).toEqual(['c-arch', 'c-draft', 'c-exp', 'c-sched'])
    expect(w.deleted).toEqual([])
  })

  it('PERMANENT DELETE: weak references (a draft that picked a never-published item) block too', async () => {
    const w = world([archivedItem(), { ...coll('drafts.c1', 'Bozza', []), sections: [{ _key: 's', items: [{ _type: 'reference', _ref: 'item-1', _weak: true, _strengthenOnPublish: { type: 'catalogueItem' }, _key: 'k' }] }] }])
    const err = await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: Bozza.' })
  })

  it('deleting a never-published draft is refused while another draft references it (D-8)', async () => {
    const w = world([
      { _id: 'drafts.item-9', _type: 'catalogueItem', ...base, name: nm('Nuova') },
      { ...coll('drafts.c1', 'Bozza', []), sections: [{ _key: 's', items: [{ _type: 'reference', _ref: 'item-9', _weak: true, _key: 'k' }] }] },
    ])
    const err = await deleteDraft(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-9', rev: 'r-drafts.item-9' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: Bozza.' })
    expect(w.deleted).toEqual([])
  })

  it('nothing referencing it (other project, unrelated) → deleted', async () => {
    const w = world([archivedItem(), coll('c-other', 'Altro', ['item-1'], { projectSlug: 'someone-else' }), coll('c-unrelated', 'Altro ancora', ['item-2'])])
    await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w))
    expect(w.deleted).toEqual(['item-1'])
  })

  it('a public collection that has a draft is one referrer, named once', async () => {
    const w = world([archivedItem(), coll('c1', 'Menu', ['item-1']), coll('drafts.c1', 'Menu (bozza)', ['item-1'])])
    const err = await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w)).catch((e) => e)
    expect(err.referrers).toHaveLength(1)
    expect(err.message).toBe('Still used by: Menu.')
  })

  it('every referrer query is scoped to the grant project (archive: public referrers; delete: any reference)', async () => {
    const w = world([liveItem()])
    await archive(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w))
    const calls = () => (w.client.fetch as unknown as { mock: { calls: [string, Record<string, unknown>, unknown][] } }).mock.calls
    const refCalls = calls().filter(([q]) => q.includes('$id in'))
    expect(refCalls).toHaveLength(2)
    for (const [q, p, o] of refCalls) {
      expect(q).toContain('projectSlug == $projectSlug')
      expect(p).toEqual({ id: 'item-1', projectSlug: 'lucia' })
      expect(o).toEqual({ perspective: 'raw' })
    }
    const w2 = world([archivedItem()])
    await deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w2))
    const del = (w2.client.fetch as unknown as { mock: { calls: [string, Record<string, unknown>, unknown][] } }).mock.calls.filter(([q]) => q === DELETE_REFERRERS)
    expect(del).toHaveLength(1)
    expect(del[0][1]).toEqual({ id: 'item-1', draftId: 'drafts.item-1', projectSlug: 'lucia' })
    expect(del[0][2]).toEqual({ perspective: 'raw' })
  })
})

describe('catalogueOptionList — any non-archived item that attaches it blocks', () => {
  const list = (): D => ({ _id: 'ol1', _type: 'catalogueOptionList', ...base, name: nm('Extra'), archivedAt: PAST })
  const attach = (id: string, name: string, extra: Partial<D> = {}): D => ({
    _id: id, _type: 'catalogueItem', ...base, name: nm(name), optionLists: [{ _key: 'a', list: { _type: 'reference', _ref: 'ol1' } }], ...extra,
  })

  it('names the items — published, scheduled and draft-only alike', async () => {
    const w = world([list(), attach('i1', 'Margherita'), attach('i2', 'Diavola', { publishedAt: '2027-01-01T00:00:00Z' }), attach('drafts.i3', 'Bozza')])
    const err = await deletePermanently(CATALOGUE_OPTION_LIST_LIFECYCLE, ctx(), 'project-a', { id: 'ol1', rev: 'r-ol1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: Margherita, Diavola, Bozza.' })
  })

  it('ARCHIVE: archived items do not block', async () => {
    const w = world([{ ...list(), archivedAt: undefined }, attach('i1', 'Margherita', { archivedAt: PAST })])
    await archive(CATALOGUE_OPTION_LIST_LIFECYCLE, ctx(), 'project-a', { id: 'ol1', rev: 'r-ol1' }, deps(w))
    expect(w.client.transaction).toHaveBeenCalled()
  })

  it('PERMANENT DELETE: an archived item still attaching it blocks, and is named (D-8, refines C7)', async () => {
    const w = world([list(), attach('i1', 'Margherita', { archivedAt: PAST })])
    const err = await deletePermanently(CATALOGUE_OPTION_LIST_LIFECYCLE, ctx(), 'project-a', { id: 'ol1', rev: 'r-ol1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: Margherita.' })
    expect(err.referrers[0]).toEqual({ id: 'i1', type: 'catalogueItem', label: 'Margherita' })
    expect(w.deleted).toEqual([])
  })

  it('nothing attaches it → deleted', async () => {
    const w = world([list()])
    await deletePermanently(CATALOGUE_OPTION_LIST_LIFECYCLE, ctx(), 'project-a', { id: 'ol1', rev: 'r-ol1' }, deps(w))
    expect(w.deleted).toEqual(['ol1'])
  })
})

describe('catalogueCollection — a public landing-page listing section blocks', () => {
  const archivedCollection = (): D => ({ _id: 'c1', _type: 'catalogueCollection', ...base, name: nm('Menu'), archivedAt: PAST })
  const page = (id: string, title: string, extra: Partial<D> = {}): D => ({
    _id: id, _type: 'cataloguePage', ...base, heroTitle: nm(title),
    sections: [{ _key: 'l', _type: 'catalogueListingSection', collection: { _type: 'reference', _ref: 'c1' } }], ...extra,
  })

  it('names the page', async () => {
    const w = world([archivedCollection(), page('p1', 'La nostra carta')])
    const err = await deletePermanently(CATALOGUE_COLLECTION_LIFECYCLE, ctx(), 'project-a', { id: 'c1', rev: 'r-c1' }, deps(w)).catch((e) => e)
    expect(err).toMatchObject({ code: 'in_use', message: 'Still used by: La nostra carta.' })
  })

  it('ARCHIVE: an archived or draft page, or a page showing another collection, does not block', async () => {
    const w = world([{ ...archivedCollection(), archivedAt: undefined }, page('p1', 'Vecchia', { archivedAt: PAST }), page('drafts.p2', 'Bozza'),
      { ...page('p3', 'Altra'), sections: [{ _key: 'l', _type: 'catalogueListingSection', collection: { _type: 'reference', _ref: 'other' } }] }])
    await archive(CATALOGUE_COLLECTION_LIFECYCLE, ctx(), 'project-a', { id: 'c1', rev: 'r-c1' }, deps(w))
    expect(w.client.transaction).toHaveBeenCalled()
  })

  it('PERMANENT DELETE: archived and draft pages block too (D-8); a page showing another collection does not', async () => {
    const w = world([archivedCollection(), page('p1', 'Vecchia', { archivedAt: PAST }), page('drafts.p2', 'Bozza'),
      { ...page('p3', 'Altra'), sections: [{ _key: 'l', _type: 'catalogueListingSection', collection: { _type: 'reference', _ref: 'other' } }] }])
    const err = await deletePermanently(CATALOGUE_COLLECTION_LIFECYCLE, ctx(), 'project-a', { id: 'c1', rev: 'r-c1' }, deps(w)).catch((e) => e)
    expect(err.referrers.map((r: { id: string }) => r.id).sort()).toEqual(['p1', 'p2'])
  })

  it('a page with no label is still named', async () => {
    const w = world([archivedCollection(), { ...page('p1', ''), heroTitle: undefined }])
    const err = await deletePermanently(CATALOGUE_COLLECTION_LIFECYCLE, ctx(), 'project-a', { id: 'c1', rev: 'r-c1' }, deps(w)).catch((e) => e)
    expect(err.message).toBe('Still used by: Catalogue page.')
  })
})

describe('cataloguePage — nothing depends on the landing page', () => {
  it('deletes without any referrer query', async () => {
    const w = world([{ _id: 'pg', _type: 'cataloguePage', ...base, archivedAt: PAST }])
    await deletePermanently(CATALOGUE_PAGE_LIFECYCLE, ctx(), 'project-a', { id: 'pg', rev: 'r-pg' }, deps(w))
    expect(w.deleted).toEqual(['pg'])
    expect(w.fetched.some((q) => q.includes('$id in'))).toBe(false)
  })
})

describe('permissions are checked before any read', () => {
  it('a caller without catalogue.item.deletePublished is forbidden and nothing is fetched', async () => {
    const w = world([archivedItem()])
    await expect(
      deletePermanently(CATALOGUE_ITEM_LIFECYCLE, ctx(['catalogue.item.write', 'catalogue.item.delete']), 'project-a', { id: 'item-1', rev: 'r-item-1' }, deps(w))
    ).rejects.toThrow()
    expect(w.fetched).toEqual([])
  })
})

describe('outgoing references for publishing (D-4/D-5)', () => {
  it('collection → items; item → option lists; option list → linked items; page → collections; unique ids', () => {
    expect(catalogueReferences.collection({ sections: [{ items: [{ _ref: 'a' }, { _ref: 'b' }] }, { items: [{ _ref: 'a', _weak: true }] }] })).toEqual([
      { id: 'a', type: 'catalogueItem' },
      { id: 'b', type: 'catalogueItem' },
    ])
    expect(catalogueReferences.item({ optionLists: [{ list: { _ref: 'L' } }, { list: null }] })).toEqual([{ id: 'L', type: 'catalogueOptionList' }])
    expect(catalogueReferences.optionList({ options: [{ item: { _ref: 'x' } }, {}] })).toEqual([{ id: 'x', type: 'catalogueItem' }])
    expect(catalogueReferences.page({ sections: [{ _type: 'catalogueListingSection', collection: { _ref: 'c' } }, { _type: 'heroSection' }] })).toEqual([{ id: 'c', type: 'catalogueCollection' }])
    expect(catalogueReferences.item({})).toEqual([])
  })
  it('the item, collection and option list descriptors declare them', () => {
    expect(CATALOGUE_ITEM_LIFECYCLE.references).toBe(catalogueReferences.item)
    expect(CATALOGUE_COLLECTION_LIFECYCLE.references).toBe(catalogueReferences.collection)
    expect(CATALOGUE_OPTION_LIST_LIFECYCLE.references).toBe(catalogueReferences.optionList)
  })
})
