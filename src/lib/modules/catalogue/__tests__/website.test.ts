/**
 * ADR-033 C1/C2/C5/C6/C10 — the website half of the catalogue: the catch-all
 * dispatch (only with an enabled installation), entry resolution order,
 * listing hydration, item links, canonical/hreflang and robots.
 */
import { describe, expect, it } from 'vitest'
import {
  catalogueCollectionByIdQuery,
  catalogueCollectionByOldSlugQuery,
  catalogueCollectionBySlugQuery,
  catalogueItemByOldSlugQuery,
  catalogueItemBySlugQuery,
  catalogueModuleConfigQuery,
  cataloguePageQuery,
} from '@/lib/sanity/queries'
import type { CatalogueConfigDTO } from '../dto'
import {
  catalogueAlternates,
  catalogueItemCanonical,
  catalogueItemHref,
  catalogueLandingAlternates,
  catalogueRobots,
  catalogueSlugMap,
  collectionHasItems,
  hydrateCatalogueListing,
  loadCatalogueConfig,
  loadCataloguePage,
  planCatalogueRoute,
  resolveCatalogueEntry,
  type CatalogueFetch,
} from '../website'

const CONFIG: CatalogueConfigDTO = {
  currency: 'EUR',
  segment: 'menu',
  segmentHistory: ['carta'],
  showPricesByDefault: true,
  channels: [],
  categories: [],
  tags: [],
  dietaryTags: [],
  timeZone: null,
}
const NOW = new Date('2026-10-13T12:00:00Z')
const CTX = { locale: 'it', defaultLocale: 'it', config: CONFIG, now: NOW }

/** A fake fetchForTenant answering by query identity; records the order of calls. */
function fakeFetch(answers: Map<string, unknown>) {
  const calls: string[] = []
  const names = new Map<string, string>([
    [catalogueItemBySlugQuery, 'itemBySlug'],
    [catalogueCollectionBySlugQuery, 'collectionBySlug'],
    [catalogueItemByOldSlugQuery, 'itemByOldSlug'],
    [catalogueCollectionByOldSlugQuery, 'collectionByOldSlug'],
    [catalogueCollectionByIdQuery, 'collectionById'],
    [catalogueModuleConfigQuery, 'config'],
    [cataloguePageQuery, 'landing'],
  ])
  const fetch: CatalogueFetch = async <T,>(query: string) => {
    const name = names.get(query) ?? 'unknown'
    calls.push(name)
    return (answers.get(name) ?? null) as T
  }
  return { fetch, calls }
}

const itemRow = (over: Record<string, unknown> = {}) => ({
  publicId: 'it_1',
  itemType: 'dish',
  hasPage: true,
  name: 'Margherita',
  slugMap: { it: { current: 'margherita' }, en: { current: 'margherita-pizza' } },
  offers: [{ _key: 'o1', price: 8 }],
  ...over,
})

const collectionRow = (over: Record<string, unknown> = {}) => ({
  publicId: 'co_1',
  collectionType: 'menu',
  hasPage: true,
  name: 'Pranzo',
  slugMap: { it: { current: 'pranzo' } },
  sections: [
    { _key: 'pizza', name: 'Pizza', items: [] },
    { _key: 'bianche', parentKey: 'pizza', name: 'Pizze bianche', items: [itemRow()] },
  ],
  ...over,
})

describe('planCatalogueRoute — C2 dispatch, only with an enabled installation', () => {
  it('dispatches nothing without the module (AC 3): the path falls through', () => {
    expect(planCatalogueRoute(['menu'], null)).toBeNull()
    expect(planCatalogueRoute(['menu', 'margherita'], null)).toBeNull()
    expect(planCatalogueRoute(['menu'], { ...CONFIG, segment: null })).toBeNull()
  })

  it('landing, entry and historic redirect', () => {
    expect(planCatalogueRoute(['menu'], CONFIG)).toEqual({ kind: 'landing' })
    expect(planCatalogueRoute(['menu', 'margherita'], CONFIG)).toEqual({ kind: 'entry', slug: 'margherita' })
    expect(planCatalogueRoute(['carta', 'margherita'], CONFIG)).toEqual({ kind: 'redirect', to: ['menu', 'margherita'] })
    expect(planCatalogueRoute(['carta'], CONFIG)).toEqual({ kind: 'redirect', to: ['menu'] })
  })

  it('leaves every other path to the page lookup', () => {
    expect(planCatalogueRoute(['chi-siamo'], CONFIG)).toBeNull()
    expect(planCatalogueRoute(['menu', 'a', 'b'], CONFIG)).toBeNull()
    expect(planCatalogueRoute(['servizi', 'menu'], CONFIG)).toBeNull()
  })

  it('decodes encoded segments before matching', () => {
    expect(planCatalogueRoute(['menu', 'caff%C3%A8'], CONFIG)).toEqual({ kind: 'entry', slug: 'caffè' })
  })
})

