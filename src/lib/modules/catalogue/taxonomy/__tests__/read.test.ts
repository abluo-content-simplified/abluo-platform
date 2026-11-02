// Contract C1.9 R1 / C1.10 — the triple dual-read of the Catalogue vocabulary
// (taxonomy document → taxonomyTerm → config.categories) and the tolerant item
// assignment reader, plus the readers switched onto them (website config + item,
// website filter, dashboard site, dashboard list) and their GROQ.

import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { catalogueCategoryVocabulary, tagVocabulary } from '@/lib/taxonomy/vocabulary'
import { catalogueModuleConfigQuery } from '@/lib/sanity/queries'
import { CATALOGUE_DASHBOARD_LIST_QUERY, CATALOGUE_SITE_QUERY } from '../../dashboard-queries'
import { resolveCatalogueConfig, resolveItem, type RawCatalogueConfigRow } from '../../resolve'
import { collectionFilterCategories, itemCategoryFilterKeys } from '../../website'
import type { CatalogueCollectionDTO } from '../../dto'
import {
  catalogueTaxonomyGroq,
  catalogueTaxonomyId,
  catalogueVocabulary,
  itemCategoryAssignment,
  itemCategoryKeys,
  readCategoryChannelRules,
  readCategoryNodes,
  readTagNodes,
} from '../read'
import { buildTree, expandForFilter, legacyCategoriesToAssignment } from '../tree'
import { asChannelKey } from '../../commerce/commerce-types'

// ── frozen tmz fixture (production 2026-11-02, F4/F5 — read-only queries) ────
const TMZ_CATEGORY_TERMS = [
  { key: 'technology', order: 1000, label: { en: 'Technology', it: 'Tecnologia', de: 'Technologie' } },
  { key: 'design', order: 2000, label: { en: 'Design', it: 'Design', de: 'Design' } },
  { key: 'literature', order: 3000, label: { en: 'Literature', it: 'Letteratura', de: 'Literatur' } },
]
const TMZ_TAG_TERMS = ['science_fiction', 'fantasy', 'humour', 'satire', 'illustrated_boos', 'inspirational', 'memoir'].map((key, i) => ({ key, order: (i + 1) * 1000, label: { en: key } }))
/** The stale legacy list (literature missing) — ignored for tmz under J-8. */
const TMZ_CONFIG_CATEGORIES = [
  { value: 'design', label: { en: 'Design' } },
  { value: 'technology', label: { en: 'Technology' } },
]
/** Item documents as stored: all published hold one category; one draft holds two; two drafts none. */
const TMZ_ITEMS = [
  { _id: 'i1', categories: ['technology'] },
  { _id: 'i2', categories: ['design'] },
  { _id: 'i3', categories: ['literature'] },
  { _id: 'drafts.c2c4fa97', categories: ['technology', 'literature'] },
  { _id: 'drafts.d1' },
  { _id: 'drafts.d2', categories: [] },
]

