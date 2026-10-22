// ── Catalogue — website delivery (ADR-033 C1, C2, C5, C6, C10; spec §6) ───────
//
// The server-side half of the public website: what the catch-all route, the
// listing section's hydration, generateMetadata and the sitemap need, as
// functions of an injected `fetchForTenant` so every branch is testable
// without Next.js or Sanity.
//
// Everything that decides WHAT is public lives elsewhere and is composed here:
//   segment.ts     dispatchCatalogue — the C2 table
//   resolve.ts     rows → DTO, with the lifecycle rule re-checked in TypeScript
//   visibility.ts  isIndexable — the C5/C10 table (never hand-written here)
//   queries.ts     the GROQ, each read carrying publicFilterFor (ADR-032 D3)

import {
  affiliateSettingsQuery,
  catalogueAllItemsQuery,
  catalogueCollectionByIdQuery,
  catalogueCollectionByOldSlugQuery,
  catalogueCollectionBySlugQuery,
  catalogueItemByOldSlugQuery,
  catalogueItemBySlugQuery,
  catalogueModuleConfigQuery,
  cataloguePageQuery,
} from '@/lib/sanity/queries'
import { canonicalUrl, hreflangAlternates } from '@/lib/seo/canonical'
import type {
  CatalogueCollectionDTO,
  CatalogueConfigDTO,
  CatalogueItemDTO,
  CatalogueItemPageDTO,
  CataloguePageDTO,
  CataloguePageRefDTO,
} from './dto'
import {
  resolveCatalogueConfig,
  resolveCataloguePage,
  resolveCollection,
  resolveItemPage,
  type CatalogueResolveContext,
  type RawCatalogueCollection,
  type RawCatalogueItem,
  type RawCatalogueConfigRow,
  type RawCatalogueItemPage,
  type RawCataloguePage,
} from './resolve'
import { dispatchCatalogue, type CatalogueDispatch } from './segment'
import { collectionHasAmazon } from './amazon-delivery'
import { collectionHasShop, deliverCollection } from './shop-delivery'
import { shopOrder, type AffiliateSettings } from '@/lib/affiliate/affiliate-settings'
import type { AffiliateShopId } from '@/lib/affiliate/shops'
import { isIndexable } from './visibility'

export type CatalogueFetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

type LocaleParams = { locale: string; defaultLocale: string }

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * The enabled catalogue installation's config for this project, or null when
 * the module is not installed or is switched off. Null means: no dispatch, no
 * listing section, nothing.
 */
export async function loadCatalogueConfig(
  fetchForTenant: CatalogueFetch,
  { locale, defaultLocale }: LocaleParams,
): Promise<CatalogueConfigDTO | null> {
  const row = await fetchForTenant<RawCatalogueConfigRow>(catalogueModuleConfigQuery, { locale, defaultLocale })
  return resolveCatalogueConfig(row, locale, defaultLocale)
}

