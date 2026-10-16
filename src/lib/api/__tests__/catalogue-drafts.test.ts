/**
 * Catalogue in the client dashboard (ADR-033, spec §12 AC 5/6/7/29/30):
 * every refusal happens BEFORE any read or write; identity comes from the
 * grant; publicId is set once; slugs are unique across items AND
 * collections and a clash names the other document.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  CatalogueError,
  catalogueAbilities,
  createCatalogueDoc,
  listCatalogue,
  openCatalogueForEdit,
  patchCatalogueDraft,
  previewCataloguePublish,
  publishCatalogueDraft,
  runCatalogueLifecycle,
} from '../catalogue-drafts'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ALL = [
  'catalogue.item.read',
  'catalogue.item.write',
  'catalogue.item.delete',
  'catalogue.item.deletePublished',
  'catalogue.collection.write',
  'catalogue.collection.delete',
  'catalogue.collection.deletePublished',
]
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('trattoria'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['catalogue'],
  ...o,
})
const viewer = () => grant({ role: 'viewer', permissions: ['catalogue.item.read'] })
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

type Docs = Record<string, Record<string, unknown>>
const CONFIG = { publicSegment: 'menu', currency: 'EUR', serviceChannels: [{ value: 'dine-in', label: { it: 'Al tavolo' } }], categories: [{ value: 'pizza', label: { it: 'Pizza' } }] }

function fake(docs: Docs = {}, namespace: Array<Record<string, unknown>> = []) {
  const writes: string[] = []
  const created: Record<string, unknown>[] = []
  const txOps: Array<[string, unknown]> = []
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('"site": *[_type == "siteConfig"')) return { site: { defaultLocale: 'it', supportedLocales: ['it', 'en'], timeZone: 'Europe/Rome' }, config: CONFIG, translate: false }
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.startsWith('count(*[_type == $type')) return 0
    if (q.includes('hasPage == true')) return namespace
    if (q.includes('options[]{ _key, label, kind, item, allergenDeclaration }')) {
      const want = new Set([...(p.ids as string[]), ...(p.draftIds as string[])])
      return Object.values(docs).filter((d) => d._type === 'catalogueOptionList' && want.has(d._id as string))
    }
    if (q.includes('itemProfile == "foodOrDrink" && $id in optionLists[].list._ref')) {
      return Object.values(docs).filter(
        (d) => d._type === 'catalogueItem' && d.itemProfile === 'foodOrDrink' && !d.archivedAt && ((d.optionLists as Array<{ list?: { _ref?: string } }>) ?? []).some((a) => a.list?._ref === p.id)
      ).length
    }
    if (q.includes('(_id in $ids || _id in $draftIds)')) {
      const want = new Set([...(p.ids as string[]), ...(p.draftIds as string[])])
      return Object.values(docs).filter((d) => d._type === p.type && want.has(d._id as string)).map((d) => ({ _id: d._id, offered: Array.isArray(d.offers) && d.offers.length > 0 }))
    }
    if (q.includes('references($id)')) return 0
    if (q.includes('_type == $type') || q.includes('"mediaAsset"')) return p.ids
    if (q.includes('"items": *[_type == "catalogueItem"')) return { items: Object.values(docs).filter((d) => d._type === 'catalogueItem'), collections: [], optionLists: [] }
    throw new Error(`unexpected query ${q}`)
  })
  const patchOps: unknown[] = []
  const commitOpts: Array<[string, unknown]> = []
  const patch = vi.fn(() => {
    const pb = {
      ifRevisionId: () => pb,
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), pb),
      set: (v: unknown) => (patchOps.push(['set', v]), pb),
      unset: (v: unknown) => (patchOps.push(['unset', v]), pb),
      commit: vi.fn(async (opts?: unknown) => (commitOpts.push(['patch', opts]), writes.push('patch'), { _rev: 'd2' })),
    }
    return pb
  })
  const transaction = vi.fn(() => {
    const tx = {
      patch: (id: string, v: unknown) => {
        if (typeof v === 'function') {
          // Patch-builder form: record the operations it applies.
          const ops: unknown[] = []
          const b = { setIfMissing: (x: unknown) => (ops.push(['setIfMissing', x]), b), set: (x: unknown) => (ops.push(['set', x]), b), unset: (x: unknown) => (ops.push(['unset', x]), b) }
          ;(v as (p: typeof b) => unknown)(b)
          txOps.push(['patch', [id, ops]])
        } else txOps.push(['patch', [id, v]])
        return tx
      },
      create: (d: unknown) => (txOps.push(['create', d]), tx),
      createOrReplace: (d: unknown) => (txOps.push(['createOrReplace', d]), tx),
      delete: (id: string) => (txOps.push(['delete', id]), tx),
      commit: vi.fn(async (opts?: { returnDocuments?: boolean }) => {
        commitOpts.push(['transaction', opts])
        writes.push('transaction')
        return opts?.returnDocuments ? txOps.filter((o) => o[0] === 'create').map((o) => ({ ...(o[1] as object), _rev: 'tx1' })) : {}
      }),
    }
    return tx
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>, opts?: unknown) => (created.push(d), commitOpts.push(['create', opts]), writes.push('create'), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  let u = 0
  const deps = { client: client as never, uuid: () => `uuid-${++u}`, now: () => new Date('2026-10-13T10:00:00Z'), audit: vi.fn(async () => undefined) }
  return { client, deps, writes, created, txOps, patchOps, commitOpts }
}

const draftItem = (o: Record<string, unknown> = {}) => ({
  _id: 'drafts.item-1', _type: 'catalogueItem', _rev: 'd1', projectSlug: 'trattoria', publicId: 'pub-1',
  itemProfile: 'foodOrDrink', allergenDeclaration: { status: 'noneDeclared', confirmed: true },
  name: { it: 'Margherita' }, hasPage: false, visibility: 'public', ...o,
})

describe('permissions are checked server-side before any I/O (AC 5/6)', () => {
  it('a viewer cannot create, patch, publish or run lifecycle actions', async () => {
    const f = fake({ 'drafts.item-1': draftItem() })
    const c = ctx(viewer())
    await expect(createCatalogueDoc(c, 'project-a', 'item', { name: 'x' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(createCatalogueDoc(c, 'project-a', 'collection', { name: 'x' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(createCatalogueDoc(c, 'project-a', 'optionList', { name: 'x' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(patchCatalogueDraft(c, 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { 'name.it': 'y' } }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(publishCatalogueDraft(c, 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(runCatalogueLifecycle(c, 'project-a', 'item', { op: 'archive', id: 'item-1' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })
  it('a viewer may read', async () => {
    const f = fake({ 'drafts.item-1': draftItem() })
    const r = await listCatalogue(ctx(viewer()), 'project-a', f.deps)
    expect(r.items.map((i) => i.id)).toEqual(['item-1'])
    expect(r.items[0].status.status).toBe('draft')
  })
  it('without the module installed nothing is allowed, whatever the role', async () => {
    const f = fake()
    const g = grant({ enabledModuleIds: [] })
    await expect(listCatalogue(ctx(g), 'project-a', f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(createCatalogueDoc(ctx(g), 'project-a', 'item', {}, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })
  it('an editor may write but not permanently delete published content (C9)', async () => {
    const editor = grant({ role: 'editor', permissions: ALL.filter((p) => !p.endsWith('deletePublished')) })
    expect(catalogueAbilities(editor).item).toEqual({ write: true, delete: true, deletePublished: false })
    const f = fake({ 'item-1': { ...draftItem(), _id: 'item-1', archivedAt: '2026-10-01T00:00:00Z' } })
    await expect(runCatalogueLifecycle(ctx(editor), 'project-a', 'item', { op: 'deletePermanently', id: 'item-1' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.writes).toEqual([])
  })
})

describe('create (AC 7/29/30)', () => {
  it('a new item is a draft with a publicId, public visibility and no page; projectSlug from the grant', async () => {
    const f = fake()
    const r = await createCatalogueDoc(ctx(grant()), 'project-a', 'item', { name: ' Margherita ', itemProfile: 'foodOrDrink' }, f.deps)
    expect(r.id).toBe('uuid-1')
    expect(f.created[0]).toMatchObject({
      _id: 'drafts.uuid-1',
      _type: 'catalogueItem',
      projectSlug: 'trattoria',
      publicId: 'uuid-2',
      itemProfile: 'foodOrDrink',
      allergenDeclaration: { status: 'notReviewed' },
      hasPage: false,
      visibility: 'public',
      name: { _type: 'localizedString', it: 'Margherita' },
    })
  })
  it('a collection defaults to "list"; option lists get no publicId', async () => {
    const f = fake()
    await createCatalogueDoc(ctx(grant()), 'project-a', 'collection', {}, f.deps)
    await createCatalogueDoc(ctx(grant()), 'project-a', 'optionList', { name: 'Extra' }, f.deps)
    expect(f.created[0]).toMatchObject({ _type: 'catalogueCollection', collectionType: 'list', sections: [], publicId: expect.any(String) })
    expect(f.created[1]).toMatchObject({ _type: 'catalogueOptionList', options: [] })
    expect(f.created[1]).not.toHaveProperty('publicId')
  })
})

describe('patch', () => {
  it('another project\'s document is "not_found"', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ projectSlug: 'other' }) })
    await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })
  it('a slug used by a collection is refused and names it', async () => {
    const f = fake({ 'drafts.item-1': draftItem() }, [{ _id: 'col-1', _type: 'catalogueCollection', hasPage: true, label: { it: 'Menu di Natale' }, slug: { it: { current: 'margherita' } } }])
    const err = await patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { 'slug.it': 'Margherita' } }, f.deps).catch((e) => e)
    expect(err).toBeInstanceOf(CatalogueError)
    expect(err.code).toBe('invalid_value')
    expect(err.detail.conflicts[0].owner).toEqual({ id: 'col-1', type: 'collection', label: 'Menu di Natale' })
    expect(f.writes).toEqual([])
  })
  it('offers are written without a currency', async () => {
    const f = fake({ 'drafts.item-1': draftItem() })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { offers: [{ _key: 'o1', channel: 'dine-in', price: 8.5, currency: 'CHF' }] } }, f.deps)
    expect(JSON.stringify(f.patchOps)).not.toContain('currency')
    expect(f.writes).toEqual(['patch'])
  })
  it('an autosave does not wait for the query index (visibility async); the revision guard stays', async () => {
    const f = fake({ 'drafts.item-1': draftItem() })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { 'name.it': 'y' } }, f.deps)
    expect(f.commitOpts).toEqual([['patch', { visibility: 'async' }]])
  })
  describe('first edit of a published item opens + saves in one transaction (optimisation D)', () => {
    const live = () => ({ ...draftItem(), _id: 'item-1', _rev: 'p1' })
    it('creates the draft from the live version and applies the change, in one async transaction', async () => {
      const f = fake({ 'item-1': live() })
      const r = await patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', openFrom: 'p1', set: { 'name.it': 'Nuovo' } }, f.deps)
      expect(r.rev).toBe('tx1')
      expect(f.writes).toEqual(['transaction'])
      expect(f.commitOpts).toEqual([['transaction', { visibility: 'async', returnDocuments: true }]])
      const [create, patch] = f.txOps as Array<[string, unknown]>
      expect(create[0]).toBe('create')
      expect(create[1]).toMatchObject({ _id: 'drafts.item-1', _type: 'catalogueItem', projectSlug: 'trattoria' })
      expect(create[1]).not.toHaveProperty('_rev')
      expect(patch[0]).toBe('patch')
      expect(patch[1]).toEqual(['drafts.item-1', expect.arrayContaining([['set', expect.objectContaining({ 'name.it': 'Nuovo' })]])])
    })
    it('refuses as a conflict when a draft already exists (someone else started editing) — nothing written', async () => {
      const f = fake({ 'item-1': live(), 'drafts.item-1': draftItem() })
      await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', openFrom: 'p1', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
      expect(f.writes).toEqual([])
    })
    it('refuses as a conflict when the live version changed since the editor loaded it', async () => {
      const f = fake({ 'item-1': live() })
      await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', openFrom: 'p0', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
      expect(f.writes).toEqual([])
    })
    it('an archived item is refused; an empty rev without openFrom is still "Missing revision"', async () => {
      const f = fake({ 'item-1': { ...live(), archivedAt: '2026-10-01T00:00:00Z' } })
      await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', openFrom: 'p1', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'archived' })
      await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'conflict' })
      expect(f.writes).toEqual([])
    })
    it("another project's item is not_found, also on the first edit", async () => {
      const f = fake({ 'item-1': { ...live(), projectSlug: 'other' } })
      await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: '', openFrom: 'p1', set: { 'name.it': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    })
  })
  it('opening a published item for edit copies it with visibility async', async () => {
    const f = fake({ 'item-1': { ...draftItem(), _id: 'item-1' } })
    await openCatalogueForEdit(ctx(grant()), 'project-a', 'item', 'item-1', f.deps)
    expect(f.commitOpts).toEqual([['create', { visibility: 'async' }]])
  })
})

describe('publish (spec §11)', () => {
  it('needs a name in the main language', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ name: { en: 'Only English' } }) })
    await expect(publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'missing_name' })
  })
  it('an option list needs at least one option', async () => {
    const f = fake({ 'drafts.ol-1': { _id: 'drafts.ol-1', _type: 'catalogueOptionList', _rev: 'd1', projectSlug: 'trattoria', name: { it: 'Extra' }, options: [] } })
    await expect(publishCatalogueDraft(ctx(grant()), 'project-a', 'optionList', { id: 'ol-1', rev: 'd1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'no_options' })
  })
  it('archived content is refused until restored', async () => {
    const f = fake({ 'drafts.item-1': draftItem(), 'item-1': { ...draftItem(), _id: 'item-1', _rev: 'p1', archivedAt: '2026-10-01T00:00:00Z' } })
    await expect(publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'archived' })
  })
  it('with a page: slugs derived per language, unique across items and collections; publicId kept', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ hasPage: true, name: { it: 'Margherita', en: 'Margherita' } }) }, [{ _id: 'other', _type: 'catalogueItem', hasPage: true, label: { it: 'X' }, slug: { en: { current: 'margherita' } } }])
    const r = await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)
    expect(r.slugs).toEqual({ it: 'margherita', en: 'margherita-2' })
    const doc = f.txOps.find(([op]) => op === 'create')![1] as Record<string, unknown>
    expect(doc).toMatchObject({ _id: 'item-1', publicId: 'pub-1', projectSlug: 'trattoria', publishedAt: '2026-10-13T10:00:00.000Z' })
  })
  it('an explicit slug that clashes is refused and names the other document', async () => {
    const f = fake(
      { 'drafts.item-1': draftItem({ hasPage: true, slug: { it: { current: 'natale' } } }) },
      [{ _id: 'col-1', _type: 'catalogueCollection', hasPage: true, label: { it: 'Menu di Natale' }, slug: { it: { current: 'natale' } } }]
    )
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps).catch((e) => e)
    expect(err.code).toBe('slug_taken')
    expect(err.detail.conflicts[0].owner.label).toBe('Menu di Natale')
    expect(f.writes).toEqual([])
  })
})

describe('item profile on create (ADR-033 D-1, D-2, D-3)', () => {
  it('a product gets no allergen declaration; a food item starts not reviewed', async () => {
    const f = fake()
    await createCatalogueDoc(ctx(grant()), 'project-a', 'item', { name: 'Libro', itemProfile: 'product' }, f.deps)
    expect(f.created[0]).toMatchObject({ itemProfile: 'product' })
    expect(f.created[0]).not.toHaveProperty('allergenDeclaration')
  })
  it('no profile chosen and no module default → refused (a generic install assumes nothing)', async () => {
    const f = fake()
    await expect(createCatalogueDoc(ctx(grant()), 'project-a', 'item', { name: 'x' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(createCatalogueDoc(ctx(grant()), 'project-a', 'item', { name: 'x', itemProfile: 'dish' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.created).toEqual([])
  })
})

describe('allergens block publishing (ADR-033 D-3)', () => {
  for (const decl of [{ status: 'notReviewed' }, undefined, { status: 'containsListedAllergens', allergens: [] }, { status: 'noneDeclared' }]) {
    it(`food with ${JSON.stringify(decl)} is refused; nothing written`, async () => {
      const f = fake({ 'drafts.item-1': draftItem({ allergenDeclaration: decl }) })
      await expect(publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'allergens_not_reviewed' })
      expect(f.writes).toEqual([])
    })
  }
  it('a product publishes without any declaration, and a stray one is not published', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ itemProfile: 'product', allergenDeclaration: { status: 'notReviewed' } }) })
    await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)
    const doc = f.txOps.find(([op]) => op === 'create')![1] as Record<string, unknown>
    expect(doc).not.toHaveProperty('allergenDeclaration')
  })
})

describe('draft references (ADR-033 D-4)', () => {
  const draftColl = (o: Record<string, unknown> = {}) => ({ _id: 'drafts.col-1', _type: 'catalogueCollection', _rev: 'c1', projectSlug: 'trattoria', publicId: 'pc', name: { it: 'Menu' }, collectionType: 'menu', sections: [], hasPage: false, ...o })
  it('a never-published item is written WEAK with strengthen-on-publish; a published one strong', async () => {
    const f = fake({ 'drafts.col-1': draftColl(), 'drafts.new-1': draftItem({ _id: 'drafts.new-1' }), 'pub-2': draftItem({ _id: 'pub-2' }) })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'collection', { id: 'col-1', rev: 'c1', set: { sections: [{ _key: 's', name: { it: 'Pizze' }, items: ['new-1', 'pub-2'] }] } }, f.deps)
    const set = (f.patchOps as Array<[string, unknown]>).find(([op]) => op === 'set') as [string, { sections: Array<{ items: Array<Record<string, unknown>> }> }]
    const [a, b] = set[1].sections[0].items
    expect(a).toMatchObject({ _ref: 'new-1', _weak: true, _strengthenOnPublish: { type: 'catalogueItem' } })
    expect(b._ref).toBe('pub-2')
    expect(b).not.toHaveProperty('_weak')
  })
  it('an option list picked while still a draft is referenced weakly; an unknown one is refused', async () => {
    const f = fake({ 'drafts.item-1': draftItem(), 'drafts.ol-9': { _id: 'drafts.ol-9', _type: 'catalogueOptionList', projectSlug: 'trattoria' } })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { optionLists: [{ listId: 'ol-9', min: 0 }] } }, f.deps)
    expect(JSON.stringify(f.patchOps)).toContain('"_strengthenOnPublish":{"type":"catalogueOptionList"}')
    await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { optionLists: [{ listId: 'nope', min: 0 }] } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
  it('an option may link to a draft item only if it is offered (D2)', async () => {
    const ol = { _id: 'drafts.ol-1', _type: 'catalogueOptionList', _rev: 'o1', projectSlug: 'trattoria', name: { it: 'Contorni' }, options: [] }
    const f = fake({ 'drafts.ol-1': ol, 'drafts.side': draftItem({ _id: 'drafts.side', offers: [{ _key: 'o', price: 3 }] }), 'drafts.free': draftItem({ _id: 'drafts.free' }) })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'optionList', { id: 'ol-1', rev: 'o1', set: { options: [{ _key: 'a', label: { it: 'Insalata' }, itemId: 'side' }] } }, f.deps)
    expect(JSON.stringify(f.patchOps)).toContain('"_weak":true')
    await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'optionList', { id: 'ol-1', rev: 'o1', set: { options: [{ _key: 'a', label: { it: 'X' }, itemId: 'free' }] } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
  it('publishing a collection that lists a never-published item is refused, naming it; nothing written', async () => {
    const weakRef = { _type: 'reference', _ref: 'new-1', _key: 'k', _weak: true, _strengthenOnPublish: { type: 'catalogueItem' } }
    const f = fake({ 'drafts.col-1': draftColl({ sections: [{ _key: 's', items: [weakRef] }] }), 'drafts.new-1': draftItem({ _id: 'drafts.new-1', name: { it: 'Diavola' } }) })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'collection', { id: 'col-1', rev: 'c1', mode: 'now' }, f.deps).catch((e) => e)
    expect(err).toBeInstanceOf(CatalogueError)
    expect(err.code).toBe('unpublished_dependencies')
    expect(err.detail.dependencies).toEqual([{ id: 'new-1', type: 'catalogueItem', label: 'Diavola' }])
    expect(f.writes).toEqual([])
  })
  it('"Publish collection and dependencies" publishes both in one transaction, strengthened, the item taking the schedule', async () => {
    const weakRef = { _type: 'reference', _ref: 'new-1', _key: 'k', _weak: true, _strengthenOnPublish: { type: 'catalogueItem' } }
    const f = fake({ 'drafts.col-1': draftColl({ sections: [{ _key: 's', items: [weakRef] }] }), 'drafts.new-1': draftItem({ _id: 'drafts.new-1', _rev: 'n1', name: { it: 'Diavola' } }) })
    const at = '2026-10-20T18:00:00.000Z'
    const r = await publishCatalogueDraft(ctx(grant()), 'project-a', 'collection', { id: 'col-1', rev: 'c1', mode: 'schedule', publishAt: at, withDependencies: true }, f.deps)
    expect(f.writes).toEqual(['transaction'])
    expect(r.published).toEqual([{ type: 'catalogueCollection', id: 'col-1', publishedAt: at }, { type: 'catalogueItem', id: 'new-1', publishedAt: at }])
    const docs = f.txOps.filter(([op]) => op === 'create').map(([, d]) => d as Record<string, unknown>)
    expect(docs.map((d) => d._id)).toEqual(['col-1', 'new-1'])
    expect(JSON.stringify(docs)).not.toMatch(/_weak|_strengthenOnPublish/)
    expect(f.deps.audit).toHaveBeenCalledTimes(2)
  })
  it('a dependency that is not ready (allergens not reviewed) refuses the whole publish, naming it', async () => {
    const weakRef = { _type: 'reference', _ref: 'new-1', _key: 'k', _weak: true }
    const f = fake({ 'drafts.col-1': draftColl({ sections: [{ _key: 's', items: [weakRef] }] }), 'drafts.new-1': draftItem({ _id: 'drafts.new-1', name: { it: 'Diavola' }, allergenDeclaration: { status: 'notReviewed' } }) })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'collection', { id: 'col-1', rev: 'c1', mode: 'now', withDependencies: true }, f.deps).catch((e) => e)
    expect(err.code).toBe('allergens_not_reviewed')
    expect(err.detail.dependencies).toEqual([{ id: 'new-1', type: 'catalogueItem', label: 'Diavola' }])
    expect(f.writes).toEqual([])
  })
  it('an editor who may publish collections but not items cannot publish the item with it', async () => {
    const weakRef = { _type: 'reference', _ref: 'new-1', _key: 'k', _weak: true }
    const f = fake({ 'drafts.col-1': draftColl({ sections: [{ _key: 's', items: [weakRef] }] }), 'drafts.new-1': draftItem({ _id: 'drafts.new-1' }) })
    const g = grant({ permissions: ['catalogue.item.read', 'catalogue.collection.write'] })
    const err = await publishCatalogueDraft(ctx(g), 'project-a', 'collection', { id: 'col-1', rev: 'c1', mode: 'now', withDependencies: true }, f.deps).catch((e) => e)
    expect(err.code).toBe('forbidden')
    expect(err.detail.dependencies[0].id).toBe('new-1')
    expect(f.writes).toEqual([])
  })
})

describe('a localized address needs a localized name (ADR-033 D-7)', () => {
  it('server-side save refuses a slug in a language without a name', async () => {
    const f = fake({ 'drafts.item-1': draftItem() })
    await expect(patchCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', set: { 'slug.en': 'margherita' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })
  it('publish REFUSES a stray address (never drops it), naming the language; nothing written (E-3)', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ hasPage: true, name: { it: 'Margherita' }, slug: { it: { current: 'margherita' }, en: { current: 'stale' } } }) })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps).catch((e) => e)
    expect(err).toMatchObject({ code: 'slug_without_name', detail: { locales: ['en'] } })
    expect(f.writes).toEqual([])
  })
  it('a dependency with a stray address refuses the combined publish, naming the dependency and the language', async () => {
    const weakRef = { _type: 'reference', _ref: 'new-1', _key: 'k', _weak: true }
    const f = fake({
      'drafts.col-1': { _id: 'drafts.col-1', _type: 'catalogueCollection', _rev: 'c1', projectSlug: 'trattoria', name: { it: 'Menu' }, sections: [{ _key: 's', items: [weakRef] }] },
      'drafts.new-1': draftItem({ _id: 'drafts.new-1', name: { it: 'Diavola' }, hasPage: true, slug: { en: { current: 'devil' } } }),
    })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'collection', { id: 'col-1', rev: 'c1', mode: 'now', withDependencies: true }, f.deps).catch((e) => e)
    expect(err.code).toBe('slug_without_name')
    expect(err.detail.locales).toEqual(['en'])
    expect(err.detail.dependencies[0]).toMatchObject({ id: 'new-1', label: 'Diavola' })
    expect(f.writes).toEqual([])
  })
})

describe('"Publish … and dependencies" preview (ADR-033 D-5)', () => {
  it('names the root, every never-published dependency, own pages, blockers — and writes nothing', async () => {
    const weakRef = (id: string) => ({ _type: 'reference', _ref: id, _key: id, _weak: true })
    const f = fake({
      'drafts.col-1': { _id: 'drafts.col-1', _type: 'catalogueCollection', _rev: 'c1', projectSlug: 'trattoria', name: { it: 'Menu' }, hasPage: true, sections: [{ _key: 's', items: [weakRef('a'), weakRef('b')] }] },
      'drafts.a': draftItem({ _id: 'drafts.a', name: { it: 'Diavola' }, hasPage: true }),
      'drafts.b': draftItem({ _id: 'drafts.b', name: { it: 'Bianca' }, allergenDeclaration: { status: 'notReviewed' } }),
    })
    const p = await previewCataloguePublish(ctx(grant()), 'project-a', 'collection', { id: 'col-1' }, f.deps)
    expect(p.root).toMatchObject({ id: 'col-1', label: 'Menu', opensPage: true })
    expect(p.publishAt).toBeNull()
    expect(p.dependencies.map((d) => [d.id, d.label, d.opensPage, d.reusedBy])).toEqual([['a', 'Diavola', true, 0], ['b', 'Bianca', false, 0]])
    expect(p.blocked).toEqual([{ id: 'b', type: 'catalogueItem', label: 'Bianca', code: 'allergens_not_reviewed' }])
    expect(f.writes).toEqual([])
  })
  it('needs the write permission, checked before any read', async () => {
    const f = fake()
    await expect(previewCataloguePublish(ctx(viewer()), 'project-a', 'collection', { id: 'col-1' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })
})

describe('allergens of option choices (ADR-033 D-3a)', () => {
  const choice = (label: string, o: Record<string, unknown> = {}) => ({ _key: label, _type: 'catalogueOption', label: { it: label }, kind: 'add', priceDelta: 1, ...o })
  const list = (id: string, options: unknown[], o: Record<string, unknown> = {}) => ({ _id: id, _type: 'catalogueOptionList', _rev: `r-${id}`, projectSlug: 'trattoria', name: { it: 'Extra' }, options, ...o })
  const attach = (id: string) => ({ optionLists: [{ _key: 'a', list: { _type: 'reference', _ref: id }, min: 0 }] })
  const unreviewed = choice('Mozzarella', { allergenDeclaration: { status: 'notReviewed' } })
  const reviewed = choice('Acciughe', { allergenDeclaration: { status: 'containsListedAllergens', allergens: ['fish'] } })

  it('a food item is refused while an extra it offers is not reviewed — naming list · choice and linking the list', async () => {
    const f = fake({ 'drafts.item-1': draftItem(attach('ol-1')), 'ol-1': list('ol-1', [unreviewed, reviewed]) })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps).catch((e) => e)
    expect(err.code).toBe('option_allergens_not_reviewed')
    expect(err.detail.dependencies).toEqual([{ id: 'ol-1', type: 'catalogueOptionList', label: 'Extra · Mozzarella' }])
    expect(f.writes).toEqual([])
  })
  it('remove and linked choices never need their own declaration; reviewed extras pass', async () => {
    const f = fake({
      'drafts.item-1': draftItem(attach('ol-1')),
      'ol-1': list('ol-1', [reviewed, choice('Senza cipolla', { kind: 'remove' }), choice('Patatine', { item: { _type: 'reference', _ref: 'side' } }), choice('Nulla', { allergenDeclaration: { status: 'noneDeclared', confirmed: true } })]),
    })
    await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)
    expect(f.writes).toEqual(['transaction'])
  })
  it('the same list on a product or service is unaffected', async () => {
    const f = fake({ 'drafts.item-1': draftItem({ itemProfile: 'service', ...attach('ol-1') }), 'ol-1': list('ol-1', [unreviewed]) })
    await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)
    expect(f.writes).toEqual(['transaction'])
  })
  it('the live (published) version of the list counts, not an unpublished draft of it', async () => {
    const f = fake({ 'drafts.item-1': draftItem(attach('ol-1')), 'ol-1': list('ol-1', [reviewed]), 'drafts.ol-1': list('drafts.ol-1', [unreviewed]) })
    await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now' }, f.deps)
    expect(f.writes).toEqual(['transaction'])
  })
  it('combined publishing validates every such choice first: a never-published list with an unreviewed extra refuses all', async () => {
    const weakList = { optionLists: [{ _key: 'a', list: { _type: 'reference', _ref: 'ol-2', _weak: true }, min: 0 }] }
    const f = fake({ 'drafts.item-1': draftItem(weakList), 'drafts.ol-2': list('drafts.ol-2', [unreviewed]) })
    const err = await publishCatalogueDraft(ctx(grant()), 'project-a', 'item', { id: 'item-1', rev: 'd1', mode: 'now', withDependencies: true }, f.deps).catch((e) => e)
    expect(err.code).toBe('option_allergens_not_reviewed')
    expect(err.detail.dependencies[0]).toEqual({ id: 'ol-2', type: 'catalogueOptionList', label: 'Extra · Mozzarella' })
    expect(f.writes).toEqual([])
  })
  it('an option list cannot go live with an unreviewed extra while a food item uses it; unused (or product-only) it can', async () => {
    const used = fake({ 'drafts.ol-1': list('drafts.ol-1', [unreviewed]), 'item-9': draftItem({ _id: 'item-9', ...attach('ol-1') }) })
    await expect(publishCatalogueDraft(ctx(grant()), 'project-a', 'optionList', { id: 'ol-1', rev: 'r-drafts.ol-1', mode: 'now' }, used.deps)).rejects.toMatchObject({ code: 'option_allergens_not_reviewed' })
    const productOnly = fake({ 'drafts.ol-1': list('drafts.ol-1', [unreviewed]), 'item-9': draftItem({ _id: 'item-9', itemProfile: 'product', ...attach('ol-1') }) })
    await publishCatalogueDraft(ctx(grant()), 'project-a', 'optionList', { id: 'ol-1', rev: 'r-drafts.ol-1', mode: 'now' }, productOnly.deps)
    expect(productOnly.writes).toEqual(['transaction'])
  })
  it('autosave stores a free-text extra\'s declaration (default notReviewed), never one on remove / linked choices', async () => {
    const f = fake({ 'drafts.ol-1': list('drafts.ol-1', [], { _rev: 'o1' }), 'side': draftItem({ _id: 'side', offers: [{ _key: 'o', price: 2 }] }) })
    await patchCatalogueDraft(ctx(grant()), 'project-a', 'optionList', {
      id: 'ol-1', rev: 'o1',
      set: { options: [
        { _key: 'a', label: { it: 'Mozzarella' } },
        { _key: 'b', label: { it: 'Acciughe' }, allergenDeclaration: { status: 'containsListedAllergens', allergens: ['fish'] } },
        { _key: 'c', label: { it: 'Senza' }, kind: 'remove', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
        { _key: 'd', label: { it: 'Patatine' }, itemId: 'side', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
      ] },
    }, f.deps)
    const set = (f.patchOps as Array<[string, { options?: Array<Record<string, unknown>> }]>).find(([op, v]) => op === 'set' && v.options)![1].options!
    expect(set.map((o) => o.allergenDeclaration ?? null)).toEqual([{ status: 'notReviewed' }, { status: 'containsListedAllergens', allergens: ['fish'] }, null, null])
  })
})
