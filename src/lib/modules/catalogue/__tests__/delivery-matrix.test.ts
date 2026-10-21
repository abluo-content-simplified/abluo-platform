/**
 * ADR-033 Amendment D-9 — THE CATALOGUE DELIVERY MATRIX.
 *
 * One readable, table-driven proof of  visibility x lifecycle x context x
 * language  against ONE sample dataset, evaluated by groq-js with a fixed
 * clock (NOW), plus segment redirects and the currency warning.
 *
 * ── How to read it ───────────────────────────────────────────────────────────
 *
 * 1. LIVE_REACH (below) is the whole business rule as one table. Rows are
 *    delivery contexts, columns are visibility [public, websiteOnly, unlisted],
 *    and the cell says whether LIVE content reaches that context. It is
 *    written by hand on purpose: it is NOT read from visibility.ts, so a wrong
 *    edit there makes this file fail instead of agreeing with itself.
 *
 * 2. LIFECYCLE is not in the table because it has no columns: only a `live`
 *    document reaches ANY context. draft-only, scheduled, unpublished,
 *    expired and archived reach none, whatever their visibility (ADR-032 D3).
 *    ("unpublished" and "expired" are the SAME mechanism, `expiresAt` in the
 *    past - ADR-032 D2 "Unpublish = expiresAt = now". They are two fixtures:
 *    one expires exactly AT `now`, one long before, so the boundary is tested.)
 *
 * 3. LANGUAGE: a page/URL/link/hreflang/sitemap entry/llms line exists in a
 *    locale only if the document has a REAL slug there (C6, D-7). The dataset
 *    has `translated` kinds (name + slug in it and en) and `itonly` kinds.
 *
 * 4. reach(context, kind, locale) is the single expectation function. Every
 *    generated case is named  "<kind> . <context> . <locale> -> reaches|absent"
 *    so a red line names the failing cell.
 *
 * Contexts exercised (real code, no re-implementation):
 *   explicit collection contents   catalogueCollectionByIdQuery / BySlugQuery + resolveCollection
 *   item page / collection page    resolveCatalogueEntry (slug queries) + catalogueRobots
 *   sitemap                        SITEMAP_CATALOGUE_* + catalogueSitemapEntries
 *   llms.txt                       LLMS_CATALOGUE_* + catalogueLinesFor
 *   structured data                catalogueItemJsonLd / catalogueCollectionJsonLd on resolved DTOs
 *   automatic listing, partner     visibility.ts only: visibilityFilter() in GROQ and admits() in TS
 *                                  (composed with publicFilterFor / isPublicAt; no new query)
 *
 * Drafts: the delivery client reads the PUBLISHED perspective, so a draft-only
 * document is modelled as a `drafts.*` document that the test harness strips
 * before evaluating (see `published()`); references to it then dangle.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import {
  catalogueCollectionByIdQuery,
  catalogueModuleConfigQuery,
} from '@/lib/sanity/queries'
import {
  SITEMAP_CATALOGUE_COLLECTIONS_QUERY,
  SITEMAP_CATALOGUE_ITEMS_QUERY,
  SITEMAP_CATALOGUE_LANDING_QUERY,
} from '@/lib/seo/sitemap-queries'
import { catalogueSitemapEntries } from '@/lib/seo/sitemap-catalogue'
import {
  LLMS_CATALOGUE_COLLECTIONS_QUERY,
  LLMS_CATALOGUE_ITEMS_QUERY,
  LLMS_CATALOGUE_SEGMENT_QUERY,
  catalogueLinesFor,
} from '@/lib/seo/llms'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { isPublicAt } from '@/lib/lifecycle/visibility'
import { siteBasePath } from '@/lib/sanity/href'
import type { CatalogueCollectionDTO, CatalogueConfigDTO, CatalogueItemDTO, CatalogueSectionDTO } from '../dto'
import { resolveCatalogueConfig, resolveCollection, resolveItem, type CatalogueResolveContext, type RawCatalogueCollection } from '../resolve'
import { admits, isIndexable, visibilityFilter, type CatalogueDeliveryContext } from '../visibility'
import { applySegmentChange, dispatchCatalogue } from '../segment'
import { localizeItem } from '../amazon-delivery'
import {
  catalogueAlternates,
  catalogueItemCanonical,
  catalogueItemHref,
  catalogueRobots,
  catalogueSlugMap,
  hydrateCatalogueListing,
  planCatalogueRoute,
  resolveCatalogueEntry,
  type CatalogueEntry,
  type CatalogueFetch,
} from '../website'
import { catalogueCollectionJsonLd, catalogueItemJsonLd } from '../structured'
import { currencyChangeNeedsConfirmation, currencyImpact } from '../validation'

// ── The clock, the site, the vocabulary ──────────────────────────────────────

const NOW = new Date('2026-10-13T10:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const LONG_AGO = '2026-09-01T09:00:00.000Z'
const PAST = '2026-10-01T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'

const PROJECT = 'rist'
const SEGMENT = 'menu'
const ORIGIN = 'https://www.example.test'
const LOCALES = ['it', 'en'] as const
type Locale = (typeof LOCALES)[number]
const DEFAULT_LOCALE: Locale = 'it'

const VISIBILITIES = ['public', 'websiteOnly', 'unlisted'] as const
type Visibility = (typeof VISIBILITIES)[number]
const STATES = ['draft-only', 'scheduled', 'live', 'unpublished', 'expired', 'archived'] as const
type State = (typeof STATES)[number]

// ── THE TABLE ────────────────────────────────────────────────────────────────
// Does LIVE content of this visibility reach this context?   [public, websiteOnly, unlisted]

const Y = true
const N = false
const LIVE_REACH = {
  /** An editor put it in a collection; the collection page / listing section shows it. */
  explicitCollection: [Y, Y, Y],
  /** Its OWN page resolves by direct link (unlisted = by link only, noindex). */
  ownPage: [Y, Y, Y],
  sitemap: [Y, Y, N],
  llms: [Y, Y, N],
  structuredData: [Y, Y, N],
  automaticListing: [Y, Y, N],
  partner: [Y, N, N],
} as const satisfies Record<string, readonly [boolean, boolean, boolean]>
type Context = keyof typeof LIVE_REACH

// ── Sample dataset ───────────────────────────────────────────────────────────

type Kind = {
  id: string
  /** Stored visibility; undefined = field absent (counts as public). */
  stored: Visibility | undefined
  vis: Visibility
  state: State
  /** name + slug in it AND en; false = Italian only. */
  translated: boolean
  hasPage: boolean
}

function lifecycleFields(state: State): Record<string, string> {
  switch (state) {
    case 'scheduled': return { publishedAt: FUTURE }
    case 'live': return { publishedAt: PAST }
    case 'unpublished': return { publishedAt: LONG_AGO, expiresAt: NOW_ISO } // "unpublish now": expiresAt = now
    case 'expired': return { publishedAt: LONG_AGO, expiresAt: PAST }
    case 'archived': return { publishedAt: LONG_AGO, archivedAt: PAST }
    case 'draft-only': return {}
  }
}