/** The C2 dispatch, but only for a project whose catalogue is enabled. */
export function planCatalogueRoute(
  segments: readonly string[],
  config: CatalogueConfigDTO | null,
): CatalogueDispatch | null {
  if (!config?.segment) return null
  return dispatchCatalogue(segments.map(safeDecode), config.segment, config.segmentHistory)
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ── Entry resolution: item → collection → item redirect → collection redirect ─

export type CatalogueEntry =
  | { kind: 'item'; item: CatalogueItemPageDTO }
  | { kind: 'collection'; collection: CatalogueCollectionDTO }
  /** A retired slug in this locale (redirectFrom): 301 to the current one. */
  | { kind: 'redirect'; slug: string }
  | { kind: 'notFound' }

/**
 * `/{segment}/{slug}` → what it is. The order is ADR-033 C2's, verbatim:
 * item, collection, item redirect, collection redirect, nothing. Items and
 * collections share one slug namespace (D11.1), so at most one primary
 * lookup can match a valid dataset; the order only matters for a broken one.
 */
export async function resolveCatalogueEntry(
  fetchForTenant: CatalogueFetch,
  slug: string,
  ctx: CatalogueResolveContext,
): Promise<CatalogueEntry> {
  const params = { slug, locale: ctx.locale, defaultLocale: ctx.defaultLocale ?? ctx.locale }

  const itemRow = await fetchForTenant<RawCatalogueItemPage | null>(catalogueItemBySlugQuery, params)
  const item = resolveItemPage(itemRow, ctx)
  if (item) return { kind: 'item', item }

  const collectionRow = await fetchForTenant<RawCatalogueCollection | null>(catalogueCollectionBySlugQuery, params)
  const collection = collectionRow && collectionRow.hasPage === true ? resolveCollection(collectionRow, ctx) : null
  if (collection?.page) return { kind: 'collection', collection }

  const oldItem = await fetchForTenant<{ currentSlug?: string | null } | null>(catalogueItemByOldSlugQuery, params)
  if (oldItem?.currentSlug && oldItem.currentSlug !== slug) return { kind: 'redirect', slug: oldItem.currentSlug }

  const oldCollection = await fetchForTenant<{ currentSlug?: string | null } | null>(catalogueCollectionByOldSlugQuery, params)
  if (oldCollection?.currentSlug && oldCollection.currentSlug !== slug) return { kind: 'redirect', slug: oldCollection.currentSlug }

  return { kind: 'notFound' }
}

/** The landing page at `/{segment}` — null when absent or not public (C1). */
export async function loadCataloguePage(
  fetchForTenant: CatalogueFetch,
  { locale, defaultLocale }: LocaleParams,
): Promise<CataloguePageDTO | null> {
  const row = await fetchForTenant<RawCataloguePage | null>(cataloguePageQuery, { locale, defaultLocale })
  return resolveCataloguePage(row, locale, defaultLocale)
}

// ── Listing section hydration ─────────────────────────────────────────────────

/** What a hydrated catalogueListingSection carries (types.ts `catalogue`). */
export type CatalogueListingData = {
  /** null = no collection chosen, or the collection is not public: render nothing. */
  collection: CatalogueCollectionDTO | null
  /** The public segment, for item links (C6). null = no routes. */
  segment: string | null
  /** Config default for sections that leave showPrices unset. */
  showPricesByDefault: boolean
  /** Amendment K — the catalogue's own affiliate disclosure for this locale, or null. */
  affiliateDisclosure: string | null
  /** The tenant's shop order for buy links (only set when the listing has a shop link). */
  shopOrder?: AffiliateShopId[]
}

/**
 * One section's data. `config` is loaded once per page by the caller. A
 * collection is an explicit editorial pick, so `unlisted` items inside it are
 * shown (C5 explicitReference); the lifecycle rule always applies (in GROQ and
 * again in resolveCollection).
 */
export async function hydrateCatalogueListing(
  fetchForTenant: CatalogueFetch,
  collectionId: string | null | undefined,
  ctx: CatalogueResolveContext,
  /**
   * The visitor's country for Amazon links, injected by the (server-only)
   * caller. This module is also reached from the Studio/client bundle through
   * the section registry, so it must never import `next/headers` itself.
   */
  deps: { visitorCountry?: () => Promise<string | null> } = {},
  /**
   * 'all' = every published item of the project; 'collection' = `collectionId`.
   * Unset (a section saved before the choice existed): the collection if one
   * is set, otherwise everything.
   */
  source?: 'all' | 'collection' | null,
): Promise<CatalogueListingData> {
  const base = { segment: ctx.config.segment, showPricesByDefault: ctx.config.showPricesByDefault, affiliateDisclosure: ctx.config.affiliateDisclosure }
  const params = { locale: ctx.locale, defaultLocale: ctx.defaultLocale ?? ctx.locale }
  const wantsAll = listingSourceIsAll(source, collectionId)
  if (!wantsAll && !collectionId) return { ...base, collection: null }
  const row = wantsAll
    ? await fetchAllItemsAsCollection(fetchForTenant, params, ctx.now)
    : await fetchForTenant<RawCatalogueCollection | null>(catalogueCollectionByIdQuery, { collectionId, ...params })
  const collection = resolveCollection(row, ctx)
  if (!collection || !collectionHasShop(collection)) return { ...base, collection }
  // Shop buy links (Amazon, Awin shops) are rewritten PER REQUEST (visitor country for Amazon + the tenant's
  // affiliate settings). The page is rendered dynamically for every request, so one visitor's pick never
  // reaches another. The country is read only when an Amazon link is present.
  const [country, settings] = await Promise.all([
    collectionHasAmazon(collection) && deps.visitorCountry ? deps.visitorCountry() : Promise.resolve(null),
    fetchForTenant<AffiliateSettings | null>(affiliateSettingsQuery, {}).catch(() => null),
  ])
  const s = settings && typeof settings === 'object' ? settings : null
  return { ...base, collection: deliverCollection(collection, { country, settings: s }), shopOrder: shopOrder(s) }
}

/** 'all' wins when chosen; a legacy section (no source) is 'all' only when it has no collection. */
export function listingSourceIsAll(source: unknown, collectionId: string | null | undefined): boolean {
  if (source === 'all') return true
  if (source === 'collection') return false
  return !collectionId
}

/**
 * Every publicly visible item as ONE unnamed section of a synthetic collection,
 * so the "all" listing renders through exactly the collection path (cards,
 * Amazon localisation, disclosure). Capped by CATALOGUE_ALL_ITEMS_LIMIT in GROQ;
 * resolveCollection still re-checks the lifecycle rule per item.
 */
async function fetchAllItemsAsCollection(
  fetchForTenant: CatalogueFetch,
  params: Record<string, unknown>,
  now: Date,
): Promise<RawCatalogueCollection> {
  const items = await fetchForTenant<RawCatalogueItem[]>(catalogueAllItemsQuery, params)
  return {
    publishedAt: new Date(now.getTime() - 1000).toISOString(),
    visibility: 'public',
    hasPage: false,
    sections: [{ _key: 'all-items', items: Array.isArray(items) ? items : [] }],
  } as RawCatalogueCollection
}

/**
 * ADR-033 D-6 — a listing section's three-state price switch. 'default' (and
 * anything unknown or unset, e.g. a legacy boolean) follows the module setting
 * `showPricesByDefault` at render time, so changing the setting changes every
 * section that never chose otherwise.
 */
export function listingShowsPrices(showPrices: unknown, showPricesByDefault: boolean): boolean {
  if (showPrices === 'show') return true
  if (showPrices === 'hide') return false
  return showPricesByDefault
}

/** ADR-033 D-3 — compact unless the section asks for expanded. There is no "hidden". */
export function listingAllergenPresentation(value: unknown): 'compact' | 'expanded' {
  return value === 'expanded' ? 'expanded' : 'compact'
}

/** Whether a resolved collection has anything to show: at least one item anywhere. */
export function collectionHasItems(collection: CatalogueCollectionDTO | null | undefined): boolean {
  const walk = (sections: CatalogueCollectionDTO['sections']): boolean =>
    sections.some((s) => s.items.length > 0 || walk(s.children))
  return !!collection && walk(collection.sections)
}

// ── URLs ──────────────────────────────────────────────────────────────────────

/**
 * Site-relative href of an item's own page in the REQUEST locale, or null.
 * C6: only where the item has a page AND a slug in this locale — no fallback
 * to another locale's slug, which the no-fallback primary lookup would 404.
 */
export function catalogueItemHref(
  item: Pick<CatalogueItemDTO, 'page'>,
  siteBase: string,
  segment: string | null,
): string | null {
  const slug = item.page?.slug
  if (!segment || !slug) return null
  return `${siteBase}/${segment}/${slug}`
}

/** Absolute canonical URL of an item in `locale`, or null (C6 rule, as above). */
export function catalogueItemCanonical(
  item: Pick<CatalogueItemDTO, 'page'>,
  origin: string | null,
  locale: string,
  segment: string | null,
): string | null {
  const slug = item.page?.slug
  if (!origin || !segment || !slug) return null
  return canonicalUrl(origin, locale, segment, slug) ?? null
}

/** Per-locale `segment/slug` for the language switcher (SlugMapProvider). */
export function catalogueSlugMap(page: CataloguePageRefDTO, segment: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [locale, slug] of Object.entries(page.slugs)) if (slug) out[locale] = `${segment}/${slug}`
  return out
}

