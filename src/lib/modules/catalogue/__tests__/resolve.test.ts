import { describe, it, expect } from 'vitest'
import {
  asResolverOffers,
  formatPrice,
  resolveCatalogueConfig,
  resolveCollection,
  resolveItem,
  resolveItemPage,
  slugsOf,
  type CatalogueResolveContext,
  type RawCatalogueCollection,
  type RawCatalogueItem,
} from '../resolve'
import { resolveOffer } from '../offers'
import * as queries from '@/lib/sanity/queries'
import * as sitemapQueries from '@/lib/seo/sitemap-queries'
import type { CatalogueConfigDTO, CatalogueSectionDTO } from '../dto'

const NOW = new Date('2026-10-16T19:00:00Z') // Friday 21:00 in Rome

const config: CatalogueConfigDTO = {
  currency: 'EUR',
  segment: 'menu',
  segmentHistory: [],
  showPricesByDefault: true,
  channels: [
    { value: 'dine-in', label: 'In sala', color: null },
    { value: 'takeaway', label: 'Asporto', color: null },
  ],
  categories: [{ value: 'pizza', label: 'Pizza', color: '#c00' }],
  dietaryTags: [{ value: 'veg', label: 'Vegetariano', color: null }],
  timeZone: 'Europe/Rome',
}

const ctx = (over: Partial<CatalogueResolveContext> = {}): CatalogueResolveContext => ({
  locale: 'it',
  defaultLocale: 'it',
  config,
  now: NOW,
  ...over,
})

const item = (over: Partial<RawCatalogueItem> = {}): RawCatalogueItem => ({
  _id: 'catalogueItem-livener-margherita',
  publicId: '9f1c0b4e-0000-4000-8000-000000000001',
  itemType: 'dish',
  visibility: 'public',
  hasPage: false,
  name: 'Margherita',
  offers: [{ _key: 'o1', price: 8.5 }],
  ...over,
})

function flatten(sections: CatalogueSectionDTO[]): CatalogueSectionDTO[] {
  return sections.flatMap((s) => [s, ...flatten(s.children)])
}

describe('effectiveCurrency — ADR-033 D7 / A6 (AC 20)', () => {
  it('is the project currency and ignores offer.currency even when set', () => {
    const dto = resolveItem(item({ offers: [{ _key: 'o1', price: 9.5, currency: 'USD' }] }), ctx({ config: { ...config, currency: 'CHF' } }))!
    expect(dto.offers[0].effectiveCurrency).toBe('CHF')
    expect(dto.offers[0].formattedPrice).toContain('CHF')
    expect(JSON.stringify(dto)).not.toContain('USD')
  })

  it('the catalogue queries never project the reserved offer fields', () => {
    for (const q of [queries.catalogueItemBySlugQuery, queries.catalogueCollectionBySlugQuery, queries.catalogueCollectionByIdQuery]) {
      expect(q).not.toMatch(/\bcurrency\b/)
      expect(q).not.toMatch(/\blocationKey\b/)
    }
  })

  it('feeds resolveOffer with the precedence intact', () => {
    const dto = resolveItem(
      item({ offers: [{ _key: 'any', price: 9 }, { _key: 'ta', channel: 'takeaway', price: 7 }] }),
      ctx(),
    )!
    const r = resolveOffer(asResolverOffers(dto.offers), 'takeaway', NOW, 'Europe/Rome', { currency: config.currency })
    expect(r.kind === 'offer' && r.offer._key).toBe('ta')
    expect(dto.offers[1].channelLabel).toBe('Asporto')
    expect(dto.offers[0].channel).toBeNull()
  })
})