const KINDS: Kind[] = [
  ...VISIBILITIES.flatMap((vis) =>
    STATES.map((state): Kind => ({ id: `${vis}-${state}`, stored: vis, vis, state, translated: true, hasPage: true })),
  ),
  ...VISIBILITIES.map((vis): Kind => ({ id: `${vis}-live-itonly`, stored: vis, vis, state: 'live', translated: false, hasPage: true })),
  { id: 'public-live-nopage', stored: 'public', vis: 'public', state: 'live', translated: true, hasPage: false },
  { id: 'novis-live', stored: undefined, vis: 'public', state: 'live', translated: true, hasPage: true },
]
const idOf = (k: Kind): string => k.id
const isLive = (k: Kind): boolean => k.state === 'live'
const hasLocale = (k: Kind, l: Locale): boolean => l === DEFAULT_LOCALE || k.translated

const slugField = (base: string, translated: boolean) => ({
  _type: 'localizedSlug',
  it: { _type: 'slug', current: base },
  ...(translated ? { en: { _type: 'slug', current: `${base}-en` } } : {}),
})
const nameField = (k: Kind, prefix: string) => ({
  it: `${prefix} «${k.id}»`,
  ...(k.translated ? { en: `${prefix === 'Piatto' ? 'Dish' : 'List'} «${k.id}»` } : {}),
})

const itemSlug = (k: Kind, l: Locale): string => (l === 'it' ? k.id : `${k.id}-en`)
const collectionSlug = (k: Kind, l: Locale): string => `c-${itemSlug(k, l)}`
const itemDocId = (k: Kind): string => `catalogueItem-${k.id}`
const collectionDocId = (k: Kind): string => `catalogueCollection-${k.id}`
const ref = (id: string) => ({ _type: 'reference', _ref: id, _key: `r-${id}` })

function itemDoc(k: Kind): Record<string, unknown> {
  return {
    _id: k.state === 'draft-only' ? `drafts.${itemDocId(k)}` : itemDocId(k),
    _type: 'catalogueItem',
    projectSlug: PROJECT,
    publicId: k.id,
    itemProfile: 'foodOrDrink',
    ...(k.stored ? { visibility: k.stored } : {}),
    hasPage: k.hasPage,
    name: nameField(k, 'Piatto'),
    slug: slugField(k.id, k.translated),
    offers: [{ _key: 'o1', price: 8.5 }],
    ...lifecycleFields(k.state),
  }
}

/** Collections of each kind hold EVERY item kind, so each collection is a full explicit-contents test. */
function collectionDoc(k: Kind): Record<string, unknown> {
  return {
    _id: k.state === 'draft-only' ? `drafts.${collectionDocId(k)}` : collectionDocId(k),
    _type: 'catalogueCollection',
    projectSlug: PROJECT,
    publicId: k.id,
    collectionType: k.vis === 'public' ? 'menu' : 'list',
    ...(k.stored ? { visibility: k.stored } : {}),
    hasPage: k.hasPage,
    name: nameField(k, 'Lista'),
    slug: slugField(`c-${k.id}`, k.translated),
    sections: [
      { _key: 's1', name: { it: 'Tutto' }, items: KINDS.map((i) => ref(itemDocId(i))) },
      // Holds ONLY the unlisted live item: structured data must prune this section, the page must keep it.
      { _key: 's-unl', name: { it: 'Solo unlisted' }, items: [ref(itemDocId(kindById('unlisted-live')))] },
      // Empty from the start (AC 19): kept everywhere.
      { _key: 's-empty', name: { it: 'Vuota' }, items: [] },
    ],
    ...lifecycleFields(k.state),
  }
}

function kindById(id: string): Kind {
  const k = KINDS.find((x) => x.id === id)
  if (!k) throw new Error(`no kind ${id}`)
  return k
}

const DATASET: Record<string, unknown>[] = [
  {
    _id: 'project-rist',
    _type: 'project',
    projectSlug: PROJECT,
    moduleInstallations: [
      {
        _key: 'm',
        moduleId: 'catalogue',
        enabled: true,
        config: { currency: 'EUR', publicSegment: SEGMENT, publicSegmentHistory: ['carta'], showPricesByDefault: true },
      },
    ],
  },
  { _id: 'siteConfig-rist', _type: 'siteConfig', projectSlug: PROJECT, timeZone: 'Europe/Rome' },
  { _id: 'cataloguePage-rist', _type: 'cataloguePage', projectSlug: PROJECT },
  ...KINDS.map(itemDoc),
  ...KINDS.map(collectionDoc),
]

/** The delivery client's PUBLISHED perspective: drafts.* never answer a public read. */
const published = (docs: Record<string, unknown>[]) => docs.filter((d) => !String(d._id).startsWith('drafts.'))
const PUBLISHED = published(DATASET)

async function run<T = unknown>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = { projectSlug: PROJECT, locale: 'it', defaultLocale: 'it', ...params }
  const value = await evaluate(parse(query, { params: p }), { dataset: PUBLISHED, params: p, timestamp: NOW })
  return (await value.get()) as T
}
const fetchForTenant: CatalogueFetch = async (query, params) => (await run(query, params)) as never

// ── Expectation ──────────────────────────────────────────────────────────────

/** Lifecycle first (live only), then the visibility column of the table. */
function reachesContext(context: Context, k: Kind): boolean {
  return isLive(k) && LIVE_REACH[context][VISIBILITIES.indexOf(k.vis)]
}
/** URL-bearing contexts also need a page and a real slug in the locale. */
function hasUrl(k: Kind, l: Locale): boolean {
  return k.hasPage && hasLocale(k, l)
}
const verdict = (b: boolean) => (b ? 'reaches' : 'absent')

// ── Everything evaluated once ────────────────────────────────────────────────

let config: CatalogueConfigDTO
const ctxFor = (locale: Locale): CatalogueResolveContext => ({ locale, defaultLocale: DEFAULT_LOCALE, config, now: NOW })

const entries = new Map<string, CatalogueEntry>() // `${item|collection}:${id}:${locale}`
const byId = new Map<string, CatalogueCollectionDTO | null>() // `${id}:${locale}`
const bySlugRows = new Map<string, CatalogueEntry>()
let sitemapUrls: Set<string>
let llmsText: Record<Locale, string>
let groqSets: Record<'automaticListing' | 'partner', { items: Set<string>; collections: Set<string> }>

const flatItems = (sections: readonly CatalogueSectionDTO[]): CatalogueItemDTO[] =>
  sections.flatMap((s) => [...s.items, ...flatItems(s.children)])

type Node = Record<string, unknown>
function nodesNamed(json: unknown, id: string, out: Node[] = []): Node[] {
  if (Array.isArray(json)) json.forEach((j) => nodesNamed(j, id, out))
  else if (json && typeof json === 'object') {
    const o = json as Node
    if (typeof o.name === 'string' && o.name.includes(`«${id}»`) && typeof o['@type'] === 'string') out.push(o)
    Object.values(o).forEach((v) => nodesNamed(v, id, out))
  }
  return out
}