describe('loadCatalogueConfig', () => {
  it('null when the installation is absent or disabled (query returns catalogue: null)', async () => {
    const { fetch } = fakeFetch(new Map<string, unknown>([['config', { catalogue: null, timeZone: 'Europe/Rome' }]]))
    expect(await loadCatalogueConfig(fetch, { locale: 'it', defaultLocale: 'it' })).toBeNull()
  })
  it('resolves the segment and history when installed', async () => {
    const { fetch } = fakeFetch(new Map<string, unknown>([['config', { catalogue: { publicSegment: 'menu', publicSegmentHistory: ['carta'] } }]]))
    const c = await loadCatalogueConfig(fetch, { locale: 'it', defaultLocale: 'it' })
    expect(c?.segment).toBe('menu')
    expect(c?.segmentHistory).toEqual(['carta'])
  })
})

describe('resolveCatalogueEntry — item → collection → item redirect → collection redirect', () => {
  it('an item wins and stops the lookup', async () => {
    const { fetch, calls } = fakeFetch(new Map<string, unknown>([['itemBySlug', itemRow()], ['collectionBySlug', collectionRow()]]))
    const r = await resolveCatalogueEntry(fetch, 'margherita', CTX)
    expect(r.kind).toBe('item')
    expect(calls).toEqual(['itemBySlug'])
  })

  it('then a collection', async () => {
    const { fetch, calls } = fakeFetch(new Map<string, unknown>([['collectionBySlug', collectionRow()]]))
    const r = await resolveCatalogueEntry(fetch, 'pranzo', CTX)
    expect(r.kind).toBe('collection')
    expect(calls).toEqual(['itemBySlug', 'collectionBySlug'])
  })

  it('then an item redirect, before a collection redirect', async () => {
    const { fetch, calls } = fakeFetch(
      new Map<string, unknown>([
        ['itemByOldSlug', { currentSlug: 'margherita' }],
        ['collectionByOldSlug', { currentSlug: 'pranzo' }],
      ]),
    )
    expect(await resolveCatalogueEntry(fetch, 'old', CTX)).toEqual({ kind: 'redirect', slug: 'margherita' })
    expect(calls).toEqual(['itemBySlug', 'collectionBySlug', 'itemByOldSlug'])
  })

  it('then a collection redirect', async () => {
    const { fetch } = fakeFetch(new Map<string, unknown>([['collectionByOldSlug', { currentSlug: 'pranzo' }]]))
    expect(await resolveCatalogueEntry(fetch, 'old', CTX)).toEqual({ kind: 'redirect', slug: 'pranzo' })
  })

  it('otherwise notFound — including a redirect to itself (no loop) and a lifecycle-hidden row', async () => {
    const { fetch, calls } = fakeFetch(new Map<string, unknown>([['itemByOldSlug', { currentSlug: 'same' }]]))
    expect(await resolveCatalogueEntry(fetch, 'same', CTX)).toEqual({ kind: 'notFound' })
    expect(calls).toEqual(['itemBySlug', 'collectionBySlug', 'itemByOldSlug', 'collectionByOldSlug'])

    // A row that slipped past GROQ but is archived is re-checked in TS (B4).
    const hidden = fakeFetch(new Map<string, unknown>([['itemBySlug', itemRow({ archivedAt: '2026-01-01T00:00:00Z' })]]))
    expect((await resolveCatalogueEntry(hidden.fetch, 'margherita', CTX)).kind).toBe('notFound')
  })

  it('an item without a page does not resolve (AC 13)', async () => {
    const { fetch } = fakeFetch(new Map<string, unknown>([['itemBySlug', itemRow({ hasPage: false })]]))
    expect((await resolveCatalogueEntry(fetch, 'margherita', CTX)).kind).toBe('notFound')
  })
})

describe('loadCataloguePage — C1 landing', () => {
  it('null when the query returns nothing (absent or not public → unavailable page)', async () => {
    const { fetch } = fakeFetch(new Map())
    expect(await loadCataloguePage(fetch, { locale: 'it', defaultLocale: 'it' })).toBeNull()
  })
  it('resolves when public', async () => {
    const { fetch } = fakeFetch(new Map<string, unknown>([['landing', { seoTitle: 'Menu', sections: [] }]]))
    expect((await loadCataloguePage(fetch, { locale: 'it', defaultLocale: 'it' }))?.seoTitle).toBe('Menu')
  })
})