describe('prices', () => {
  it('price 0 is kept as a free-able value, not dropped', () => {
    const dto = resolveItem(item({ offers: [{ _key: 'o1', price: 0 }] }), ctx({ locale: 'en' }))!
    expect(dto.offers).toHaveLength(1)
    expect(dto.offers[0].price).toBe(0)
    expect(dto.offers[0].isFree).toBe(true)
    expect(dto.offers[0].formattedPrice.replace(/\s/g, ' ')).toBe('€0')
    expect(dto.hasOffers).toBe(true)
  })

  it('formats for the request locale with Intl.NumberFormat', () => {
    const n = (s: string) => s.replace(/\s/g, ' ')
    expect(n(formatPrice(8.5, 'EUR', 'en'))).toBe('€8.50')
    expect(n(formatPrice(8.5, 'EUR', 'it'))).toBe('8,50 €')
    expect(n(formatPrice(8, 'EUR', 'en'))).toBe('€8')
    expect(n(formatPrice(1.5, 'EUR', 'en', { signed: true }))).toBe('+€1.50')
    expect(formatPrice(3, 'NOPE', 'en')).toBe('3 NOPE')
  })

  it('drops an invalid (negative / missing) price rather than rendering it', () => {
    const dto = resolveItem(item({ offers: [{ _key: 'a', price: -1 }, { _key: 'b', price: null }] }), ctx())!
    expect(dto.offers).toEqual([])
  })

  it('evaluates serving hours in the site zone; null when no zone is configured', () => {
    const offers = [{ _key: 'lunch', price: 10, availability: [{ from: '12:00', to: '15:00' }] }]
    expect(resolveItem(item({ offers }), ctx())!.offers[0].state).toBe('outOfHours')
    expect(resolveItem(item({ offers }), ctx({ config: { ...config, timeZone: null } }))!.offers[0].state).toBeNull()
  })
})

describe('collection tree — ADR-033 A7, AC 18–20d', () => {
  const coll = (sections: RawCatalogueCollection['sections']): RawCatalogueCollection => ({
    _id: 'catalogueCollection-livener-menu',
    publicId: 'c0ffee00-0000-4000-8000-000000000002',
    collectionType: 'menu',
    name: 'Menu',
    sections,
  })

  it('renders an orphan as a recovery root, with its descendants, and reports it', () => {
    const dto = resolveCollection(
      coll([
        { _key: 'pizza', name: 'Pizza', items: [item()] },
        { _key: 'orphan', parentKey: 'deleted', name: 'Bianche', items: [item({ name: 'Bianca' })] },
        { _key: 'child', parentKey: 'orphan', name: 'Speciali' },
      ]),
      ctx(),
    )!
    expect(dto.sections.map((s) => s.key)).toEqual(['pizza', 'orphan'])
    const orphan = dto.sections[1]
    expect(orphan.recovered).toBe(true)
    expect(orphan.parentKey).toBe('deleted') // as stored — never rewritten
    expect(orphan.children.map((c) => c.key)).toEqual(['child'])
    expect(orphan.items.map((i) => i.name)).toEqual(['Bianca'])
    expect(dto.issues).toContainEqual({ kind: 'missingParent', key: 'orphan', parentKey: 'deleted' })
  })

  it('keeps a parent with no items of its own (AC 19), children in stored order (AC 18)', () => {
    const dto = resolveCollection(
      coll([
        { _key: 'pizza', name: 'Pizza', items: [] },
        { _key: 'classiche', parentKey: 'pizza', name: 'Classiche', items: [item()] },
        { _key: 'bianche', parentKey: 'pizza', name: 'Bianche', items: [item({ name: 'Bianca' })] },
      ]),
      ctx(),
    )!
    expect(dto.sections).toHaveLength(1)
    expect(dto.sections[0].items).toEqual([])
    expect(dto.sections[0].children.map((c) => [c.key, c.depth])).toEqual([
      ['classiche', 1],
      ['bianche', 1],
    ])
    expect(dto.issues).toEqual([])
    expect(dto.hasOffers).toBe(true)
  })

  it('renders every section of a cycle without looping', () => {
    const dto = resolveCollection(
      coll([
        { _key: 'a', parentKey: 'b', name: 'A' },
        { _key: 'b', parentKey: 'a', name: 'B' },
      ]),
      ctx(),
    )!
    expect(flatten(dto.sections).map((s) => s.key).sort()).toEqual(['a', 'b'])
    expect(dto.issues).toContainEqual({ kind: 'cycle', keys: ['a', 'b'] })
  })

  it('drops a hidden (archived / scheduled / expired) or dangling referenced item, keeps the section', () => {
    const dto = resolveCollection(
      coll([
        {
          _key: 's',
          name: 'Pizza',
          items: [
            item({ name: 'Archived', archivedAt: '2026-10-01T00:00:00Z' }),
            item({ name: 'Scheduled', publishedAt: '2027-01-01T00:00:00Z' }),
            item({ name: 'Expired', expiresAt: '2026-10-01T00:00:00Z' }),
            null,
            item({ name: 'Live' }),
          ],
        },
      ]),
      ctx(),
    )!
    expect(dto.sections[0].items.map((i) => i.name)).toEqual(['Live'])
  })

  it('a non-public collection resolves to null', () => {
    expect(resolveCollection({ ...coll([]), archivedAt: '2026-10-01T00:00:00Z' }, ctx())).toBeNull()
  })

  it('defaults collectionType to list (B2)', () => {
    expect(resolveCollection({ ...coll([]), collectionType: null }, ctx())!.collectionType).toBe('list')
  })
})