beforeAll(async () => {
  config = resolveCatalogueConfig(await run(catalogueModuleConfigQuery), 'it', 'it')!

  for (const l of LOCALES) {
    for (const k of KINDS) {
      entries.set(`item:${k.id}:${l}`, await resolveCatalogueEntry(fetchForTenant, itemSlug(k, l), ctxFor(l)))
      // Collections and items share one slug namespace; the collection slug carries a `c-` prefix.
      bySlugRows.set(`collection:${k.id}:${l}`, await resolveCatalogueEntry(fetchForTenant, collectionSlug(k, l), ctxFor(l)))
      const row = await run<RawCatalogueCollection | null>(catalogueCollectionByIdQuery, { collectionId: collectionDocId(k), locale: l })
      byId.set(`${k.id}:${l}`, resolveCollection(row, ctxFor(l)))
    }
  }

  const landing = await run<{ projectSlug: string; segment: string }[]>(SITEMAP_CATALOGUE_LANDING_QUERY)
  const sitemap = catalogueSitemapEntries({
    items: await run(SITEMAP_CATALOGUE_ITEMS_QUERY),
    collections: await run(SITEMAP_CATALOGUE_COLLECTIONS_QUERY),
    landing: landing.find((r) => r.projectSlug === PROJECT) ?? null,
    origin: ORIGIN,
    locales: LOCALES,
    primaryLocale: DEFAULT_LOCALE,
  })
  sitemapUrls = new Set(sitemap.map((e) => e.url))

  const segment = await run<string | null>(LLMS_CATALOGUE_SEGMENT_QUERY)
  const rows = {
    collections: await run<never[]>(LLMS_CATALOGUE_COLLECTIONS_QUERY),
    items: await run<never[]>(LLMS_CATALOGUE_ITEMS_QUERY),
  }
  llmsText = Object.fromEntries(LOCALES.map((l) => [l, catalogueLinesFor(rows, segment, ORIGIN, l).join('\n')])) as Record<Locale, string>

  const composed = async (type: 'catalogueItem' | 'catalogueCollection', ctx: CatalogueDeliveryContext) =>
    new Set(
      (
        await run<{ publicId: string }[]>(
          `*[_type == "${type}" && projectSlug == $projectSlug && ${publicFilterFor(type)} && ${visibilityFilter(ctx)}]{ publicId }`,
        )
      ).map((r) => r.publicId),
    )
  groqSets = {
    automaticListing: { items: await composed('catalogueItem', 'automaticListing'), collections: await composed('catalogueCollection', 'automaticListing') },
    partner: { items: await composed('catalogueItem', 'partner'), collections: await composed('catalogueCollection', 'partner') },
  }
})

// ── Case generation ──────────────────────────────────────────────────────────

type Case = { name: string; run: () => void }
const cases = (title: string, list: Case[]) =>
  describe(title, () => {
    for (const c of list) it(c.name, c.run)
  })

const name = (k: Kind, context: string, l: Locale | '', expected: boolean) =>
  `${k.id} . ${context}${l ? ` . ${l}` : ''} -> ${verdict(expected)}`

/** Hosts for "explicit collection contents": a public menu, a websiteOnly list and an unlisted list, all live. */
const HOSTS = ['public-live', 'websiteOnly-live', 'unlisted-live'] as const

// ═════════════════════════════════════════════════════════════════════════════
// A. ITEMS - one case per (kind, context, locale)
// ═════════════════════════════════════════════════════════════════════════════

const itemCases: Case[] = []
for (const k of KINDS) {
  for (const l of LOCALES) {
    // explicit contents: by id (listing section) and as the collection page, in every host collection
    for (const host of HOSTS) {
      const e = reachesContext('explicitCollection', k)
      itemCases.push({
        name: name(k, `explicit contents of ${host} (by id)`, l, e),
        run: () => {
          const dto = byId.get(`${host}:${l}`)
          expect(dto).not.toBeNull()
          expect(flatItems(dto!.sections).some((i) => i.publicId === k.id)).toBe(e)
        },
      })
    }
    {
      const e = reachesContext('explicitCollection', k)
      itemCases.push({
        name: name(k, 'explicit contents of public-live (collection page)', l, e),
        run: () => {
          const entry = bySlugRows.get(`collection:public-live:${l}`)!
          expect(entry.kind).toBe('collection')
          if (entry.kind !== 'collection') return
          expect(flatItems(entry.collection.sections).some((i) => i.publicId === k.id)).toBe(e)
        },
      })
    }
    // own page by direct link
    {
      const e = reachesContext('ownPage', k) && hasUrl(k, l)
      itemCases.push({
        name: name(k, 'item page', l, e),
        run: () => expect(entries.get(`item:${k.id}:${l}`)!.kind === 'item').toBe(e),
      })
    }
    // robots on the page that resolved
    if (reachesContext('ownPage', k) && hasUrl(k, l)) {
      itemCases.push({
        name: `${k.id} . item page robots . ${l} -> ${k.vis === 'unlisted' ? 'noindex' : 'indexable'}`,
        run: () => {
          const entry = entries.get(`item:${k.id}:${l}`)!
          if (entry.kind !== 'item') throw new Error('page did not resolve')
          expect(isIndexable(entry.item.visibility)).toBe(k.vis !== 'unlisted')
          expect(catalogueRobots(entry.item.visibility)).toEqual(k.vis === 'unlisted' ? { index: false, follow: false } : undefined)
        },
      })
    }
    // sitemap, llms
    {
      const e = reachesContext('sitemap', k) && hasUrl(k, l)
      itemCases.push({
        name: name(k, 'sitemap', l, e),
        run: () => expect(sitemapUrls.has(`${ORIGIN}/${l}/${SEGMENT}/${itemSlug(k, l)}`)).toBe(e),
      })
    }
    {
      const e = reachesContext('llms', k) && hasUrl(k, l)
      itemCases.push({
        name: name(k, 'llms.txt', l, e),
        run: () => expect(llmsText[l].includes(`](${ORIGIN}/${l}/${SEGMENT}/${itemSlug(k, l)})`)).toBe(e),
      })
    }
    // structured data: own page JSON-LD
    {
      const e = reachesContext('structuredData', k) && reachesContext('ownPage', k) && hasUrl(k, l)
      itemCases.push({
        name: name(k, 'structured data (own page JSON-LD)', l, e),
        run: () => {
          const entry = entries.get(`item:${k.id}:${l}`)!
          const url = `${ORIGIN}/${l}/${SEGMENT}/${itemSlug(k, l)}`
          const ld = entry.kind === 'item' ? catalogueItemJsonLd(entry.item, { url, locale: l }) : null
          expect(ld !== null).toBe(e)
        },
      })
    }
    // structured data: inside a collection's JSON-LD (Menu for public, OfferCatalog for websiteOnly)
    for (const host of ['public-live', 'websiteOnly-live'] as const) {
      const e = reachesContext('structuredData', k)
      itemCases.push({
        name: name(k, `structured data (inside ${host} JSON-LD)`, l, e),
        run: () => {
          const dto = byId.get(`${host}:${l}`)!
          const ld = catalogueCollectionJsonLd(dto, { url: `${ORIGIN}/${l}/${SEGMENT}/c-${host}`, locale: l })
          expect(ld).not.toBeNull()
          expect(nodesNamed(ld, k.id).length > 0).toBe(e)
        },
      })
    }
  }
  // locale-independent contexts, through the visibility helper only
  for (const ctx of ['automaticListing', 'partner'] as const) {
    const e = reachesContext(ctx, k)
    itemCases.push({
      name: name(k, ctx, '', e),
      run: () => {
        expect(groqSets[ctx].items.has(k.id)).toBe(e) // GROQ: publicFilterFor && visibilityFilter(ctx)
        const stored = k.state === 'draft-only' ? null : itemDoc(k)
        expect(!!stored && isPublicAt(stored as never, 'optional', NOW) && admits(ctx, k.stored)).toBe(e) // TS twin
      },
    })
  }
}
cases('A. items x context x language', itemCases)