describe('triple dual-read (C1.9 R1)', () => {
  it('no document: identical to the Amendment J dual-read (terms win over the config list)', () => {
    const v = catalogueVocabulary({ taxonomy: null, categoryTerms: TMZ_CATEGORY_TERMS, tagTerms: TMZ_TAG_TERMS, configCategories: TMZ_CONFIG_CATEGORIES })
    expect(v.categorySource).toBe('terms')
    expect(v.categories).toEqual(catalogueCategoryVocabulary(TMZ_CATEGORY_TERMS, TMZ_CONFIG_CATEGORIES))
    expect(v.tags).toEqual(tagVocabulary(TMZ_TAG_TERMS))
    expect(v.tree.roots).toEqual(['technology', 'design', 'literature'])
  })
  it('no document and no terms: the config list comes back untouched (same object)', () => {
    const v = catalogueVocabulary({ taxonomy: undefined, categoryTerms: [], tagTerms: null, configCategories: TMZ_CONFIG_CATEGORIES })
    expect(v.categorySource).toBe('config')
    expect(v.categories).toBe(TMZ_CONFIG_CATEGORIES)
    expect(v.tags).toEqual([])
    expect(v.tree.roots).toEqual(['design', 'technology'])
  })
  it('guard/no-mixing: a document with the kind wins ENTIRELY — labels never merged', () => {
    const taxonomy = { categories: [{ key: 'technology', label: { en: 'Tech (doc)' }, order: 1000 }], tags: [{ key: 'new', label: { en: 'New' }, order: 1000 }] }
    const v = catalogueVocabulary({ taxonomy, categoryTerms: TMZ_CATEGORY_TERMS, tagTerms: TMZ_TAG_TERMS, configCategories: TMZ_CONFIG_CATEGORIES })
    expect(v.categorySource).toBe('document')
    expect(v.categories).toEqual([{ value: 'technology', label: { en: 'Tech (doc)' }, parentKey: null, archived: false }])
    expect(v.tagSource).toBe('document')
    expect((v.tags as { value: string }[]).map((t) => t.value)).toEqual(['new'])
  })
  it('per kind: a document without tags still reads tags from term records', () => {
    const v = catalogueVocabulary({ taxonomy: { categories: [], tags: null }, categoryTerms: TMZ_CATEGORY_TERMS, tagTerms: TMZ_TAG_TERMS, configCategories: [] })
    expect(v.categorySource).toBe('document')
    expect(v.categories).toEqual([]) // an empty array is "has the kind": deleted categories never resurrect
    expect(v.tagSource).toBe('terms')
    expect(v.tags).toHaveLength(7)
  })
  it('document entries are in tree order (pre-order) and carry their parent', () => {
    const taxonomy = {
      categories: [
        { key: 'pizza_bianche', parentKey: 'pizza', order: 2000, label: 'Bianche' },
        { key: 'beverages', order: 2000, label: 'Bevande' },
        { key: 'pizza', parentKey: 'food', order: 1000, label: 'Pizza' },
        { key: 'food', order: 1000, label: 'Cibo' },
        { key: 'pizza_classiche', parentKey: 'pizza', order: 1000, label: 'Classiche', archivedAt: '2026-01-01T00:00:00Z' },
      ],
    }
    const v = catalogueVocabulary({ taxonomy, configCategories: null })
    expect((v.categories as { value: string }[]).map((c) => c.value)).toEqual(['food', 'pizza', 'pizza_classiche', 'pizza_bianche', 'beverages'])
    expect((v.categories as { parentKey?: string | null; archived?: boolean }[])[2]).toMatchObject({ parentKey: 'pizza', archived: true })
  })
})

