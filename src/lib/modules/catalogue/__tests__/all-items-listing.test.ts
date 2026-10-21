/**
 * Catalogue listing section — `source`: every published item by default,
 * a collection optional. Real queries evaluated by groq-js at a fixed clock.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { catalogueAllItemsQuery, catalogueCollectionByIdQuery } from '@/lib/sanity/queries'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import type { CatalogueConfigDTO } from '../dto'
import { hydrateCatalogueListing, listingSourceIsAll, type CatalogueFetch } from '../website'
import { catalogueListingSection } from '../schema'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const CONFIG: CatalogueConfigDTO = {
  currency: 'EUR', segment: 'libri', segmentHistory: [], showPricesByDefault: true, channels: [], categories: [], tags: [], dietaryTags: [], timeZone: null, affiliateDisclosure: null,
}
const CTX = { locale: 'en', defaultLocale: 'en', config: CONFIG, now: NOW }

const item = (id: string, over: Record<string, unknown> = {}) => ({
  _id: `catalogueItem-${id}`, _type: 'catalogueItem', projectSlug: 'tmz', publicId: id, itemProfile: 'book', hasPage: true,
  name: { en: id }, slug: { en: { current: id } }, publishedAt: '2026-10-01T09:00:00.000Z', ...over,
})
const DATASET: Record<string, unknown>[] = [
  item('old-book', { publishedAt: '2026-09-01T09:00:00.000Z' }),
  item('b-new', { publishedAt: '2026-10-05T09:00:00.000Z' }),
  item('a-new', { publishedAt: '2026-10-05T09:00:00.000Z' }),
  item('no-page', { hasPage: false, publishedAt: '2026-09-15T09:00:00.000Z' }),
  item('website-only', { visibility: 'websiteOnly', publishedAt: '2026-09-20T09:00:00.000Z' }),
  item('unlisted', { visibility: 'unlisted' }),
  item('archived', { archivedAt: '2026-10-02T09:00:00.000Z' }),
  item('scheduled', { publishedAt: '2026-12-01T09:00:00.000Z' }),
  item('expired', { expiresAt: '2026-10-02T09:00:00.000Z' }),
  item('draft-only', { _id: 'drafts.catalogueItem-draft-only' }), // the delivery client reads the published perspective
  item('other-project', { projectSlug: 'other' }),
  { _id: 'catalogueCollection-c', _type: 'catalogueCollection', projectSlug: 'tmz', publicId: 'c', collectionType: 'list', hasPage: false, name: { en: 'C' }, publishedAt: '2026-09-01T09:00:00.000Z',
    sections: [{ _key: 's', name: { en: 'S' }, items: [{ _type: 'reference', _key: 'r', _ref: 'catalogueItem-old-book' }] }] },
]

async function run<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = { projectSlug: 'tmz', locale: 'en', defaultLocale: 'en', ...params }
  const v = await evaluate(parse(query, { params: p }), { dataset: DATASET.filter((d) => !String(d._id).startsWith('drafts.')), params: p, timestamp: NOW })
  return (await v.get()) as T
}
const fetchForTenant: CatalogueFetch = async (q, params) => (await run(q, params)) as never
const names = (d: Awaited<ReturnType<typeof hydrateCatalogueListing>>) => d.collection?.sections.flatMap((s) => s.items.map((i) => i.name)) ?? []

describe('catalogueAllItemsQuery', () => {
  it('is project scoped, lifecycle filtered and capped', () => {
    expect(catalogueAllItemsQuery).toContain('projectSlug == $projectSlug')
    expect(catalogueAllItemsQuery).toContain(publicFilterFor('catalogueItem'))
    expect(catalogueAllItemsQuery).toContain('[0...200]')
  })
  it('excludes archived, scheduled, expired, draft-only, unlisted and other projects', async () => {
    const rows = await run<{ publicId: string }[]>(catalogueAllItemsQuery)
    const ids = rows.map((r) => r.publicId)
    for (const gone of ['archived', 'scheduled', 'expired', 'draft-only', 'unlisted', 'other-project']) expect(ids).not.toContain(gone)
    expect(ids).toContain('website-only')
    expect(ids).toContain('no-page')
  })
  it('orders newest first, then by name', async () => {
    const ids = (await run<{ publicId: string }[]>(catalogueAllItemsQuery)).map((r) => r.publicId)
    expect(ids).toEqual(['a-new', 'b-new', 'website-only', 'no-page', 'old-book'])
  })
})

describe('listingSourceIsAll — legacy rules', () => {
  it('missing source: collection set → collection; nothing set → all', () => {
    expect(listingSourceIsAll(undefined, 'catalogueCollection-c')).toBe(false)
    expect(listingSourceIsAll(null, null)).toBe(true)
    expect(listingSourceIsAll(undefined, undefined)).toBe(true)
  })
  it('source "all" ignores a stored collection; "collection" without one shows nothing', () => {
    expect(listingSourceIsAll('all', 'catalogueCollection-c')).toBe(true)
    expect(listingSourceIsAll('collection', 'catalogueCollection-c')).toBe(false)
    expect(listingSourceIsAll('collection', null)).toBe(false)
  })
})

describe('hydrateCatalogueListing — source', () => {
  it('source "all" lists every public item and ignores the collection', async () => {
    const d = await hydrateCatalogueListing(fetchForTenant, 'catalogueCollection-c', CTX, {}, 'all')
    expect(names(d)).toEqual(['a-new', 'b-new', 'website-only', 'no-page', 'old-book'])
    expect(d.collection?.sections).toHaveLength(1)
    expect(d.collection?.sections[0].name).toBe('')
  })
  it('no source + collection → that collection (legacy)', async () => {
    const d = await hydrateCatalogueListing(fetchForTenant, 'catalogueCollection-c', CTX, {})
    expect(names(d)).toEqual(['old-book'])
  })
  it('no source + no collection → all', async () => {
    const d = await hydrateCatalogueListing(fetchForTenant, null, CTX, {})
    expect(names(d)).toHaveLength(5)
  })
  it('source "collection" + no collection → nothing', async () => {
    const d = await hydrateCatalogueListing(fetchForTenant, null, CTX, {}, 'collection')
    expect(d.collection).toBeNull()
  })
  it('items without a page stay in the list but have no page ref (cards, not links)', async () => {
    const d = await hydrateCatalogueListing(fetchForTenant, null, CTX, {}, 'all')
    const items = d.collection!.sections[0].items
    expect(items.find((i) => i.name === 'no-page')?.page).toBeNull()
    expect(items.find((i) => i.name === 'a-new')?.page?.slug).toBe('a-new')
  })
  it('nothing published → empty collection (the section shows its empty state)', async () => {
    const empty: CatalogueFetch = async () => [] as never
    const d = await hydrateCatalogueListing(empty, null, CTX, {}, 'all')
    expect(names(d)).toEqual([])
  })
  it('the collection query is untouched by the "all" path', async () => {
    const calls: string[] = []
    const spy: CatalogueFetch = async (q, p) => { calls.push(q === catalogueAllItemsQuery ? 'all' : q === catalogueCollectionByIdQuery ? 'col' : '?'); return fetchForTenant(q, p) }
    await hydrateCatalogueListing(spy, 'catalogueCollection-c', CTX, {}, 'all')
    await hydrateCatalogueListing(spy, 'catalogueCollection-c', CTX, {}, 'collection')
    expect(calls).toEqual(['all', 'col'])
  })
})

describe('catalogueListingSection schema', () => {
  const fields = (catalogueListingSection as unknown as { fields: { name: string; initialValue?: unknown; hidden?: (a: { parent?: unknown }) => boolean; options?: { list?: { value: string }[] } }[] }).fields
  it('has source with all/collection, default all', () => {
    const f = fields.find((x) => x.name === 'source')!
    expect(f.options?.list?.map((o) => o.value)).toEqual(['all', 'collection'])
    expect(f.initialValue).toBe('all')
  })
  it('hides the collection field when source is all', () => {
    const f = fields.find((x) => x.name === 'collection')!
    expect(f.hidden?.({ parent: { source: 'all' } })).toBe(true)
    expect(f.hidden?.({ parent: { source: 'collection' } })).toBe(false)
    expect(f.hidden?.({ parent: {} })).toBe(false)
  })
})