// ═════════════════════════════════════════════════════════════════════════════
// B. COLLECTIONS - same table, same lifecycle, collection-specific reads
// ═════════════════════════════════════════════════════════════════════════════

const collectionCases: Case[] = []
for (const k of KINDS) {
  for (const l of LOCALES) {
    {
      // A listing section is an explicit pick: lifecycle decides, visibility does not (unlisted shows).
      const e = reachesContext('explicitCollection', k)
      collectionCases.push({
        name: name(k, 'listing section (by id)', l, e),
        run: () => expect(byId.get(`${k.id}:${l}`) !== null).toBe(e),
      })
    }
    {
      const e = reachesContext('ownPage', k) && hasUrl(k, l)
      collectionCases.push({
        name: name(k, 'collection page', l, e),
        run: () => expect(bySlugRows.get(`collection:${k.id}:${l}`)!.kind === 'collection').toBe(e),
      })
    }
    if (reachesContext('ownPage', k) && hasUrl(k, l)) {
      collectionCases.push({
        name: `${k.id} . collection page robots . ${l} -> ${k.vis === 'unlisted' ? 'noindex' : 'indexable'}`,
        run: () => {
          const entry = bySlugRows.get(`collection:${k.id}:${l}`)!
          if (entry.kind !== 'collection') throw new Error('page did not resolve')
          expect(catalogueRobots(entry.collection.visibility)).toEqual(k.vis === 'unlisted' ? { index: false, follow: false } : undefined)
        },
      })
    }
    {
      const e = reachesContext('sitemap', k) && hasUrl(k, l)
      collectionCases.push({
        name: name(k, 'sitemap', l, e),
        run: () => expect(sitemapUrls.has(`${ORIGIN}/${l}/${SEGMENT}/${collectionSlug(k, l)}`)).toBe(e),
      })
    }
    {
      const e = reachesContext('llms', k) && hasUrl(k, l)
      collectionCases.push({
        name: name(k, 'llms.txt', l, e),
        run: () => expect(llmsText[l].includes(`](${ORIGIN}/${l}/${SEGMENT}/${collectionSlug(k, l)})`)).toBe(e),
      })
    }
    {
      const e = reachesContext('structuredData', k)
      collectionCases.push({
        name: name(k, 'structured data (collection JSON-LD)', l, e),
        run: () => {
          const dto = byId.get(`${k.id}:${l}`)
          const ld = dto ? catalogueCollectionJsonLd(dto, { url: `${ORIGIN}/${l}/${SEGMENT}/${collectionSlug(k, l)}`, locale: l }) : null
          expect(ld !== null).toBe(e)
        },
      })
    }
  }
  for (const ctx of ['automaticListing', 'partner'] as const) {
    const e = reachesContext(ctx, k)
    collectionCases.push({
      name: name(k, ctx, '', e),
      run: () => {
        expect(groqSets[ctx].collections.has(k.id)).toBe(e)
        const stored = k.state === 'draft-only' ? null : collectionDoc(k)
        expect(!!stored && isPublicAt(stored as never, 'optional', NOW) && admits(ctx, k.stored)).toBe(e)
      },
    })
  }
}
cases('B. collections x context x language', collectionCases)

// ═════════════════════════════════════════════════════════════════════════════
// C. LANGUAGE - links, hreflang, slug map, no default-language fallback
// ═════════════════════════════════════════════════════════════════════════════

