// Contract C1.7 / C1.11 — the registered reference sources behind deletionBlockers:
// registry, late registration, the item sources (drafts count, one logical item
// once, archived items count) and the registry-completeness rule.

import { afterEach, describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { catalogueSchemaTypes } from '../../schema'
import {
  categoryReferenceSources,
  coveredCategoryKeyFields,
  gatherCategoryReferences,
  ITEM_CATEGORY_REFERENCES_QUERY,
  itemCategoryReferenceSources,
  itemReferenceHits,
  registerCategoryReferenceSource,
  resetCategoryReferenceSourcesForTest,
} from '../reference-sources'
import { buildTree, deletionBlockers } from '../tree'
import type { CategoryReferenceSource } from '../types'

afterEach(() => resetCategoryReferenceSourcesForTest())

const fake = (id: string, kind: CategoryReferenceSource['kind'], count: number, stores: CategoryReferenceSource['stores'] = []): CategoryReferenceSource => ({
  id,
  kind,
  stores,
  find: async () => ({ count, sample: [] }),
})

const TREE = buildTree([{ key: 'liqueurs', label: { en: 'Liqueurs' }, parentKey: null, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null }])

describe('registry', () => {
  it('throws on a duplicate or malformed id', () => {
    registerCategoryReferenceSource(fake('automatic-listings', 'automatic_listing', 0))
    expect(() => registerCategoryReferenceSource(fake('automatic-listings', 'automatic_listing', 0))).toThrow(/duplicate/)
    expect(() => registerCategoryReferenceSource(fake('Bad Id', 'other', 0))).toThrow(/invalid/)
  })
  it('delete/late-source: a source registered after the fact appears in deletionBlockers with no change to the function', async () => {
    expect(deletionBlockers(TREE, 'liqueurs', await gatherCategoryReferences('p', 'liqueurs', categoryReferenceSources()))).toEqual([])
    registerCategoryReferenceSource(fake('x-future', 'other', 3))
    const refs = await gatherCategoryReferences('p', 'liqueurs', categoryReferenceSources())
    expect(deletionBlockers(TREE, 'liqueurs', refs)).toMatchObject([{ code: 'referenced_by_other', count: 3, sourceId: 'x-future', cleanable: false }])
  })
  it('a source with cleanup is cleanable', async () => {
    registerCategoryReferenceSource({ ...fake('automatic-listings', 'automatic_listing', 2), cleanup: { preview: async () => ({ affected: 2, sample: [] }), apply: async () => ({ changed: 2 }) } })
    const refs = await gatherCategoryReferences('p', 'liqueurs')
    expect(deletionBlockers(TREE, 'liqueurs', refs)).toMatchObject([{ code: 'referenced_by_listing', cleanable: true }])
  })
})

// ── item sources ─────────────────────────────────────────────────────────────

const ITEMS = [
  // published + draft of one item: counted once
  { _id: 'a', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'A' }, categories: ['pizza_bianche'] },
  { _id: 'drafts.a', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'A' }, categories: ['pizza_bianche'] },
  // draft-only item (no published copy) — drafts count (D-3)
  { _id: 'drafts.b', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'B' }, primaryCategory: 'liqueurs' },
  // archived item — counts
  { _id: 'c', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'C' }, archivedAt: '2026-01-01T00:00:00Z', categories: ['x', 'pizza_bianche'] },
  // new fields win over the legacy list
  { _id: 'd', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'D' }, primaryCategory: 'other', additionalCategories: ['pizza_bianche'], categories: ['liqueurs'] },
  // other project, versions: never
  { _id: 'e', _type: 'catalogueItem', projectSlug: 'q', name: { en: 'E' }, categories: ['pizza_bianche'] },
  { _id: 'versions.r1.a', _type: 'catalogueItem', projectSlug: 'p', name: { en: 'A' }, categories: ['pizza_bianche'] },
]
const groqFetch = async (query: string, params: Record<string, unknown>) => (await (await evaluate(parse(query), { dataset: ITEMS, params })).get()) as never