describe('stored shape readers', () => {
  it('rule/stored-shape (reader side): rows become complete rules through the commerce reader; an available row with no schedule is kept', () => {
    const rules = readCategoryChannelRules([
      { _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable', schedule: [{ _key: 's1', _type: 'catalogueWeeklyOverride', days: ['mon', 'tue'], from: '18:00', to: '23:00', state: 'available' }] },
      { _key: 'dine-in', _type: 'catalogueChannelRule', channel: 'dine-in', state: 'available' },
      { _key: 'bad', channel: 'bad', state: 'inherit' },
      // An identical duplicate collapses into one rule.
      { _key: 'dine-in', channel: 'dine-in', state: 'available' },
      // Two DIFFERENT rows for one channel leave the channel unset (D-21: never an arbitrary winner).
      { _key: 'takeaway', channel: 'takeaway', state: 'available' },
      { _key: 'takeaway', channel: 'takeaway', state: 'unavailable' },
      // An unknown day drops the override (it could turn "only Fridays" into "every day").
      { _key: 'pickup', channel: 'pickup', state: 'available', schedule: [{ _key: 'x', _type: 'catalogueWeeklyOverride', days: ['mon', 'xyz'], from: '10:00', to: '11:00', state: 'unavailable' }] },
    ])
    expect(rules[asChannelKey('delivery')]).toEqual({ state: 'unavailable', overrides: [{ kind: 'weekly', key: 's1', days: ['mon', 'tue'], from: '18:00', to: '23:00', state: 'available' }] })
    expect(rules[asChannelKey('dine-in')]).toEqual({ state: 'available', overrides: [] })
    expect(rules[asChannelKey('pickup')]).toEqual({ state: 'available', overrides: [] })
    expect(Object.keys(rules)).toEqual(['delivery', 'dine-in', 'pickup'])
  })
  it('unknown schedule member kinds are never evaluated (dropped by the reader)', () => {
    const rules = readCategoryChannelRules([{ channel: 'x', state: 'available', schedule: [{ _type: 'catalogueDatedOverride', state: 'unavailable' }] }])
    expect(rules[asChannelKey('x')]).toEqual({ state: 'available', overrides: [] })
  })
  it('nodes and tags are read tolerantly', () => {
    const nodes = readCategoryNodes([null, { key: '' }, { key: 'a', label: { en: 'A', _type: 'localizedString' }, order: 'x' }, { key: 'b', parentKey: 'a', order: 5 }])
    expect(nodes).toEqual([
      { key: 'a', label: { en: 'A' }, parentKey: null, order: 3000, channelRules: {}, defaultOptionListIds: [], archivedAt: null },
      { key: 'b', label: {}, parentKey: 'a', order: 5, channelRules: {}, defaultOptionListIds: [], archivedAt: null },
    ])
    expect(readTagNodes([{ key: 'b', order: 2 }, { key: 'a', order: 1 }, { key: 'a', order: 0 }]).map((t) => t.key)).toEqual(['a', 'b'])
  })
  it('the document id is deterministic and refuses an invalid slug', () => {
    expect(catalogueTaxonomyId('tmz')).toBe('catalogue-taxonomy.tmz')
    expect(() => catalogueTaxonomyId('a.b')).toThrow()
  })
})

describe('item assignment reader', () => {
  it('legacy items read through legacyCategoriesToAssignment', () => {
    expect(itemCategoryAssignment({ categories: ['technology', 'literature'] })).toEqual({ primary: 'technology', additional: ['literature'] })
    expect(itemCategoryAssignment({})).toEqual({ primary: null, additional: [] })
    expect(itemCategoryAssignment(null)).toEqual({ primary: null, additional: [] })
  })
  it('new fields win when either is present', () => {
    expect(itemCategoryAssignment({ primaryCategory: 'b', additionalCategories: ['c', 'b', 'c'], categories: ['a'] })).toEqual({ primary: 'b', additional: ['c'] })
    expect(itemCategoryAssignment({ additionalCategories: [], categories: ['a'] })).toEqual({ primary: null, additional: [] })
    expect(itemCategoryKeys({ primaryCategory: 'x' })).toEqual(['x'])
  })
  it('with a tree, the first EXISTING legacy category is primary (D-15)', () => {
    expect(itemCategoryAssignment({ categories: ['gone', 'literature'] }, buildTree(readCategoryNodes(TMZ_CATEGORY_TERMS)))).toEqual({ primary: 'literature', additional: [] })
  })
  it('migrate/tmz: tree = 3 roots; each item assignment set equals its legacy set; illustrated_boos preserved', () => {
    const v = catalogueVocabulary({ taxonomy: null, categoryTerms: TMZ_CATEGORY_TERMS, tagTerms: TMZ_TAG_TERMS, configCategories: TMZ_CONFIG_CATEGORIES })
    expect(v.tree.roots).toHaveLength(3)
    expect((v.tags as { value: string }[]).map((t) => t.value)).toContain('illustrated_boos')
    for (const item of TMZ_ITEMS) {
      const a = itemCategoryAssignment(item, v.tree)
      const set = new Set([...(a.primary ? [a.primary] : []), ...a.additional])
      expect(set).toEqual(new Set(item.categories ?? []))
      if (item.categories?.length) expect(a.primary).toBe(item.categories[0])
    }
    expect(itemCategoryAssignment(TMZ_ITEMS[3], v.tree)).toEqual({ primary: 'technology', additional: ['literature'] })
  })
})

// ── website readers: byte-identical for legacy data ─────────────────────────

const legacyRow = (extra: Partial<NonNullable<RawCatalogueConfigRow>> = {}): RawCatalogueConfigRow => ({
  catalogue: { currency: 'EUR', publicSegment: 'books', categories: [{ value: 'design', label: 'Design' }] },
  categoryTerms: [
    { key: 'technology', order: 1000, label: 'Tecnologia' },
    { key: 'literature', order: 3000, label: 'Letteratura' },
  ],
  tagTerms: [{ key: 'memoir', order: 1000, label: 'Memorie' }],
  timeZone: 'Europe/Rome',
  ...extra,
})

describe('website readers (R1: legacy output unchanged)', () => {
  it('resolveCatalogueConfig: an absent/null taxonomy document changes nothing (byte-equal)', () => {
    const before = resolveCatalogueConfig(legacyRow(), 'it', 'en')
    expect(JSON.stringify(resolveCatalogueConfig(legacyRow({ taxonomy: null }), 'it', 'en'))).toBe(JSON.stringify(before))
    expect(JSON.stringify(before!.categories)).toBe(JSON.stringify([
      { value: 'technology', label: 'Tecnologia', color: null },
      { value: 'literature', label: 'Letteratura', color: null },
    ]))
  })
  it('resolveItem: legacy categories resolve in stored order, as before', () => {
    const config = resolveCatalogueConfig(legacyRow(), 'it', 'en')!
    const item = resolveItem({ name: 'Book', visibility: 'public', categories: ['literature', 'technology', 'gone'] }, { locale: 'it', defaultLocale: 'en', config, now: new Date('2026-11-02T10:00:00Z') })!
    expect(item.categories).toEqual([
      { value: 'literature', label: 'Letteratura', color: null },
      { value: 'technology', label: 'Tecnologia', color: null },
    ])
    expect(itemCategoryFilterKeys(item)).toEqual(['literature', 'technology'])
  })
  it('a hierarchical document: data-cats carry ancestor keys, the filter bar offers top-level categories', () => {
    const config = resolveCatalogueConfig(
      legacyRow({
        taxonomy: {
          categories: [
            { key: 'food', order: 1000, label: 'Cibo' },
            { key: 'pizza', parentKey: 'food', order: 1000, label: 'Pizza' },
            { key: 'pizza_bianche', parentKey: 'pizza', order: 1000, label: 'Bianche' },
            { key: 'beverages', order: 2000, label: 'Bevande' },
          ],
        },
      }),
      'it',
      'en',
    )!
    expect(config.categories.map((c) => c.value)).toEqual(['food', 'pizza', 'pizza_bianche', 'beverages'])
    expect(config.categories[0].ancestors).toBeUndefined()
    expect(config.categories[2].ancestors).toEqual([{ value: 'food', label: 'Cibo' }, { value: 'pizza', label: 'Pizza' }])
    const ctx = { locale: 'it', defaultLocale: 'en', config, now: new Date('2026-11-02T10:00:00Z') }
    const bianca = resolveItem({ name: 'Bianca', visibility: 'public', primaryCategory: 'pizza_bianche', categories: ['beverages'] }, ctx)!
    const water = resolveItem({ name: 'Acqua', visibility: 'public', categories: ['beverages'] }, ctx)!
    // Same set as expandForFilter over the document's tree.
    const tree = buildTree(readCategoryNodes([{ key: 'food' }, { key: 'pizza', parentKey: 'food' }, { key: 'pizza_bianche', parentKey: 'pizza' }]))
    expect(new Set(itemCategoryFilterKeys(bianca))).toEqual(expandForFilter(tree, { primary: 'pizza_bianche', additional: [] }))
    const collection = { sections: [{ key: 's', name: 'S', children: [], items: [bianca, water] }] } as unknown as CatalogueCollectionDTO
    expect(collectionFilterCategories(collection)).toEqual([
      { value: 'food', label: 'Cibo' },
      { value: 'beverages', label: 'Bevande' },
    ])
  })
  it('flat legacy collection filter is unchanged (first appearance, ≥ 2 categories)', () => {
    const config = resolveCatalogueConfig(legacyRow(), 'it', 'en')!
    const ctx = { locale: 'it', defaultLocale: 'en', config, now: new Date('2026-11-02T10:00:00Z') }
    const a = resolveItem({ name: 'A', visibility: 'public', categories: ['literature'] }, ctx)!
    const b = resolveItem({ name: 'B', visibility: 'public', categories: ['technology', 'literature'] }, ctx)!
    const collection = { sections: [{ key: 's', name: 'S', children: [], items: [a, b] }] } as unknown as CatalogueCollectionDTO
    expect(collectionFilterCategories(collection)).toEqual([
      { value: 'literature', label: 'Letteratura' },
      { value: 'technology', label: 'Tecnologia' },
    ])
  })
})

// ── GROQ (groq-js) ───────────────────────────────────────────────────────────

const dataset = [
  { _id: 'p1', _type: 'project', projectSlug: 'a', moduleInstallations: [{ moduleId: 'catalogue', enabled: true, config: { currency: 'EUR', categories: [{ value: 'old', label: { en: 'Old' } }] } }] },
  { _id: 'siteConfig-a', _type: 'siteConfig', projectSlug: 'a', defaultLocale: 'en', supportedLocales: ['en', 'it'] },
  { _id: 'catalogue-taxonomy.a', _type: 'catalogueTaxonomy', projectSlug: 'a', categories: [{ _key: 'food', key: 'food', label: { en: 'Food', it: 'Cibo' }, order: 1000 }, { _key: 'pizza', key: 'pizza', parentKey: 'food', label: { en: 'Pizza' }, order: 1000, channelRules: [{ _key: 'delivery', channel: 'delivery', state: 'available' }] }] },
  // A lookalike in another project must never leak in.
  { _id: 'catalogue-taxonomy.b', _type: 'catalogueTaxonomy', projectSlug: 'b', categories: [{ _key: 'x', key: 'x', label: { en: 'X' } }] },
  { _id: 'item-1', _type: 'catalogueItem', projectSlug: 'a', categories: ['food'], primaryCategory: 'pizza', additionalCategories: [] },
]
const run = async (q: string, params: Record<string, unknown>) => (await evaluate(parse(q), { dataset, params })).get()

describe('GROQ', () => {
  it('catalogueTaxonomyGroq returns the project document only, and null members for a missing kind', async () => {
    // (groq-js does not evaluate `label[$locale]` attribute access; the locale chain itself is the existing loc() pattern.)
    const r = (await run(`{ "t": ${catalogueTaxonomyGroq('label.it')} }`, { projectSlug: 'a' })) as { t: { categories: { key: string; label: string }[]; tags: unknown } }
    expect(r.t.categories.map((c) => [c.key, c.label])).toEqual([['food', 'Cibo'], ['pizza', null]])
    expect(r.t.tags).toBeNull()
    expect(((await run(`{ "t": ${catalogueTaxonomyGroq('label')} }`, { projectSlug: 'zzz' })) as { t: unknown }).t).toBeNull()
  })
  it('the website config query carries the document and resolves through catalogueVocabulary', async () => {
    const row = (await run(catalogueModuleConfigQuery, { projectSlug: 'a', locale: 'en', defaultLocale: 'en' })) as RawCatalogueConfigRow
    const config = resolveCatalogueConfig(row, 'en', 'en')!
    // The document wins over the config list ("old"); pizza sits under food.
    expect(config.categories.map((c) => [c.value, c.label])).toEqual([['food', 'Food'], ['pizza', 'Pizza']])
    expect(config.categories[1].ancestors).toEqual([{ value: 'food', label: 'Food' }])
  })
  it('the dashboard site query carries the document; the list query projects the new item fields', async () => {
    const site = (await run(CATALOGUE_SITE_QUERY, { projectSlug: 'a' })) as { taxonomy: { categories: { key: string; label: unknown }[] } }
    expect(site.taxonomy.categories[0]).toMatchObject({ key: 'food', label: { en: 'Food', it: 'Cibo' } })
    const list = (await run(CATALOGUE_DASHBOARD_LIST_QUERY, { projectSlug: 'a' })) as { items: Record<string, unknown>[] }
    expect(list.items[0]).toMatchObject({ categories: ['food'], primaryCategory: 'pizza', additionalCategories: [] })
    expect(itemCategoryKeys(list.items[0])).toEqual(['pizza'])
  })
  it('legacyCategoriesToAssignment is the reader for items without the new fields (no tree needed)', () => {
    expect(legacyCategoriesToAssignment(['a', 'b'])).toEqual({ primary: 'a', additional: ['b'] })
  })
})