describe('C. language: only locales with a real slug get a link / alternate / URL', () => {
  const translated = kindById('public-live')
  const itOnly = kindById('public-live-itonly')

  const itemIn = (k: Kind, l: Locale): CatalogueItemDTO => {
    const dto = byId.get(`public-live:${l}`)!
    const item = flatItems(dto.sections).find((i) => i.publicId === k.id)
    if (!item) throw new Error(`${k.id} missing in ${l}`)
    return item
  }

  it('translated item: href and canonical in both locales', () => {
    for (const l of LOCALES) {
      const item = itemIn(translated, l)
      expect(catalogueItemHref(item, `/${l}`, SEGMENT)).toBe(`/${l}/${SEGMENT}/${itemSlug(translated, l)}`)
      expect(catalogueItemCanonical(item, ORIGIN, l, SEGMENT)).toBe(`${ORIGIN}/${l}/${SEGMENT}/${itemSlug(translated, l)}`)
    }
  })

  it('untranslated item: it link exists; en has NO link, NO canonical, and no fallback to the it slug', () => {
    expect(catalogueItemHref(itemIn(itOnly, 'it'), '/it', SEGMENT)).toBe(`/it/${SEGMENT}/${itOnly.id}`)
    const en = itemIn(itOnly, 'en')
    expect(en.page).not.toBeNull() // it has a page (in it), so the card renders...
    expect(en.page!.slug).toBeNull() // ...but not a routable one in en
    expect(catalogueItemHref(en, '/en', SEGMENT)).toBeNull()
    expect(catalogueItemHref(en, '/en', SEGMENT)).not.toBe(`/en/${SEGMENT}/${itOnly.id}`)
    expect(catalogueItemCanonical(en, ORIGIN, 'en', SEGMENT)).toBeNull()
  })

  it('untranslated item: its it-slug is not a page in en, and the en text falls back to it only as TEXT', () => {
    expect(entries.get(`item:${itOnly.id}:en`)!.kind).toBe('notFound') // looked up as `${id}-en`
    const wrongLocale = (async () => resolveCatalogueEntry(fetchForTenant, itOnly.id, ctxFor('en')))()
    return wrongLocale.then((e) => expect(e.kind).toBe('notFound'))
  })

  it('translated item: the it slug is NOT a page in en either (no slug fallback)', async () => {
    expect((await resolveCatalogueEntry(fetchForTenant, translated.id, ctxFor('en'))).kind).toBe('notFound')
  })

  it('hreflang + slug map: translated has it, en, x-default; untranslated has it, x-default only', () => {
    const alt = (k: Kind) => {
      const entry = entries.get(`item:${k.id}:it`)!
      if (entry.kind !== 'item') throw new Error('page did not resolve')
      return {
        entry,
        alternates: catalogueAlternates({
          origin: ORIGIN,
          locale: 'it',
          defaultLocale: 'it',
          supportedLocales: LOCALES,
          segment: SEGMENT,
          page: entry.item.page,
        }),
      }
    }
    const t = alt(translated)
    expect(Object.keys(t.alternates.languages!).sort()).toEqual(['en', 'it', 'x-default'])
    expect(t.alternates.languages!.en).toBe(`${ORIGIN}/en/${SEGMENT}/${translated.id}-en`)
    expect(catalogueSlugMap(t.entry.item.page, SEGMENT)).toEqual({ it: `${SEGMENT}/${translated.id}`, en: `${SEGMENT}/${translated.id}-en` })

    const u = alt(itOnly)
    expect(Object.keys(u.alternates.languages!).sort()).toEqual(['it', 'x-default'])
    expect(JSON.stringify(u.alternates)).not.toContain('/en/')
    expect(catalogueSlugMap(u.entry.item.page, SEGMENT)).toEqual({ it: `${SEGMENT}/${itOnly.id}` })
  })

  it('JSON-LD in en: translated item carries its en URL, untranslated carries none (not the it one)', () => {
    const dto = byId.get('public-live:en')!
    const ld = catalogueCollectionJsonLd(dto, {
      url: `${ORIGIN}/en/${SEGMENT}/c-public-live-en`,
      locale: 'en',
      itemUrl: (i) => catalogueItemCanonical(i, ORIGIN, 'en', SEGMENT),
    })
    const t = nodesNamed(ld, translated.id).filter((n) => n['@type'] === 'MenuItem')
    expect(t.length).toBeGreaterThan(0)
    expect(t.every((n) => n.url === `${ORIGIN}/en/${SEGMENT}/${translated.id}-en`)).toBe(true)
    const u = nodesNamed(ld, itOnly.id).filter((n) => n['@type'] === 'MenuItem')
    expect(u.length).toBeGreaterThan(0)
    expect(u.every((n) => n.url === undefined)).toBe(true)
  })

  it('sitemap + llms: the it-only item is listed in it and never in en', () => {
    expect(sitemapUrls.has(`${ORIGIN}/it/${SEGMENT}/${itOnly.id}`)).toBe(true)
    expect([...sitemapUrls].some((u) => u.includes(`/en/${SEGMENT}/${itOnly.id}`))).toBe(false)
    expect(llmsText.it).toContain(`/it/${SEGMENT}/${itOnly.id})`)
    expect(llmsText.en).not.toContain(itOnly.id)
  })

  it('the landing page is in the sitemap for every locale', () => {
    for (const l of LOCALES) expect(sitemapUrls.has(`${ORIGIN}/${l}/${SEGMENT}`)).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// D. STRUCTURE - sections survive on the page, are pruned in structured data
// ═════════════════════════════════════════════════════════════════════════════

describe('D. sections: explicit contents keep everything live; structured data prunes what it withholds', () => {
  it('the page keeps the unlisted-only section and the empty one (A7, AC 19)', () => {
    const dto = byId.get('public-live:it')!
    expect(dto.sections.map((s) => s.name)).toEqual(['Tutto', 'Solo unlisted', 'Vuota'])
    expect(dto.sections[1].items.map((i) => i.publicId)).toEqual(['unlisted-live'])
  })

  it('JSON-LD drops the section that only held an unlisted item, keeps the section that was empty to begin with', () => {
    const ld = catalogueCollectionJsonLd(byId.get('public-live:it')!, { url: `${ORIGIN}/it/${SEGMENT}/c-public-live`, locale: 'it' })!
    const names = (ld.hasMenuSection as { name: string }[]).map((s) => s.name)
    expect(names).toEqual(['Tutto', 'Vuota'])
    expect(JSON.stringify(ld)).not.toContain('unlisted-live')
  })

  it('an unlisted collection is reachable by link but yields no JSON-LD and no sitemap/llms entry', () => {
    const k = kindById('unlisted-live')
    expect(bySlugRows.get(`collection:${k.id}:it`)!.kind).toBe('collection')
    expect(catalogueCollectionJsonLd(byId.get('unlisted-live:it')!, { url: 'x', locale: 'it' })).toBeNull()
    expect(sitemapUrls.has(`${ORIGIN}/it/${SEGMENT}/c-unlisted-live`)).toBe(false)
    expect(llmsText.it).not.toContain('c-unlisted-live')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// E. LIFECYCLE AND VISIBILITY STAY SEPARATE (C11)
// ═════════════════════════════════════════════════════════════════════════════

describe('E. the visibility helper never carries lifecycle terms; the lifecycle filter never carries visibility', () => {
  const LIFECYCLE_TERMS = /publishedAt|expiresAt|archivedAt|now\(\)/
  const CONTEXTS: CatalogueDeliveryContext[] = ['automaticListing', 'explicitReference', 'partner', 'sitemap', 'structuredData']

  it.each(CONTEXTS)('visibilityFilter(%s) has no lifecycle terms, also with a path prefix', (ctx) => {
    expect(visibilityFilter(ctx)).not.toMatch(LIFECYCLE_TERMS)
    expect(visibilityFilter(ctx, '@->')).not.toMatch(LIFECYCLE_TERMS)
  })

  it.each(['catalogueItem', 'catalogueCollection', 'catalogueOptionList', 'cataloguePage'] as const)(
    'publicFilterFor(%s) has no visibility terms, also with a path prefix',
    (type) => {
      expect(publicFilterFor(type)).not.toMatch(/visibility|unlisted|websiteOnly/)
      expect(publicFilterFor(type, '@->')).not.toMatch(/visibility|unlisted|websiteOnly/)
    },
  )

  it('the table in this file and the helper agree on every context x visibility', () => {
    const map: Record<Context, CatalogueDeliveryContext> = {
      explicitCollection: 'explicitReference',
      ownPage: 'explicitReference', // direct link: nothing narrows it (visibility only adds noindex)
      sitemap: 'sitemap',
      llms: 'structuredData',
      structuredData: 'structuredData',
      automaticListing: 'automaticListing',
      partner: 'partner',
    }
    for (const c of Object.keys(LIVE_REACH) as Context[]) {
      VISIBILITIES.forEach((v, i) => expect([c, v, admits(map[c], v)]).toEqual([c, v, LIVE_REACH[c][i]]))
    }
  })

  it('a missing visibility is public in TS and in GROQ', () => {
    expect(admits('partner', undefined)).toBe(true)
    expect(groqSets.partner.items.has('novis-live')).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// F. SEGMENT HISTORY - redirects keep path and locale; many changes; revert
// ═════════════════════════════════════════════════════════════════════════════

describe('F. historic segment redirects', () => {
  /**
   * The route (CatalogueRoute.tsx) turns `dispatch.to` into
   *   permanentRedirect(`${siteBase}/${dispatch.to.map(encodeURIComponent).join('/')}`)
   * with siteBase = siteBasePath(locale, tenant, hostScoped) - the LOCALE prefix
   * is therefore part of every target. Replicated here (the component imports
   * next/navigation and cannot be rendered in a unit test); the guard test
   * below fails if the route's formula changes.
   */
  const target = (to: string[], locale: Locale, hostScoped = false) =>
    `${siteBasePath(locale, PROJECT, hostScoped)}/${to.map(encodeURIComponent).join('/')}`

  it('guard: the route still builds redirects exactly like this file does', () => {
    const src = readFileSync(resolvePath(__dirname, '../../../../components/catalogue/CatalogueRoute.tsx'), 'utf8')
    expect(src).toContain("permanentRedirect(`${siteBase}/${dispatch.to.map(encodeURIComponent).join('/')}`)")
  })

  const paths: [string, string[], string[]][] = [
    ['landing', ['carta'], [SEGMENT]],
    ['collection', ['carta', 'c-public-live'], [SEGMENT, 'c-public-live']],
    ['item', ['carta', 'public-live'], [SEGMENT, 'public-live']],
    ['deeper path (rest preserved)', ['carta', 'a', 'b'], [SEGMENT, 'a', 'b']],
  ]

  describe.each(LOCALES)('locale %s', (locale) => {
    it.each(paths)('%s: /carta/... redirects to the current segment, same path, locale kept', (_n, from, to) => {
      const plan = planCatalogueRoute(from, config) // config comes from the dataset (history ['carta'])
      expect(plan).toEqual({ kind: 'redirect', to })
      expect(target((plan as { to: string[] }).to, locale)).toBe(`/${locale}/${PROJECT}/${to.join('/')}`)
      expect(target((plan as { to: string[] }).to, locale, true)).toBe(`/${locale}/${to.join('/')}`) // own host: no project segment
    })

    it('the current segment is served, never redirected', () => {
      expect(planCatalogueRoute([SEGMENT], config)).toEqual({ kind: 'landing' })
      expect(planCatalogueRoute([SEGMENT, 'public-live'], config)).toEqual({ kind: 'entry', slug: 'public-live' })
      expect(planCatalogueRoute(['other'], config)).toBeNull()
    })
  })

  it('a slug with reserved characters is encoded in the target, decoded for matching', () => {
    expect(planCatalogueRoute(['carta', 'caff%C3%A8'], config)).toEqual({ kind: 'redirect', to: [SEGMENT, 'caffè'] })
    expect(target([SEGMENT, 'caffè'], 'it')).toBe(`/it/${PROJECT}/${SEGMENT}/caff%C3%A8`)
  })

  it('multiple changes: menu -> carta -> menu-2026, BOTH old segments redirect to the live one', () => {
    const a = applySegmentChange('menu', [], 'carta')
    expect(a).toEqual({ segment: 'carta', history: ['menu'] })
    const b = applySegmentChange(a.segment, a.history, 'menu-2026')
    expect(b).toEqual({ segment: 'menu-2026', history: ['menu', 'carta'] })
    for (const old of ['menu', 'carta']) {
      expect(dispatchCatalogue([old], b.segment, b.history)).toEqual({ kind: 'redirect', to: ['menu-2026'] })
      expect(dispatchCatalogue([old, 'x'], b.segment, b.history)).toEqual({ kind: 'redirect', to: ['menu-2026', 'x'] })
      expect(dispatchCatalogue([old, 'x', 'y'], b.segment, b.history)).toEqual({ kind: 'redirect', to: ['menu-2026', 'x', 'y'] })
    }
    expect(dispatchCatalogue(['menu-2026'], b.segment, b.history)).toEqual({ kind: 'landing' })
  })

  it('revert: setting a historic segment back removes it from the history (no redirect loop) and keeps the others', () => {
    const live = { segment: 'menu-2026', history: ['menu', 'carta'] }
    const back = applySegmentChange(live.segment, live.history, 'menu')
    expect(back).toEqual({ segment: 'menu', history: ['carta', 'menu-2026'] })
    expect(dispatchCatalogue(['menu', 'x'], back.segment, back.history)).toEqual({ kind: 'entry', slug: 'x' })
    expect(dispatchCatalogue(['carta', 'x'], back.segment, back.history)).toEqual({ kind: 'redirect', to: ['menu', 'x'] })
    expect(dispatchCatalogue(['menu-2026', 'x'], back.segment, back.history)).toEqual({ kind: 'redirect', to: ['menu', 'x'] })

    const toOldest = applySegmentChange(back.segment, back.history, 'carta')
    expect(toOldest.segment).toBe('carta')
    expect(toOldest.history).not.toContain('carta')
    expect(dispatchCatalogue(['carta'], toOldest.segment, toOldest.history)).toEqual({ kind: 'landing' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// G. CURRENCY WARNING
// ═════════════════════════════════════════════════════════════════════════════

describe('G. currency change warning', () => {
  it('counts prices and items (a draft supersedes its published copy) and option deltas (zeros ignored)', () => {
    const items = [
      { _id: 'i1', prices: [8, 9.5] },
      { _id: 'i2', prices: [] },
      { _id: 'i3', prices: [3] },
      { _id: 'drafts.i3', prices: [3, 4] }, // the draft is what gets published next
      { _id: 'i4', prices: null },
    ]
    const lists = [
      { _id: 'l1', deltas: [1.5, 2, 0] },
      { _id: 'l2', deltas: [] },
    ]
    expect(currencyImpact(items, lists)).toEqual({ prices: 4, items: 2, optionDeltas: 2, optionLists: 1 })
    expect(currencyChangeNeedsConfirmation(currencyImpact(items, lists))).toBe(true)
    expect(currencyChangeNeedsConfirmation(currencyImpact(items.slice(1, 2), []))).toBe(false)
  })

  it('option deltas alone still need confirmation', () => {
    expect(currencyChangeNeedsConfirmation(currencyImpact([], [{ _id: 'l', deltas: [0.5] }]))).toBe(true)
  })

  const load = (l: string) =>
    JSON.parse(readFileSync(resolvePath(__dirname, `../../../../../messages/${l}.json`), 'utf8')) as {
      catalogue: { currency: Record<string, string> }
    }

  it.each(['en', 'it', 'de'])('%s has both warning keys with their placeholders', (l) => {
    const c = load(l).catalogue.currency
    expect(c.changeWarning).toEqual(expect.stringContaining('{prices'))
    expect(c.changeWarning).toEqual(expect.stringContaining('{items'))
    expect(c.changeWarning).toEqual(expect.stringContaining('{currency}'))
    expect(c.changeWarningOptions).toEqual(expect.stringContaining('{count'))
  })

  it('every language says nothing is converted', () => {
    expect(load('en').catalogue.currency.changeWarning).toContain('No amounts are converted')
    expect(load('en').catalogue.currency.changeWarning).toMatch(/not converted|No amounts are converted/)
    expect(load('it').catalogue.currency.changeWarning).toMatch(/Nessun importo viene convertito/)
    expect(load('de').catalogue.currency.changeWarning).toMatch(/keine Beträge umgerechnet/)
  })
})

describe('H. a book on its own page (Amendment I)', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    _id: 'catalogueItem-guida',
    _type: 'catalogueItem',
    projectSlug: PROJECT,
    publicId: 'guida',
    itemProfile: 'book',
    hasPage: true,
    name: { it: 'Guida galattica' },
    slug: slugField('guida-galattica', false),
    bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '9780345391803' },
    ...lifecycleFields('live'),
    ...over,
  })
  const read = async (d: Record<string, unknown>) => {
    const dataset = [...PUBLISHED, d]
    const p = { projectSlug: PROJECT, locale: 'it', defaultLocale: 'it' }
    const fetchOwn: CatalogueFetch = async (query, params) => {
      const q = { ...p, ...params }
      return (await (await evaluate(parse(query, { params: q }), { dataset, params: q, timestamp: NOW })).get()) as never
    }
    return resolveCatalogueEntry(fetchOwn, 'guida-galattica', ctxFor('it'))
  }

  it('a live public book resolves with its details and emits Book (valid without an offer)', async () => {
    const e = await read(doc())
    expect(e.kind).toBe('item')
    if (e.kind !== 'item') return
    expect(e.item.itemProfile).toBe('book')
    expect(e.item.byline).toBe('Douglas Adams')
    expect(e.item.bookDetails).toEqual({ author: 'Douglas Adams', publisher: null, year: 1979, isbn: '9780345391803' })
    const ld = catalogueItemJsonLd(e.item, { url: `${ORIGIN}/it/menu/guida-galattica`, locale: 'it' })!
    expect(ld['@type']).toBe('Book')
    expect(ld).toMatchObject({ isbn: '9780345391803', datePublished: '1979' })
  })

  it('Amendment K: publisher, buy and affiliate links travel through the real query; an old link without kind stays info; JSON-LD names the publisher', async () => {
    const e = await read(
      doc({
        bookDetails: { author: 'Douglas Adams', publisher: 'Pan Books', year: 1979 },
        links: [
          { _key: 'l1', _type: 'catalogueItemLink', label: { it: 'Scheda' }, url: 'https://example.com/scheda' },
          { _key: 'l2', _type: 'catalogueItemLink', label: { it: 'Acquista su Libreria' }, url: 'https://shop.example.com/b', kind: 'buy', affiliate: true },
          { _key: 'l3', _type: 'catalogueItemLink', url: 'https://shop.example.com/c', kind: 'buy' },
        ],
      }),
    )
    expect(e.kind).toBe('item')
    if (e.kind !== 'item') return
    expect(e.item.bookDetails).toEqual({ author: 'Douglas Adams', publisher: 'Pan Books', year: 1979, isbn: null })
    expect(e.item.links.map((l) => [l.key, l.kind, l.affiliate, l.label])).toEqual([
      ['l1', 'info', false, 'Scheda'],
      ['l2', 'buy', true, 'Acquista su Libreria'],
      ['l3', 'buy', false, ''],
    ])
    const ld = catalogueItemJsonLd(e.item, { url: `${ORIGIN}/it/menu/guida-galattica`, locale: 'it' })!
    expect(ld).toMatchObject({ publisher: { '@type': 'Organization', name: 'Pan Books' } })
  })

  it('Amazon links travel through the real query (moreUrls, old link untouched) and are rewritten per visitor country with the tenant ID', async () => {
    const e = await read(
      doc({
        links: [
          { _key: 'a1', _type: 'catalogueItemLink', url: 'https://www.amazon.it/Libro/dp/B08N5WRWNW/ref=sr_1?keywords=x', kind: 'buy', moreUrls: ['https://www.amazon.de/dp/B0DEDEDEDE'] },
          { _key: 'a2', _type: 'catalogueItemLink', label: { it: 'Scheda' }, url: 'https://example.com/scheda' },
          { _key: 'a3', _type: 'catalogueItemLink', url: 'https://shop.example.com/c', kind: 'buy', affiliate: true },
        ],
      }),
    )
    expect(e.kind).toBe('item')
    if (e.kind !== 'item') return
    expect(e.item.links[0].moreUrls).toEqual(['https://www.amazon.de/dp/B0DEDEDEDE'])
    expect(e.item.links[1]).not.toHaveProperty('moreUrls')
    const ids = [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }, { marketplace: 'amazon.de', trackingId: 'tmzde-21' }]
    const hrefs = (country: string | null) => localizeItem(e.item, { country, trackingIds: ids }).links.map((l) => [l.url, l.affiliate, l.amazon ?? false])
    expect(hrefs('DE')).toEqual([['https://www.amazon.de/dp/B0DEDEDEDE?tag=tmzde-21', true, true], ['https://example.com/scheda', false, false], ['https://shop.example.com/c', true, false]])
    expect(hrefs('IT')[0]).toEqual(['https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21', true, true])
    expect(hrefs(null)[0]).toEqual(['https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21', true, true])
    // The delivered DTO itself is never mutated: the next visitor starts from the stored link.
    expect(e.item.links[0].url).toContain('amazon.it/Libro/dp/B08N5WRWNW')
  })

  it('the same document read as a product (older deployment) is a plain product page with no offer: no item node, no failure', async () => {
    const e = await read(doc({ itemProfile: 'pamphlet' }))
    expect(e.kind).toBe('item')
    if (e.kind !== 'item') return
    expect(e.item.itemProfile).toBe('product')
    expect(catalogueItemJsonLd(e.item, { url: ORIGIN, locale: 'it' })).toBeNull()
  })

  it('lifecycle and visibility rules are the same as for every item: draft and unlisted', async () => {
    expect((await read(doc({ ...lifecycleFields('scheduled') }))).kind).toBe('notFound')
    expect((await read(doc({ ...lifecycleFields('archived') }))).kind).toBe('notFound')
    const unlisted = await read(doc({ visibility: 'unlisted' }))
    expect(unlisted.kind).toBe('item')
    if (unlisted.kind === 'item') expect(catalogueItemJsonLd(unlisted.item, { url: ORIGIN, locale: 'it' })).toBeNull()
  })
})

describe('I. category vocabulary: term records replace the config list (Amendment J dual-read)', () => {
  const CONFIG_CATEGORIES = [
    { _key: 'c1', value: 'pizza', color: '#c00', label: { it: 'Pizze', en: 'Pizzas' } },
    { _key: 'c2', value: 'dolci', label: { it: 'Dolci' } },
  ]
  const term = (key: string, order: number, label: Record<string, string>, extra: Record<string, unknown> = {}, project = PROJECT, kind = 'category', module = 'catalogue') => ({
    _id: `term.${project}.${module}.${kind}.${key}`,
    _type: 'taxonomyTerm',
    projectSlug: project,
    module,
    kind,
    key,
    order,
    label,
    ...extra,
  })
  const withCategories = (extra: Record<string, unknown>[], list = CONFIG_CATEGORIES): Record<string, unknown>[] => [
    ...PUBLISHED.map((d) =>
      d._type === 'project'
        ? { ...d, moduleInstallations: (d.moduleInstallations as { config: object }[]).map((m) => ({ ...m, config: { ...m.config, categories: list } })) }
        : d,
    ),
    ...extra,
  ]
  const configFrom = async (dataset: Record<string, unknown>[], locale: Locale) => {
    const p = { projectSlug: PROJECT, locale, defaultLocale: DEFAULT_LOCALE }
    const value = await evaluate(parse(catalogueModuleConfigQuery, { params: p }), { dataset, params: p, timestamp: NOW })
    return resolveCatalogueConfig((await value.get()) as never, locale, DEFAULT_LOCALE)!
  }

  it('no term records: the config list is read exactly as before', async () => {
    const c = await configFrom(withCategories([]), 'en')
    expect(c.categories).toEqual([
      { value: 'pizza', label: 'Pizzas', color: '#c00' },
      { value: 'dolci', label: 'Dolci', color: null },
    ])
  })

  it('term records with the identical keys and labels resolve to an identical vocabulary, in every locale', async () => {
    const terms = [
      term('pizza', 1000, { it: 'Pizze', en: 'Pizzas' }, { color: '#c00' }),
      term('dolci', 2000, { it: 'Dolci' }),
    ]
    for (const l of LOCALES) {
      expect((await configFrom(withCategories(terms), l)).categories).toEqual((await configFrom(withCategories([]), l)).categories)
    }
  })

  it('term records win entirely: no mixing with the config list, ordered by `order`', async () => {
    const terms = [term('romanzi', 2000, { it: 'Romanzi' }), term('saggi', 1000, { it: 'Saggi', en: 'Essays' })]
    const c = await configFrom(withCategories(terms), 'en')
    expect(c.categories.map((t) => t.value)).toEqual(['saggi', 'romanzi'])
    expect(c.categories.map((t) => t.label)).toEqual(['Essays', 'Romanzi'])
  })

  it('another project, another module, another kind and a draft never leak in', async () => {
    const stray = [
      term('altro', 1, { it: 'Altro' }, {}, 'other-project'),
      term('blogcat', 1, { it: 'Blog' }, {}, PROJECT, 'category', 'blog'),
      term('etichetta', 1, { it: 'Tag' }, {}, PROJECT, 'tag'),
      { ...term('bozza', 1, { it: 'Bozza' }), _id: `drafts.term.${PROJECT}.catalogue.category.bozza` },
    ]
    const c = await configFrom(withCategories(stray), 'it')
    expect(c.categories.map((t) => t.value)).toEqual(['pizza', 'dolci'])
  })

  it('an item resolves its categories identically from the config list and from term records', async () => {
    const viaConfig = await configFrom(withCategories([]), 'it')
    const viaTerms = await configFrom(withCategories([term('pizza', 1000, { it: 'Pizze', en: 'Pizzas' }, { color: '#c00' }), term('dolci', 2000, { it: 'Dolci' })]), 'it')
    const item = { categories: ['dolci', 'pizza', 'gone'], visibility: 'public', publishedAt: LONG_AGO } as never
    const a = resolveItem(item, { ...ctxFor('it'), config: viaConfig })
    const b = resolveItem(item, { ...ctxFor('it'), config: viaTerms })
    expect(b?.categories).toEqual(a?.categories)
    expect(a?.categories.map((t) => t.value)).toEqual(['dolci', 'pizza'])
  })
})

describe('J. tags on the item page (Amendment J slice 7)', () => {
  const tagTerm = (key: string, order: number, label: Record<string, string>, project = PROJECT, kind = 'tag', module = 'catalogue') => ({
    _id: `term.${project}.${module}.${kind}.${key}`, _type: 'taxonomyTerm', projectSlug: project, module, kind, key, order, label,
  })
  const itemDoc = (over: Record<string, unknown> = {}) => ({
    _id: 'catalogueItem-tagged', _type: 'catalogueItem', projectSlug: PROJECT, publicId: 'tagged', itemProfile: 'product', hasPage: true,
    name: { it: 'Tagged' }, slug: slugField('tagged', false), tags: ['regalo', 'rarita', 'gone'], ...lifecycleFields('live'), ...over,
  })
  const run = async (items: Record<string, unknown>[], terms: Record<string, unknown>[], locale: Locale = 'it') => {
    const dataset = [...PUBLISHED, ...terms, ...items]
    const p = { projectSlug: PROJECT, locale, defaultLocale: DEFAULT_LOCALE }
    const cfgValue = await evaluate(parse(catalogueModuleConfigQuery, { params: p }), { dataset, params: p, timestamp: NOW })
    const config = resolveCatalogueConfig((await cfgValue.get()) as never, locale, DEFAULT_LOCALE)!
    const fetchOwn: CatalogueFetch = async (query, params) => {
      const q = { ...p, ...params }
      return (await (await evaluate(parse(query, { params: q }), { dataset, params: q, timestamp: NOW })).get()) as never
    }
    const e = await resolveCatalogueEntry(fetchOwn, 'tagged', { ...ctxFor(locale), config })
    return { e, config }
  }
  const TERMS = [tagTerm('rarita', 2000, { it: 'Rarità', en: 'Rarity' }), tagTerm('regalo', 1000, { it: 'Regalo' })]

  it('shows the item\'s tags with labels in the vocabulary order of the item, unknown keys dropped', async () => {
    const { e } = await run([itemDoc()], TERMS)
    expect(e.kind).toBe('item')
    if (e.kind !== 'item') return
    expect(e.item.tags.map((t) => t.value)).toEqual(['regalo', 'rarita'])
    expect(e.item.tags.map((t) => t.label)).toEqual(['Regalo', 'Rarità'])
  })

  it('label fallback: a missing locale uses the default language', async () => {
    const { e } = await run([itemDoc()], TERMS, 'en')
    // 'en' has no slug for the item; the vocabulary itself still falls back per term.
    const { config } = await run([itemDoc()], TERMS, 'en')
    expect(config.tags.map((t) => t.label)).toEqual(['Regalo', 'Rarity'])
    expect(e.kind === 'item' || e.kind === 'notFound').toBe(true)
  })

  it('terms of another project, module or kind (category) never become tags', async () => {
    const stray = [
      tagTerm('regalo', 1, { it: 'Regalo' }),
      tagTerm('rarita', 1, { it: 'Altro progetto' }, 'other-project'),
      tagTerm('gone', 1, { it: 'Blog' }, PROJECT, 'tag', 'blog'),
      tagTerm('categoria', 1, { it: 'Cat' }, PROJECT, 'category'),
      { ...tagTerm('bozza', 1, { it: 'Bozza' }), _id: `drafts.term.${PROJECT}.catalogue.tag.bozza` },
    ]
    const { config } = await run([itemDoc({ tags: ['regalo', 'rarita', 'gone', 'categoria', 'bozza'] })], stray)
    expect(config.tags.map((t) => t.value)).toEqual(['regalo'])
  })

  it('an unpublished (archived) item with tags is not delivered', async () => {
    const { e } = await run([itemDoc({ ...lifecycleFields('archived') })], TERMS)
    expect(e.kind).toBe('notFound')
  })

  it('no tag terms: the item has no tags and nothing breaks', async () => {
    const { e, config } = await run([itemDoc()], [])
    expect(config.tags).toEqual([])
    if (e.kind === 'item') expect(e.item.tags).toEqual([])
  })
})

// ── Listing section source "all": the automaticListing column, through the real query ──
describe('listing section, source "all" — automaticListing through catalogueAllItemsQuery', () => {
  for (const l of LOCALES) {
    it(`${l}: exactly the live public + websiteOnly items (unlisted and non-live absent)`, async () => {
      const d = await hydrateCatalogueListing(fetchForTenant, null, ctxFor(l), {}, 'all')
      const got = new Set(flatItems(d.collection?.sections ?? []).map((i) => i.publicId))
      const want = new Set(KINDS.filter((k) => reachesContext('automaticListing', k)).map(idOf))
      expect(got).toEqual(want)
    })
  }
})