describe('hydrateCatalogueListing — the listing section', () => {
  it('no collection chosen → collection null (section renders nothing)', async () => {
    const { fetch, calls } = fakeFetch(new Map())
    const d = await hydrateCatalogueListing(fetch, null, CTX)
    expect(d.collection).toBeNull()
    expect(calls).toEqual([])
  })

  it('resolves the chosen collection, keeps a parent with no items (AC 19), carries segment + config default', async () => {
    const { fetch, calls } = fakeFetch(new Map<string, unknown>([['collectionById', collectionRow({ hasPage: false })]]))
    const d = await hydrateCatalogueListing(fetch, 'col-id', CTX)
    expect(calls).toEqual(['collectionById'])
    expect(d.segment).toBe('menu')
    expect(d.showPricesByDefault).toBe(true)
    expect(d.collection?.sections.map((s) => s.name)).toEqual(['Pizza'])
    expect(d.collection?.sections[0].items).toEqual([])
    expect(d.collection?.sections[0].children.map((s) => s.name)).toEqual(['Pizze bianche'])
    expect(collectionHasItems(d.collection)).toBe(true)
  })

  it('renders recovered orphans as roots (A7 / AC 20d)', async () => {
    const { fetch } = fakeFetch(
      new Map<string, unknown>([['collectionById', collectionRow({ sections: [{ _key: 'x', parentKey: 'gone', name: 'Orfani', items: [] }] })]]),
    )
    const d = await hydrateCatalogueListing(fetch, 'col-id', CTX)
    expect(d.collection?.sections.map((s) => [s.name, s.recovered])).toEqual([['Orfani', true]])
    expect(collectionHasItems(d.collection)).toBe(false)
  })

  it('an unlisted item inside a collection is still shown (C5 explicitReference)', async () => {
    const { fetch } = fakeFetch(
      new Map<string, unknown>([['collectionById', collectionRow({ sections: [{ _key: 's', name: 'S', items: [itemRow({ visibility: 'unlisted' })] }] })]]),
    )
    const d = await hydrateCatalogueListing(fetch, 'col-id', CTX)
    expect(d.collection?.sections[0].items).toHaveLength(1)
  })
})

describe('item links — C6', () => {
  const page = (slug: string | null) => ({ page: { slug, slugs: slug ? { it: slug } : { en: 'x' } } })
  it('links only with a page and a slug in the request locale', () => {
    expect(catalogueItemHref(page('margherita'), '/it/rist', 'menu')).toBe('/it/rist/menu/margherita')
    expect(catalogueItemHref(page(null), '/it/rist', 'menu')).toBeNull()
    expect(catalogueItemHref({ page: null }, '/it/rist', 'menu')).toBeNull()
    expect(catalogueItemHref(page('margherita'), '/it/rist', null)).toBeNull()
  })
  it('absolute URL for JSON-LD, null without a canonical origin', () => {
    expect(catalogueItemCanonical(page('margherita'), 'https://www.rist.it', 'it', 'menu')).toBe('https://www.rist.it/it/menu/margherita')
    expect(catalogueItemCanonical(page('margherita'), null, 'it', 'menu')).toBeNull()
  })
})

describe('metadata — canonical, hreflang, noindex', () => {
  const pageRef = { slug: 'margherita', slugs: { it: 'margherita', en: 'margherita-pizza' } }

  it('hreflang only for site locales with a slug; canonical in the request locale', () => {
    const r = catalogueAlternates({
      origin: 'https://www.rist.it',
      locale: 'it',
      defaultLocale: 'it',
      supportedLocales: ['it', 'en', 'de'],
      segment: 'menu',
      page: pageRef,
    })
    expect(r.canonical).toBe('https://www.rist.it/it/menu/margherita')
    expect(r.languages).toEqual({
      it: 'https://www.rist.it/it/menu/margherita',
      en: 'https://www.rist.it/en/menu/margherita-pizza',
      'x-default': 'https://www.rist.it/it/menu/margherita',
    })
  })

  it('no origin → no canonical, no hreflang', () => {
    const r = catalogueAlternates({ origin: null, locale: 'it', defaultLocale: 'it', supportedLocales: ['it'], segment: 'menu', page: pageRef })
    expect(r).toEqual({ canonical: undefined, languages: undefined })
  })

  it('landing: the same segment in every site locale', () => {
    const r = catalogueLandingAlternates({ origin: 'https://www.rist.it', locale: 'en', defaultLocale: 'it', supportedLocales: ['it', 'en'], segment: 'menu' })
    expect(r.canonical).toBe('https://www.rist.it/en/menu')
    expect(r.languages?.it).toBe('https://www.rist.it/it/menu')
    expect(r.languages?.['x-default']).toBe('https://www.rist.it/it/menu')
  })

  it('unlisted item or collection page is noindex (C5, C10); public/websiteOnly are not', () => {
    expect(catalogueRobots('unlisted')).toEqual({ index: false, follow: false })
    expect(catalogueRobots('public')).toBeUndefined()
    expect(catalogueRobots('websiteOnly')).toBeUndefined()
    expect(catalogueRobots(undefined)).toBeUndefined()
  })

  it('language switcher targets carry the segment', () => {
    expect(catalogueSlugMap(pageRef, 'menu')).toEqual({ it: 'menu/margherita', en: 'menu/margherita-pizza' })
  })
})