describe('item sources', () => {
  it('delete/used-draft-only: a draft-only item with primary liqueurs counts', async () => {
    const [primary, additional] = itemCategoryReferenceSources(groqFetch, { locale: 'en', defaultLocale: 'en' })
    expect((await primary.find('p', 'liqueurs')).count).toBe(1)
    expect((await additional.find('p', 'liqueurs')).count).toBe(0) // d's legacy list is ignored: its new fields win
  })
  it('delete/used-published: a draft + published copy of one item count once; archived items count', async () => {
    const [primary, additional] = itemCategoryReferenceSources(groqFetch, { locale: 'en', defaultLocale: 'en' })
    const p = await primary.find('p', 'pizza_bianche')
    const a = await additional.find('p', 'pizza_bianche')
    expect(p).toEqual({ count: 1, sample: [{ id: 'a', type: 'catalogueItem', name: 'A' }] })
    expect(a.count).toBe(2) // c (archived, legacy second category) and d (additionalCategories)
    expect(a.sample.map((s) => s.id).sort()).toEqual(['c', 'd'])
  })
  it('delete/used-archived-item', () => {
    const hits = itemReferenceHits([{ _id: 'z', name: 'Z', categories: ['k'] }], 'k')
    expect(hits.primary.count).toBe(1)
  })
  it('an item primary in one copy and additional in the other counts once, as primary', () => {
    const hits = itemReferenceHits([{ _id: 'x', primaryCategory: 'k' }, { _id: 'drafts.x', primaryCategory: 'j', additionalCategories: ['k'] }], 'k')
    expect([hits.primary.count, hits.additional.count]).toEqual([1, 0])
  })
  it('the query is project-scoped and excludes versions', () => {
    expect(ITEM_CATEGORY_REFERENCES_QUERY).toContain('projectSlug == $projectSlug')
    expect(ITEM_CATEGORY_REFERENCES_QUERY).toContain('!(_id in path("versions.**"))')
  })
})

// ── refs/registry-complete ───────────────────────────────────────────────────

type FieldDef = { name: string; type: string; of?: { type: string }[]; fields?: FieldDef[] }
type TypeDef = { name: string; type: string; fields?: FieldDef[] }

/** Fields that store category keys: name mentions "categor" and the value is a string or a string list. */
function categoryKeyFields(types: readonly TypeDef[]): { type: string; field: string }[] {
  const out: { type: string; field: string }[] = []
  for (const t of types) {
    if (t.type !== 'document') continue
    for (const f of t.fields ?? []) {
      const stringish = f.type === 'string' || (f.type === 'array' && (f.of ?? []).every((m) => m.type === 'string'))
      if (/categor/i.test(f.name) && stringish) out.push({ type: t.name, field: f.name })
    }
  }
  return out
}

function uncovered(fields: { type: string; field: string }[], covered: { type: string; field: string }[]) {
  return fields.filter((f) => !covered.some((c) => c.type === f.type && c.field === f.field))
}

describe('refs/registry-complete', () => {
  const builtIn = () => coveredCategoryKeyFields(itemCategoryReferenceSources(async () => [], { locale: 'en', defaultLocale: 'en' }))
  it('every category-key field of the Catalogue schema is covered by a reference source', () => {
    const fields = categoryKeyFields(catalogueSchemaTypes as unknown as TypeDef[])
    expect(fields).toEqual(expect.arrayContaining([
      { type: 'catalogueItem', field: 'categories' },
      { type: 'catalogueItem', field: 'primaryCategory' },
      { type: 'catalogueItem', field: 'additionalCategories' },
    ]))
    expect(uncovered(fields, [...builtIn(), ...coveredCategoryKeyFields()])).toEqual([])
  })
  it('a test double field without a source fails the check', () => {
    const extra: TypeDef = { name: 'catalogueAutomaticListing', type: 'document', fields: [{ name: 'categoryKeys', type: 'array', of: [{ type: 'string' }] }] }
    const fields = categoryKeyFields([...(catalogueSchemaTypes as unknown as TypeDef[]), extra])
    expect(uncovered(fields, builtIn())).toEqual([{ type: 'catalogueAutomaticListing', field: 'categoryKeys' }])
    registerCategoryReferenceSource(fake('automatic-listings', 'automatic_listing', 0, [{ type: 'catalogueAutomaticListing', field: 'categoryKeys' }]))
    expect(uncovered(fields, [...builtIn(), ...coveredCategoryKeyFields()])).toEqual([])
  })
})
