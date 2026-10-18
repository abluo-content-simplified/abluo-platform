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
import { visibilityFilter } from '../visibility'

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
  tags: [{ value: 'gift', label: 'Regalo', color: null }],
  dietaryTags: [{ value: 'veg', label: 'Vegetariano', color: null }],
  timeZone: 'Europe/Rome',
  affiliateDisclosure: null,
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
  itemProfile: 'foodOrDrink',
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

  it('maps vocabulary keys to labels and orders allergens by Annex II (D-3 declaration)', () => {
    const dto = resolveItem(
      item({ categories: ['pizza', 'gone'], dietary: ['veg'], allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten', 'milk'], mayContain: ['sesame', 'eggs'], note: 'Forno condiviso' } }),
      ctx()
    )!
    expect(dto.categories).toEqual([{ value: 'pizza', label: 'Pizza', color: '#c00' }])
    expect(dto.dietary.map((d) => d.label)).toEqual(['Vegetariano'])
    expect(dto.allergenDeclaration).toEqual({ status: 'containsListedAllergens', allergens: ['gluten', 'milk'], mayContain: ['eggs', 'sesame'], note: 'Forno condiviso' })
  })

  it('resolves tag labels, drops unknown tag keys, and keeps the stored order (Amendment J slice 7)', () => {
    const c = { ...config, tags: [{ value: 'gift', label: 'Regalo', color: null }, { value: 'rare', label: 'Raro', color: null }] }
    const dto = resolveItem(item({ tags: ['rare', 'gone', 'gift', 'rare'] }), ctx({ config: c }))!
    expect(dto.tags.map((t) => t.label)).toEqual(['Raro', 'Regalo'])
    expect(resolveItem(item({}), ctx({ config: c }))!.tags).toEqual([])
  })

  it('tag terms: labels fall back to the key when a term has no label (config row)', () => {
    const cfg = resolveCatalogueConfig({ catalogue: { currency: 'EUR' }, tagTerms: [{ key: 'gift', order: 1, label: null }, { key: 'rare', order: 2, label: 'Raro' }] } as never, 'it', 'it')!
    expect(cfg.tags).toEqual([{ value: 'gift', label: 'gift', color: null }, { value: 'rare', label: 'Raro', color: null }])
    expect(resolveCatalogueConfig({ catalogue: { currency: 'EUR' } } as never, 'it', 'it')!.tags).toEqual([])
  })

  describe('allergen declaration (ADR-033 D-3)', () => {
    const decl = (allergenDeclaration: RawCatalogueItem['allergenDeclaration'], over: Partial<RawCatalogueItem> = {}) => resolveItem(item({ allergenDeclaration, ...over }), ctx())!.allergenDeclaration
    it('is null for products and services — nothing to render', () => {
      expect(decl({ status: 'noneDeclared', confirmed: true }, { itemProfile: 'product' })).toBeNull()
      expect(decl({ status: 'containsListedAllergens', allergens: ['milk'] }, { itemProfile: 'service' })).toBeNull()
    })
    it('none declared needs the explicit confirmation', () => {
      expect(decl({ status: 'noneDeclared', confirmed: true })).toEqual({ status: 'noneDeclared', mayContain: [], note: null })
      // E-1: "may contain" survives on none-declared, in Annex II order.
      expect(decl({ status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts', 'gluten'] })).toEqual({ status: 'noneDeclared', mayContain: ['gluten', 'treeNuts'], note: null })
      expect(decl({ status: 'noneDeclared' })).toEqual({ status: 'notReviewed' })
    })
    it('never infers: missing, unreviewed, empty "contains" or unknown keys resolve to notReviewed', () => {
      expect(decl(undefined)).toEqual({ status: 'notReviewed' })
      expect(decl({ status: 'notReviewed' })).toEqual({ status: 'notReviewed' })
      expect(decl({ status: 'containsListedAllergens', allergens: [] })).toEqual({ status: 'notReviewed' })
      expect(decl({ status: 'containsListedAllergens', allergens: ['milk', 'bogus'] })).toEqual({ status: 'notReviewed' })
      expect(decl({ status: 'allergenFree' as never })).toEqual({ status: 'notReviewed' })
    })
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

describe('config categories: term records vs the config list (Amendment J dual-read)', () => {
  const list = [
    { value: 'pizza', label: { it: 'Pizze', en: 'Pizzas' }, color: '#c00' },
    { value: 'dolci', label: { it: 'Dolci' } },
  ]
  // GROQ resolves the label for the request locale in both queries; mirror that here.
  const resolved = (l: 'it' | 'en') => list.map((e) => ({ value: e.value, color: (e as { color?: string }).color, label: (e.label as Record<string, string>)[l] ?? e.label.it }))
  const asTerms = (l: 'it' | 'en') => list.map((e, i) => ({ key: e.value, order: (i + 1) * 1000, color: (e as { color?: string }).color, label: (e.label as Record<string, string>)[l] ?? e.label.it }))
  const cfg = (row: object, l: 'it' | 'en') => resolveCatalogueConfig({ timeZone: 'Europe/Rome', ...row } as never, l, 'it')!

  it('identical keys and labels give an identical config and identical item categories', () => {
    for (const l of ['it', 'en'] as const) {
      const viaList = cfg({ catalogue: { categories: resolved(l) } }, l)
      const viaTerms = cfg({ catalogue: { categories: resolved(l) }, categoryTerms: asTerms(l) }, l)
      const viaTermsOnly = cfg({ catalogue: {}, categoryTerms: asTerms(l) }, l)
      expect(viaTerms.categories).toEqual(viaList.categories)
      expect(viaTermsOnly.categories).toEqual(viaList.categories)
    }
  })
  it('terms win entirely when both exist; the list is used when there are none', () => {
    const c = cfg({ catalogue: { categories: resolved('it') }, categoryTerms: [{ key: 'romanzi', order: 1, label: 'Romanzi' }] }, 'it')
    expect(c.categories).toEqual([{ value: 'romanzi', label: 'Romanzi', color: null }])
    expect(cfg({ catalogue: { categories: resolved('it') }, categoryTerms: [] }, 'it').categories.map((t) => t.value)).toEqual(['pizza', 'dolci'])
  })
  it('a label missing for the locale falls back to the key', () => {
    expect(cfg({ catalogue: {}, categoryTerms: [{ key: 'x', order: 1, label: null }] }, 'it').categories).toEqual([{ value: 'x', label: 'x', color: null }])
  })
})

describe('sitemap (spec §6.5, AC 16, B4)', () => {
  it('lists only items/collections with a page, public and not unlisted', () => {
    for (const q of [sitemapQueries.SITEMAP_CATALOGUE_ITEMS_QUERY, sitemapQueries.SITEMAP_CATALOGUE_COLLECTIONS_QUERY]) {
      expect(q).toContain('hasPage == true')
      expect(q).toContain(visibilityFilter('sitemap'))
      expect(q).toContain('[defined(segment)]')
    }
  })
})

describe('option choice allergens (ADR-033 D-3a)', () => {
  const withList = (options: unknown[], over: Partial<RawCatalogueItem> = {}) =>
    resolveItem(item({ optionLists: [{ _key: 'att', list: { name: 'Extra', options: options as never } }], ...over }), ctx())!.optionLists[0].options.map((o) => o.allergenDeclaration)
  it('free-text add → its own (no note, Annex II order); remove → null; unreviewed / invalid → notReviewed', () => {
    expect(
      withList([
        { _key: 'a', label: 'Mozzarella', kind: 'add', allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten'], mayContain: ['sesame'] } },
        { _key: 'b', label: 'Senza', kind: 'remove', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
        { _key: 'c', label: 'X', kind: 'add' },
        { _key: 'd', label: 'Y', kind: 'add', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
        { _key: 'e', label: 'Z', kind: 'add', allergenDeclaration: { status: 'noneDeclared' } },
      ])
    ).toEqual([
      { status: 'containsListedAllergens', allergens: ['gluten', 'milk'], mayContain: ['sesame'] },
      null,
      { status: 'notReviewed' },
      { status: 'noneDeclared', mayContain: [] },
      { status: 'notReviewed' },
    ])
  })
  it('a linked choice derives from its item; a hidden linked item is notReviewed (never guessed); a non-food linked item → null', () => {
    expect(
      withList([
        { _key: 'a', label: 'Patatine', kind: 'add', linked: true, item: { name: 'Patatine', itemProfile: 'foodOrDrink', allergenDeclaration: { status: 'containsListedAllergens', allergens: ['celery'], note: 'n' } }, allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
        { _key: 'b', label: 'Hidden', kind: 'add', linked: true, item: null },
        { _key: 'c', label: 'Libro', kind: 'add', linked: true, item: { name: 'Libro', itemProfile: 'product' } },
      ])
    ).toEqual([{ status: 'containsListedAllergens', allergens: ['celery'], mayContain: [] }, { status: 'notReviewed' }, null])
  })
  it('on a product or service item no choice carries a declaration', () => {
    expect(withList([{ _key: 'a', label: 'X', kind: 'add', allergenDeclaration: { status: 'noneDeclared', confirmed: true } }], { itemProfile: 'product' })).toEqual([null])
  })
  it('the option projection carries what the derivation needs', () => {
    expect(queries.catalogueItemBySlugQuery).toContain('"linked": defined(item._ref)')
    expect(queries.catalogueItemBySlugQuery).toMatch(/allergenDeclaration \{ status, allergens, mayContain, confirmed \}/)
  })
})

describe('byline and links — ADR-033 Amendment F', () => {
  it('byline: locale-resolved string or raw object with the default-locale fallback; null when empty', () => {
    expect(resolveItem(item({ byline: 'Herbert' }), ctx())!.byline).toBe('Herbert')
    expect(resolveItem(item({ byline: { it: 'Autore', en: 'Author' } }), ctx({ locale: 'de' }))!.byline).toBe('Autore')
    expect(resolveItem(item({ byline: { en: 'Author' } }), ctx({ locale: 'it', defaultLocale: 'it' }))!.byline).toBe('Author')
    expect(resolveItem(item({ byline: '   ' }), ctx())!.byline).toBeNull()
    expect(resolveItem(item(), ctx())!.byline).toBeNull()
  })

  it('links: keep order, fall back to the default-locale label, drop unsafe or label-less entries', () => {
    const dto = resolveItem(
      item({
        links: [
          { _key: 'a', label: { it: 'Editore', en: 'Publisher' }, url: ' https://example.com/a ' },
          { _key: 'b', label: { en: 'English only' }, url: 'http://example.com/b' },
          { _key: 'c', label: 'Evil', url: 'javascript:alert(1)' },
          { _key: 'd', label: 'Data', url: 'data:text/html,x' },
          { _key: 'e', label: 'Mail', url: 'mailto:a@b.it' },
          { _key: 'f', label: 'Relative', url: '/menu' },
          { _key: 'g', label: '', url: 'https://example.com/g' },
          null,
        ],
      }),
      ctx({ locale: 'de', defaultLocale: 'it' }),
    )!
    expect(dto.links).toEqual([
      { key: 'a', label: 'Editore', url: 'https://example.com/a', kind: 'info', affiliate: false },
      { key: 'b', label: 'English only', url: 'http://example.com/b', kind: 'info', affiliate: false },
    ])
    expect(resolveItem(item(), ctx())!.links).toEqual([])
  })

  it('Amendment K: a link without kind is info; buy / affiliate are read; unknown kinds and a stray affiliate flag are info; a buy link needs no label', () => {
    const dto = resolveItem(
      item({
        links: [
          { _key: 'a', label: 'Old', url: 'https://example.com/a' },
          { _key: 'b', label: 'Buy it', url: 'https://example.com/b', kind: 'buy', affiliate: true },
          { _key: 'c', label: 'Plain buy', url: 'https://example.com/c', kind: 'buy' },
          { _key: 'd', label: 'Odd', url: 'https://example.com/d', kind: 'sponsored', affiliate: true },
          { _key: 'e', label: 'Info flagged', url: 'https://example.com/e', kind: 'info', affiliate: true },
          { _key: 'f', url: 'https://example.com/f', kind: 'buy', affiliate: true },
          { _key: 'g', url: 'https://example.com/g' },
        ],
      }),
      ctx(),
    )!
    expect(dto.links.map((l) => [l.key, l.kind, l.affiliate, l.label])).toEqual([
      ['a', 'info', false, 'Old'],
      ['b', 'buy', true, 'Buy it'],
      ['c', 'buy', false, 'Plain buy'],
      ['d', 'info', false, 'Odd'],
      ['e', 'info', false, 'Info flagged'],
      ['f', 'buy', true, ''],
    ])
  })

  it('Amendment K: the publisher is read (trimmed), alone it keeps the details, and the query projects kind, affiliate and publisher', () => {
    const b = (bookDetails: object) => resolveItem(item({ itemProfile: 'book', offers: [], bookDetails }), ctx())!.bookDetails
    expect(b({ publisher: '  Pan   Books ' })).toEqual({ author: null, publisher: 'Pan Books', year: null, isbn: null })
    expect(b({ author: 'A' })).toEqual({ author: 'A', publisher: null, year: null, isbn: null })
    expect(b({ publisher: 7 })).toBeNull()
    for (const q of [queries.catalogueItemBySlugQuery, queries.catalogueCollectionBySlugQuery, queries.catalogueCollectionByIdQuery]) {
      expect(q).toContain('bookDetails { author, publisher, year, isbn }')
      expect(q).toMatch(/links\[\] \{ _key, "label": [^}]*url, kind, affiliate, moreUrls \}/)
    }
  })

  it('Amendment K: the config carries the affiliate disclosure of the request locale, blank = null', () => {
    const c = (affiliateDisclosure: unknown) => resolveCatalogueConfig({ catalogue: { publicSegment: 'books', affiliateDisclosure } as never }, 'it', 'it')!.affiliateDisclosure
    expect(c('  Link di affiliazione.  ')).toBe('Link di affiliazione.')
    expect(c('   ')).toBeNull()
    expect(c(undefined)).toBeNull()
  })

  it('the item queries project byline and links with a per-locale label', () => {
    for (const q of [queries.catalogueItemBySlugQuery, queries.catalogueCollectionBySlugQuery, queries.catalogueCollectionByIdQuery]) {
      expect(q).toMatch(/"byline": coalesce\(byline\[\$locale\]/)
      expect(q).toMatch(/links\[\] \{ _key, "label": coalesce\(label\[\$locale\]/)
    }
  })
})

describe('book details — ADR-033 Amendment I-3', () => {
  const book = (over: Partial<RawCatalogueItem> = {}): RawCatalogueItem =>
    item({ itemProfile: 'book', name: 'Guida galattica', offers: [], bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '978-0-345-39180-3' }, ...over })

  it('reads a book: profile, details (ISBN normalised) and no food data', () => {
    const dto = resolveItem(book(), ctx())!
    expect(dto.itemProfile).toBe('book')
    expect(dto.bookDetails).toEqual({ author: 'Douglas Adams', publisher: null, year: 1979, isbn: '9780345391803' })
    expect(dto.allergenDeclaration).toBeNull()
  })

  it('byline falls back to the author at read time; an explicit byline wins; nothing is copied', () => {
    expect(resolveItem(book(), ctx())!.byline).toBe('Douglas Adams')
    expect(resolveItem(book({ byline: 'Edizione illustrata' }), ctx())!.byline).toBe('Edizione illustrata')
    expect(resolveItem(book({ bookDetails: { year: 1979 } }), ctx())!.byline).toBeNull()
  })

  it('details are hidden when the type is changed away from book (kept in the document, not read)', () => {
    for (const itemProfile of ['product', 'service', 'foodOrDrink']) {
      const dto = resolveItem(book({ itemProfile }), ctx())!
      expect(dto.bookDetails).toBeNull()
      expect(dto.byline).toBeNull()
      expect(JSON.stringify(dto)).not.toContain('Douglas Adams')
    }
  })

  it('drops stored values that are not acceptable and returns null when nothing is left', () => {
    expect(resolveItem(book({ bookDetails: { author: '  ', year: 1979.5, isbn: '' } }), ctx())!.bookDetails).toBeNull()
    expect(resolveItem(book({ bookDetails: { author: 'A', year: 3000, isbn: 7 } }), ctx())!.bookDetails).toEqual({ author: 'A', publisher: null, year: null, isbn: null })
    expect(resolveItem(book({ bookDetails: null }), ctx())!.bookDetails).toBeNull()
    expect(resolveItem(book({ bookDetails: undefined }), ctx())!.bookDetails).toBeNull()
  })

  it('an older deployment (profileOf fallback) reads a stored book as a plain product', () => {
    // the production-safety pin: an unknown stored profile never breaks a reader
    expect(resolveItem(item({ itemProfile: 'pamphlet', bookDetails: { author: 'X' } }), ctx())!.itemProfile).toBe('product')
    expect(resolveItem(item({ itemProfile: 'pamphlet', bookDetails: { author: 'X' } }), ctx())!.bookDetails).toBeNull()
  })

  it('the item queries project bookDetails (plain, not localized)', () => {
    for (const q of [queries.catalogueItemBySlugQuery, queries.catalogueCollectionByIdQuery]) {
      expect(q).toContain('bookDetails { author, publisher, year, isbn }')
    }
  })
})
