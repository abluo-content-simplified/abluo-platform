/**
 * ADR-033 Amendment G — pre-release integration, proven against ONE fixture
 * dataset evaluated by groq-js with a fixed clock (as delivery-matrix.test.ts).
 *
 *  G1  the landing page: cataloguePageQuery returns the page only while it is
 *      public under its lifecycle; the catch-all dispatch serves it at
 *      /{segment} in every site locale (one segment, content with locale
 *      fallback, canonical + hreflang from catalogueLandingAlternates); not
 *      public → the unavailable page; another project's page or segment never
 *      resolves.
 *  G2  navigation links (header + footer, websiteSiteConfigQuery → resolveNavLinks)
 *      to the landing page, a collection and an item: per request locale,
 *      omitted when the module is not installed / switched off, the target is
 *      not public, has no page, has no slug in this locale, or belongs to
 *      another project.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { isValidElement } from 'react'
import { cataloguePageQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import { resolveNavLinks } from '@/lib/sanity/nav-links'
import type { NavLink, SupportedLocale } from '@/lib/sanity/types'
import { unavailableMetadata } from '@/lib/lifecycle/unavailable-metadata'
import { CatalogueRoute, catalogueRouteMetadata, type CatalogueRouteContext } from '@/components/catalogue/CatalogueRoute'
import { catalogueNavPath } from '../nav-target'
import {
  catalogueLandingAlternates,
  loadCatalogueConfig,
  loadCataloguePage,
  planCatalogueRoute,
  type CatalogueFetch,
} from '../website'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'
const LOCALES = ['it', 'en', 'de'] as const
type Locale = (typeof LOCALES)[number]
const DEFAULT: Locale = 'it'
const ORIGIN = 'https://www.example.test'

const install = (segment: string, enabled = true) => [
  { _key: 'cat', moduleId: 'catalogue', enabled, config: { currency: 'EUR', publicSegment: segment, publicSegmentHistory: [] } },
]
const slug = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([l, current]) => [l, { _type: 'slug', current }]))
const ref = (id: string) => ({ _type: 'reference', _ref: id, _weak: true })
const link = (key: string, id: string) => ({ _key: key, _type: 'navigationLink', label: { it: key, en: key, de: key }, linkType: 'internal', pageRef: ref(id) })

const NAV = [
  link('landing', 'rist-page'),
  link('collection', 'rist-col'),
  link('item', 'rist-item'),
  link('unlisted', 'rist-item-unlisted'),
  link('noPage', 'rist-item-nopage'),
  link('scheduled', 'rist-item-scheduled'),
  link('unpublished', 'rist-item-unpublished'),
  link('expired', 'rist-item-expired'),
  link('archived', 'rist-item-archived'),
  link('draftOnly', 'rist-item-draft'),
  link('archivedCollection', 'rist-col-archived'),
  link('otherProjectItem', 'other-item'),
  link('otherProjectLanding', 'other-page'),
  link('page', 'rist-about'),
  { _key: 'ext', _type: 'navigationLink', label: { it: 'ext', en: 'ext', de: 'ext' }, linkType: 'external', externalUrl: 'https://example.org' },
]

const item = (id: string, project: string, extra: Record<string, unknown>) => ({
  _id: id,
  _type: 'catalogueItem',
  projectSlug: project,
  name: { it: id, en: id },
  hasPage: true,
  slug: slug({ it: `${id}-it`, en: `${id}-en` }),
  publishedAt: PAST,
  ...extra,
})

const DATASET: Record<string, unknown>[] = [
  // rist: catalogue installed at "menu", landing page live.
  { _id: 'p-rist', _type: 'project', projectSlug: 'rist', moduleInstallations: install('menu') },
  { _id: 'sc-rist', _type: 'siteConfig', projectSlug: 'rist', defaultLocale: 'it', supportedLocales: [...LOCALES], navLinks: NAV, footerLinks: NAV },
  { _id: 'rist-page', _type: 'cataloguePage', projectSlug: 'rist', heroTitle: { it: 'Il menù', en: 'The menu' }, seoTitle: { it: 'Menù — Rist', en: 'Menu — Rist' }, sections: [] },
  { _id: 'rist-col', _type: 'catalogueCollection', projectSlug: 'rist', name: { it: 'Pizze', en: 'Pizzas' }, hasPage: true, slug: slug({ it: 'pizze', en: 'pizzas' }) },
  { _id: 'rist-col-archived', _type: 'catalogueCollection', projectSlug: 'rist', name: { it: 'Vecchie' }, hasPage: true, slug: slug({ it: 'vecchie' }), archivedAt: PAST },
  // Italian only: name + slug in it, nothing in en/de (D-7).
  { ...item('rist-item', 'rist', {}), name: { it: 'Margherita' }, slug: slug({ it: 'margherita' }) },
  item('rist-item-unlisted', 'rist', { visibility: 'unlisted' }),
  item('rist-item-nopage', 'rist', { hasPage: false }),
  item('rist-item-scheduled', 'rist', { publishedAt: FUTURE }),
  item('rist-item-unpublished', 'rist', { expiresAt: NOW.toISOString() }),
  item('rist-item-expired', 'rist', { expiresAt: PAST }),
  item('rist-item-archived', 'rist', { archivedAt: PAST }),
  { ...item('drafts.rist-item-draft', 'rist', {}) }, // never published — stripped below
  { _id: 'rist-about', _type: 'page', projectSlug: 'rist', title: { it: 'Chi siamo' }, slug: slug({ it: 'chi-siamo', en: 'about' }) },

  // other: its own catalogue at "shop", everything live.
  { _id: 'p-other', _type: 'project', projectSlug: 'other', moduleInstallations: install('shop') },
  { _id: 'other-page', _type: 'cataloguePage', projectSlug: 'other', heroTitle: { it: 'Negozio' }, sections: [] },
  item('other-item', 'other', {}),

  // bare: no catalogue installation, but catalogue documents and links exist.
  { _id: 'p-bare', _type: 'project', projectSlug: 'bare', moduleInstallations: [] },
  { _id: 'sc-bare', _type: 'siteConfig', projectSlug: 'bare', navLinks: [link('landing', 'bare-page'), link('item', 'bare-item')] },
  { _id: 'bare-page', _type: 'cataloguePage', projectSlug: 'bare', sections: [] },
  item('bare-item', 'bare', {}),

  // off: installed but switched off.
  { _id: 'p-off', _type: 'project', projectSlug: 'off', moduleInstallations: install('menu', false) },
  { _id: 'sc-off', _type: 'siteConfig', projectSlug: 'off', navLinks: [link('landing', 'off-page'), link('item', 'off-item')] },
  { _id: 'off-page', _type: 'cataloguePage', projectSlug: 'off', sections: [] },
  item('off-item', 'off', {}),

  // closed: installed, landing page archived (C1: not public).
  { _id: 'p-closed', _type: 'project', projectSlug: 'closed', moduleInstallations: install('menu') },
  { _id: 'sc-closed', _type: 'siteConfig', projectSlug: 'closed', navLinks: [link('landing', 'closed-page'), link('item', 'closed-item')] },
  { _id: 'closed-page', _type: 'cataloguePage', projectSlug: 'closed', heroTitle: { it: 'Chiuso' }, archivedAt: PAST, sections: [] },
  item('closed-item', 'closed', {}),

  // later: installed, landing page scheduled — and a draft-only landing elsewhere is simply absent.
  { _id: 'p-later', _type: 'project', projectSlug: 'later', moduleInstallations: install('menu') },
  { _id: 'later-page', _type: 'cataloguePage', projectSlug: 'later', publishedAt: FUTURE, sections: [] },
]
const PUBLISHED = DATASET.filter((d) => !String(d._id).startsWith('drafts.'))

function fetcherFor(projectSlug: string): CatalogueFetch {
  return async <T,>(query: string, params: Record<string, unknown> = {}) => {
    const p = { projectSlug, locale: DEFAULT, defaultLocale: DEFAULT, ...params }
    const value = await evaluate(parse(query, { params: p }), { dataset: PUBLISHED, params: p, timestamp: NOW })
    return (await value.get()) as T
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// G1 — the landing page
// ═════════════════════════════════════════════════════════════════════════════

describe('G1 cataloguePageQuery — public only under its own lifecycle, project-scoped', () => {
  it('returns the live landing page of this project', async () => {
    expect(await fetcherFor('rist')(cataloguePageQuery, { locale: 'it', defaultLocale: 'it' })).not.toBeNull()
  })

  it.each(['closed', 'later'])('%s: archived / scheduled landing page → null', async (project) => {
    expect(await fetcherFor(project)(cataloguePageQuery, { locale: 'it', defaultLocale: 'it' })).toBeNull()
  })

  it('never answers with another project\'s landing page', async () => {
    // "closed" has no public page of its own; "rist" and "other" do.
    const page = await loadCataloguePage(fetcherFor('closed'), { locale: 'it', defaultLocale: 'it' })
    expect(page).toBeNull()
    const rist = await loadCataloguePage(fetcherFor('rist'), { locale: 'it', defaultLocale: 'it' })
    expect(rist?.heroTitle).toBe('Il menù')
  })
})

describe('G1 the catch-all serves the landing page at /{segment} in every locale', () => {
  it.each(LOCALES)('%s: the same segment dispatches to the landing page; content falls back to the default locale', async (locale) => {
    const fetch = fetcherFor('rist')
    const config = await loadCatalogueConfig(fetch, { locale, defaultLocale: DEFAULT })
    expect(config?.segment).toBe('menu')
    expect(planCatalogueRoute(['menu'], config)).toEqual({ kind: 'landing' })
    const page = await loadCataloguePage(fetch, { locale, defaultLocale: DEFAULT })
    expect(page?.heroTitle).toBe(locale === 'en' ? 'The menu' : 'Il menù')
  })

  it.each(LOCALES)('%s: canonical in the request locale, hreflang for every site locale (catalogueLandingAlternates)', (locale) => {
    const { canonical, languages } = catalogueLandingAlternates({ origin: ORIGIN, locale, defaultLocale: DEFAULT, supportedLocales: LOCALES, segment: 'menu' })
    expect(canonical).toBe(`${ORIGIN}/${locale}/menu`)
    for (const l of LOCALES) expect(languages?.[l]).toBe(`${ORIGIN}/${l}/menu`)
  })

  it('another project\'s segment never dispatches here, and ours never dispatches there', async () => {
    const rist = await loadCatalogueConfig(fetcherFor('rist'), { locale: 'it', defaultLocale: 'it' })
    const other = await loadCatalogueConfig(fetcherFor('other'), { locale: 'it', defaultLocale: 'it' })
    expect(planCatalogueRoute(['shop'], rist)).toBeNull()
    expect(planCatalogueRoute(['menu'], other)).toBeNull()
  })

  it('no installation / switched off → no dispatch at all', async () => {
    for (const project of ['bare', 'off']) {
      const config = await loadCatalogueConfig(fetcherFor(project), { locale: 'it', defaultLocale: 'it' })
      expect(config).toBeNull()
      expect(planCatalogueRoute(['menu'], config)).toBeNull()
    }
  })
})

describe('G1 CatalogueRoute (landing) — render path', () => {
  const ctxFor = async (project: string, locale: Locale): Promise<CatalogueRouteContext> => {
    const fetch = fetcherFor(project)
    const config = (await loadCatalogueConfig(fetch, { locale, defaultLocale: DEFAULT }))!
    return {
      dispatch: { kind: 'landing' },
      config,
      fetchForTenant: fetch as CatalogueRouteContext['fetchForTenant'],
      locale,
      defaultLocale: DEFAULT as SupportedLocale,
      tenantId: project as CatalogueRouteContext['tenantId'],
      siteBase: `/${locale}/${project}`,
      siteConfig: { siteName: 'Rist', supportedLocales: [...LOCALES] } as unknown as CatalogueRouteContext['siteConfig'],
    }
  }

  it.each(LOCALES)('%s: renders with the language switcher pointing at the same segment', async (locale) => {
    const ctx = await ctxFor('rist', locale)
    const el = await CatalogueRoute({ ...ctx, designSystem: null, moduleConfig: null, enabledModuleIds: ['catalogue'], hostScoped: false })
    expect(isValidElement(el)).toBe(true)
    expect((el as { props: { slugMap: Record<string, string> } }).props.slugMap).toEqual({ it: 'menu', en: 'menu', de: 'menu' })
    const meta = await catalogueRouteMetadata(ctx)
    expect(meta.title).toBe(locale === 'en' ? 'Menu — Rist' : 'Menù — Rist')
    expect(meta.robots).toBeUndefined()
  })

  it.each(LOCALES)('%s: a landing page that is not public → the unavailable page (notFound) and its metadata', async (locale) => {
    const ctx = await ctxFor('closed', locale)
    await expect(CatalogueRoute({ ...ctx, designSystem: null, moduleConfig: null, enabledModuleIds: ['catalogue'], hostScoped: false })).rejects.toThrow()
    expect(await catalogueRouteMetadata(ctx)).toEqual(unavailableMetadata(locale))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// G2 — navigation links to catalogue targets
// ═════════════════════════════════════════════════════════════════════════════

type SiteNav = { navLinks?: NavLink[]; footerLinks?: NavLink[] }

async function navFor(project: string, locale: Locale, hostScoped = false) {
  const row = await fetcherFor(project)<SiteNav | null>(websiteSiteConfigQuery, { locale, defaultLocale: DEFAULT })
  const toMap = (links?: NavLink[]) =>
    Object.fromEntries(resolveNavLinks(links, locale as SupportedLocale, project, undefined, hostScoped).map((l) => [l.label, l.href]))
  return { header: toMap(row?.navLinks), footer: toMap(row?.footerLinks) }
}

describe('G2 navigation links resolve catalogue targets per request locale', () => {
  const EXPECTED: Record<Locale, Record<string, string>> = {
    it: {
      landing: '/it/rist/menu',
      collection: '/it/rist/menu/pizze',
      item: '/it/rist/menu/margherita',
      unlisted: '/it/rist/menu/rist-item-unlisted-it',
      page: '/it/rist/chi-siamo',
      ext: 'https://example.org',
    },
    en: {
      landing: '/en/rist/menu',
      collection: '/en/rist/menu/pizzas',
      // item: Italian only → omitted in English (C6/D-7, never the it slug)
      unlisted: '/en/rist/menu/rist-item-unlisted-en',
      page: '/en/rist/about',
      ext: 'https://example.org',
    },
    de: {
      landing: '/de/rist/menu',
      // collection + items have no German slug → omitted
      // a PAGE keeps its existing default-locale slug fallback (unchanged)
      page: '/de/rist/chi-siamo',
      ext: 'https://example.org',
    },
  }

  it.each(LOCALES)('%s: header and footer resolve exactly the routable targets', async (locale) => {
    const { header, footer } = await navFor('rist', locale)
    expect(header).toEqual(EXPECTED[locale])
    expect(footer).toEqual(EXPECTED[locale])
  })

  it.each(['noPage', 'scheduled', 'unpublished', 'expired', 'archived', 'draftOnly', 'archivedCollection', 'otherProjectItem', 'otherProjectLanding'])(
    '%s → omitted in every locale',
    async (key) => {
      for (const locale of LOCALES) {
        const { header, footer } = await navFor('rist', locale)
        expect(header).not.toHaveProperty(key)
        expect(footer).not.toHaveProperty(key)
      }
    },
  )

  it('on the site\'s own host the project segment is dropped (same helper as pages)', async () => {
    const { header } = await navFor('rist', 'it', true)
    expect(header.landing).toBe('/it/menu')
    expect(header.collection).toBe('/it/menu/pizze')
    expect(header.page).toBe('/it/chi-siamo')
  })

  it.each(['bare', 'off'])('%s: catalogue not installed / switched off → catalogue links omitted', async (project) => {
    for (const locale of LOCALES) expect(await navFor(project, locale)).toEqual({ header: {}, footer: {} })
  })

  it('closed: landing page not public → its link is omitted; a live item still links', async () => {
    const { header } = await navFor('closed', 'it')
    expect(header).toEqual({ item: '/it/closed/menu/closed-item-it' })
  })

  it('the projection never turns a catalogue slug into a page slug', async () => {
    const row = await fetcherFor('rist')<SiteNav>(websiteSiteConfigQuery, { locale: 'it', defaultLocale: 'it' })
    for (const l of row.navLinks ?? []) {
      if (l.label !== 'page') expect(l.pageSlug ?? null).toBeNull()
    }
  })
})

describe('catalogueNavPath — the pure rule', () => {
  it('landing / collection / item; null without segment, page, slug or a known type', () => {
    expect(catalogueNavPath({ type: 'cataloguePage', segment: 'menu' })).toBe('menu')
    expect(catalogueNavPath({ type: 'cataloguePage', segment: ' /Menu/ ' })).toBe('menu')
    expect(catalogueNavPath({ type: 'catalogueItem', segment: 'menu', hasPage: true, slug: 'x' })).toBe('menu/x')
    expect(catalogueNavPath({ type: 'catalogueCollection', segment: 'menu', hasPage: true, slug: 'c' })).toBe('menu/c')
    expect(catalogueNavPath({ type: 'catalogueItem', segment: 'menu', hasPage: false, slug: 'x' })).toBeNull()
    expect(catalogueNavPath({ type: 'catalogueItem', segment: 'menu', hasPage: true, slug: null })).toBeNull()
    expect(catalogueNavPath({ type: 'catalogueItem', segment: null, hasPage: true, slug: 'x' })).toBeNull()
    expect(catalogueNavPath({ type: 'cataloguePage', segment: null })).toBeNull()
    expect(catalogueNavPath({ type: 'page', segment: 'menu', slug: 'x' })).toBeNull()
    expect(catalogueNavPath(null)).toBeNull()
  })
})