/**
 * Canonical + hreflang for a catalogue item or collection page. hreflang only
 * for site locales where the document has a slug (Publicly Routable Content,
 * Req. 3); canonical in the request locale.
 */
export function catalogueAlternates(opts: {
  origin: string | null
  locale: string
  defaultLocale: string
  supportedLocales: readonly string[]
  segment: string
  page: CataloguePageRefDTO
}): { canonical: string | undefined; languages: Record<string, string> | undefined } {
  const { origin, locale, defaultLocale, supportedLocales, segment, page } = opts
  const perLocale: Record<string, string[] | undefined> = {}
  for (const loc of supportedLocales) {
    const slug = page.slugs[loc]
    perLocale[loc] = slug ? [segment, slug] : undefined
  }
  const slug = page.slugs[locale]
  return {
    canonical: slug ? canonicalUrl(origin, locale, segment, slug) : undefined,
    languages: hreflangAlternates(origin, perLocale, defaultLocale),
  }
}

/** Canonical + hreflang for the landing page: the same segment in every site locale. */
export function catalogueLandingAlternates(opts: {
  origin: string | null
  locale: string
  defaultLocale: string
  supportedLocales: readonly string[]
  segment: string
}): { canonical: string | undefined; languages: Record<string, string> | undefined } {
  const { origin, locale, defaultLocale, supportedLocales, segment } = opts
  return {
    canonical: canonicalUrl(origin, locale, segment),
    languages: hreflangAlternates(
      origin,
      Object.fromEntries(supportedLocales.map((l) => [l, [segment]])),
      defaultLocale,
    ),
  }
}

/**
 * robots for an item or collection's own page. `unlisted` resolves by link
 * and is `noindex` (C5, C10 — also for an unlisted COLLECTION). Decided by
 * visibility.ts, never by a hand-written comparison (C11).
 */
export function catalogueRobots(visibility: unknown): { index: false; follow: false } | undefined {
  // Same robots as an unlisted event (ADR-031): reachable by link only.
  return isIndexable(visibility) ? undefined : { index: false, follow: false }
}