describe('localization — AC 22, 23', () => {
  it('falls back requested → site default → en for names, never to an empty string', () => {
    const name = { _type: 'localizedString', it: 'Margherita', en: 'Margherita (en)', de: '' }
    expect(resolveItem(item({ name }), ctx({ locale: 'de', defaultLocale: 'it' }))!.name).toBe('Margherita')
    expect(resolveItem(item({ name: { en: 'Only English' } }), ctx({ locale: 'de', defaultLocale: 'it' }))!.name).toBe('Only English')
    expect(resolveItem(item({ name: { de: 'Deutsch', it: 'Italiano' } }), ctx({ locale: 'de' }))!.name).toBe('Deutsch')
  })

  it('the queries resolve content with the same chain and never project translationStatus', () => {
    expect(queries.catalogueItemBySlugQuery).toContain('coalesce(name[$locale], name[$defaultLocale], name.en')
    for (const q of [
      queries.catalogueItemBySlugQuery,
      queries.catalogueCollectionBySlugQuery,
      queries.catalogueCollectionByIdQuery,
      queries.cataloguePageQuery,
      queries.catalogueModuleConfigQuery,
    ]) expect(q).not.toContain('translationStatus')
  })

  it('slug lookups have no locale fallback and require hasPage', () => {
    expect(queries.catalogueItemBySlugQuery).toContain('slug[$locale].current == $slug')
    expect(queries.catalogueItemBySlugQuery).toContain('hasPage == true')
    expect(queries.catalogueCollectionBySlugQuery).toContain('slug[$locale].current == $slug')
    expect(queries.catalogueItemBySlugQuery).not.toMatch(/coalesce\(slug/)
  })
})

describe('pages and identity — AC 13, 14, ADR-031 D3', () => {
  it('no page without hasPage; with it, the canonical slug map of set locales only', () => {
    const slugMap = { _type: 'localizedSlug', it: { _type: 'slug', current: 'margherita' }, en: { _type: 'slug', current: 'margherita-pizza' }, de: { current: '' } }
    expect(resolveItem(item({ slugMap }), ctx())!.page).toBeNull()
    const dto = resolveItem(item({ hasPage: true, slugMap }), ctx({ locale: 'de' }))!
    expect(dto.page).toEqual({ slug: null, slugs: { it: 'margherita', en: 'margherita-pizza' } })
    expect(slugsOf(slugMap)).toEqual({ it: 'margherita', en: 'margherita-pizza' })
  })

  it('resolveItemPage requires a page', () => {
    expect(resolveItemPage(item(), ctx())).toBeNull()
    const page = resolveItemPage({ ...item({ hasPage: true, slugMap: { it: { current: 'm' } } }), body: [] }, ctx())!
    expect(page.page.slug).toBe('m')
    expect(page.body).toBeNull()
  })

  it('never leaks a Sanity _id into the DTO', () => {
    const raw = resolveCollection(
      {
        _id: 'catalogueCollection-livener-menu',
        publicId: 'pub-coll',
        name: 'Menu',
        sections: [{ _key: 's', name: 'S', items: [item({ hasPage: true, slugMap: { it: { current: 'm' } } })] }],
      },
      ctx(),
    )
    const json = JSON.stringify(raw)
    expect(json).not.toContain('"_id"')
    expect(json).not.toContain('catalogueCollection-livener-menu')
    expect(json).not.toContain('catalogueItem-livener-margherita')
    expect(json).toContain('pub-coll')
    for (const q of [queries.catalogueItemBySlugQuery, queries.catalogueCollectionBySlugQuery, queries.catalogueCollectionByIdQuery]) {
      expect(q).not.toMatch(/\b_id\s*,/)
    }
  })

  it('maps vocabulary keys to labels and orders allergens by Annex II', () => {
    const dto = resolveItem(item({ categories: ['pizza', 'gone'], dietary: ['veg'], allergens: ['milk', 'gluten', 'bogus', 'milk'] }), ctx())!
    expect(dto.categories).toEqual([{ value: 'pizza', label: 'Pizza', color: '#c00' }])
    expect(dto.dietary.map((d) => d.label)).toEqual(['Vegetariano'])
    expect(dto.allergens).toEqual(['gluten', 'milk'])
  })

  it('option lists: min/max from the attachment, signed deltas, missing lists skipped', () => {
    const dto = resolveItem(
      item({
        optionLists: [
          { _key: 'att', min: 1, max: 2, list: { name: 'Extra', options: [{ _key: 'x', label: 'Mozzarella', kind: 'add', priceDelta: 1.5 }, { _key: 'y', label: 'Senza', kind: 'remove', priceDelta: 0 }] } },
          { _key: 'gone', list: null },
        ],
      }),
      ctx({ locale: 'en' }),
    )!
    expect(dto.optionLists).toHaveLength(1)
    expect(dto.optionLists[0]).toMatchObject({ key: 'att', min: 1, max: 2, name: 'Extra' })
    expect(dto.optionLists[0].options[0].formattedDelta).toBe('+€1.50')
    expect(dto.optionLists[0].options[1]).toMatchObject({ kind: 'remove', formattedDelta: null })
  })
})

describe('config', () => {
  it('null when the module is not installed', () => {
    expect(resolveCatalogueConfig({ catalogue: null, timeZone: 'Europe/Rome' }, 'it')).toBeNull()
  })

  it('normalises segment and history, resolves labels, keeps the site zone', () => {
    const c = resolveCatalogueConfig(
      {
        catalogue: {
          currency: 'chf',
          publicSegment: 'Menu',
          publicSegmentHistory: ['carta', 'menu', 'carta'],
          serviceChannels: [{ value: 'dine-in', label: { it: 'In sala', en: 'Dine-in' } }],
        },
        timeZone: 'Europe/Zurich',
      },
      'en',
      'it',
    )!
    expect(c).toMatchObject({ currency: 'CHF', segment: 'menu', segmentHistory: ['carta'], timeZone: 'Europe/Zurich', showPricesByDefault: true })
    expect(c.channels).toEqual([{ value: 'dine-in', label: 'Dine-in', color: null }])
  })
})

describe('sitemap (spec §6.5, AC 16, B4)', () => {
  it('lists only items/collections with a page, public and not unlisted', () => {
    for (const q of [sitemapQueries.SITEMAP_CATALOGUE_ITEMS_QUERY, sitemapQueries.SITEMAP_CATALOGUE_COLLECTIONS_QUERY]) {
      expect(q).toContain('hasPage == true')
      expect(q).toContain('visibility != "unlisted"')
      expect(q).toContain('[defined(segment)]')
    }
  })
})
