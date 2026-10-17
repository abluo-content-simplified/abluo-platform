// ── Catalogue — structured data / JSON-LD (ADR-033 Amendment B, C6, C10) ──────
//
// Pure: DTO in, schema.org object out. Callers serialise with `safeJsonLd`
// (src/lib/seo/safe-json-ld.ts) — never JSON.stringify into a script tag.
//
// The type is decided by the PAGE (B1), by lookup, never by tenant kind:
//
//   collection, collectionType 'menu'  → Menu → hasMenuSection (nested) → hasMenuItem (MenuItem) → offers
//   collection, collectionType 'list'  → ItemList, or OfferCatalog when any item carries an offer
//   item's own page                    → Product (food or drink, product; only with an Offer — F-3) | Service (service), nested Offer(s)
//
// So the same item is a MenuItem inside a menu and a Product on its own page.
//
// Hidden content emits nothing (B4 / C10):
//   - a document whose own page is not indexable (`unlisted`) → null;
//   - a document not admitted by admits('structuredData', …) → null;
//   - inside a collection, items not admitted by 'structuredData' are OMITTED.
//     Sections that become empty *because of* that omission are dropped (they
//     would otherwise advertise the existence of withheld content); a section
//     that was empty to begin with (AC 19) is kept.
//
// Deliberate non-features: no `sku` (B3); no `offer.currency` (D7/A6 — the
// currency is always the DTO's `effectiveCurrency`, i.e. the project's);
// nothing is converted or parsed from prose.
//
// Offer availability: the DTO's `state` is a time-window result ('available' |
// 'outOfHours' | null = unknown time zone). schema.org availability describes
// STOCK, and a time window evaluated at render time would be wrong in any
// cached page, so every offer is `InStock`; the window is never mapped to
// OutOfStock. (Catalogue V1 has no stock concept.)

import { structuredImageUrl } from '@/lib/gallery/jsonld'
import type {
  CatalogueCollectionDTO,
  CatalogueCollectionType,
  CatalogueImageDTO,
  CatalogueItemDTO,
  CatalogueItemPageDTO,
  CatalogueItemProfile,
  CatalogueOfferDTO,
  CatalogueSectionDTO,
} from './dto'
import { admits, isIndexable } from './visibility'
import { PROFILES, PROFILE_ORDER } from './profiles'
import { isValidIsbn } from './isbn'

const SCHEMA = 'https://schema.org'
const IN_STOCK = `${SCHEMA}/InStock`
const MAX_IMAGES = 10

/** The type of an item on ITS OWN page, by profile (B1, D-2). Inside a menu every item is a MenuItem. */
export const ITEM_PAGE_TYPE: Readonly<Partial<Record<CatalogueItemProfile, 'Book' | 'Product' | 'Service'>>> = Object.freeze(
  Object.fromEntries(PROFILE_ORDER.map((p) => [p, PROFILES[p].jsonLd.itemPage]))
)

/** The type of a collection page. `list` becomes OfferCatalog when it has offers (see builder). */
export const COLLECTION_TYPE: Readonly<Record<CatalogueCollectionType, 'Menu' | 'ItemList'>> = Object.freeze({
  menu: 'Menu',
  list: 'ItemList',
})

export type CatalogueJsonLdContext = {
  /** Canonical absolute URL of the page being described. */
  url: string
  locale: string
  /**
   * Absolute URL of an item's own page in `locale`, or null when it has none
   * there (C6: hasPage + a slug in this locale). Without it, items are unlinked.
   */
  itemUrl?: (item: CatalogueItemDTO) => string | null
}

type Json = Record<string, unknown>

function imagesOf(images: readonly CatalogueImageDTO[]): string[] {
  return images
    .map((i) => structuredImageUrl(i.url))
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGES)
}

function offerOf(offer: CatalogueOfferDTO): Json {
  return {
    '@type': 'Offer',
    // schema.org wants a number for price; 0 (free) is a real price.
    price: offer.price,
    priceCurrency: offer.effectiveCurrency,
    availability: IN_STOCK,
    ...(offer.priceNote ? { description: offer.priceNote } : {}),
  }
}

function offersOf(item: CatalogueItemDTO): Json | Json[] | undefined {
  const offers = item.offers.map(offerOf)
  if (offers.length === 0) return undefined
  return offers.length === 1 ? offers[0] : offers
}

function withOffers(offers: Json | Json[] | undefined): Json {
  return offers ? { offers } : {}
}

function linkOf(item: CatalogueItemDTO, ctx: CatalogueJsonLdContext): Json {
  const url = ctx.itemUrl?.(item) ?? null
  return url ? { url } : {}
}

function describe(item: Pick<CatalogueItemDTO, 'name' | 'description' | 'images'>): Json {
  const images = imagesOf(item.images)
  return {
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
  }
}

/**
 * Amendment I-3.5 — what a Book adds: author as a Person, datePublished (the
 * year), isbn only when it checks out (search engines reject a malformed one;
 * the visible page still shows what was typed). Nothing for other types.
 */
function bookFields(item: Pick<CatalogueItemDTO, 'itemProfile' | 'bookDetails'>): Json {
  const b = item.bookDetails
  if (PROFILES[item.itemProfile].jsonLd.itemPage !== 'Book' || !b) return {}
  return {
    ...(b.author ? { author: { '@type': 'Person', name: b.author } } : {}),
    ...(b.publisher ? { publisher: { '@type': 'Organization', name: b.publisher } } : {}),
    ...(b.isbn && isValidIsbn(b.isbn) ? { isbn: b.isbn } : {}),
    ...(b.year !== null ? { datePublished: String(b.year) } : {}),
  }
}

/** A item inside a collection — shape depends on the collection, not on the item (B1). */
function menuItemOf(item: CatalogueItemDTO, ctx: CatalogueJsonLdContext): Json {
  return { '@type': 'MenuItem', ...describe(item), ...linkOf(item, ctx), ...withOffers(offersOf(item)) }
}

function listedItems(items: readonly CatalogueItemDTO[]): CatalogueItemDTO[] {
  return items.filter((i) => admits('structuredData', i.visibility))
}

/** Sections with unlisted items removed; emptied-by-omission sections pruned. */
function prune(sections: readonly CatalogueSectionDTO[]): CatalogueSectionDTO[] {
  const out: CatalogueSectionDTO[] = []
  for (const s of sections) {
    const items = listedItems(s.items)
    const children = prune(s.children)
    const hadContent = s.items.length > 0 || s.children.length > 0
    const empty = items.length === 0 && children.length === 0
    if (hadContent && empty) continue
    out.push({ ...s, items, children })
  }
  return out
}

function menuSectionOf(section: CatalogueSectionDTO, ctx: CatalogueJsonLdContext): Json {
  return {
    '@type': 'MenuSection',
    name: section.name,
    ...(section.items.length > 0 ? { hasMenuItem: section.items.map((i) => menuItemOf(i, ctx)) } : {}),
    ...(section.children.length > 0
      ? { hasMenuSection: section.children.map((c) => menuSectionOf(c, ctx)) }
      : {}),
  }
}

function flatten(sections: readonly CatalogueSectionDTO[]): CatalogueItemDTO[] {
  return sections.flatMap((s) => [...s.items, ...flatten(s.children)])
}

/** An item described standalone (as the thing offered / listed), typed by itemProfile. */
function itemEntity(item: CatalogueItemDTO, ctx: CatalogueJsonLdContext): Json {
  return { '@type': PROFILES[item.itemProfile].jsonLd.itemPage, ...describe(item), ...bookFields(item), ...linkOf(item, ctx) }
}

/**
 * JSON-LD for an item on its own page: Product, Service or Book with nested
 * Offer(s) when priced. Null when the page is `unlisted` (noindex) or not admitted to
 * structured data.
 */
export function catalogueItemJsonLd(item: CatalogueItemPageDTO, ctx: CatalogueJsonLdContext): Json | null {
  if (!isIndexable(item.visibility) || !admits('structuredData', item.visibility)) return null
  if (!item.name) return null
  const type = PROFILES[item.itemProfile].jsonLd.itemPage
  // F-3: a Product with no offers, review or rating is flagged invalid by search
  // engines, so an unpriced item page emits no item node. Service needs none.
  if (type === 'Product' && item.offers.length === 0) return null
  return {
    '@context': SCHEMA,
    '@type': type,
    '@id': `${ctx.url}#${type.toLowerCase()}`,
    url: ctx.url,
    ...describe(item),
    ...bookFields(item),
    inLanguage: ctx.locale,
    ...withOffers(offersOf(item)),
  }
}

/**
 * JSON-LD for a collection page: Menu, ItemList or OfferCatalog. Null when the
 * collection is `unlisted` or not admitted. Unlisted items inside it are omitted (C10).
 */
export function catalogueCollectionJsonLd(collection: CatalogueCollectionDTO, ctx: CatalogueJsonLdContext): Json | null {
  if (!isIndexable(collection.visibility) || !admits('structuredData', collection.visibility)) return null
  if (!collection.name) return null

  const sections = prune(collection.sections)
  const base: Json = {
    '@context': SCHEMA,
    '@id': `${ctx.url}#collection`,
    url: ctx.url,
    name: collection.name,
    ...(collection.description ? { description: collection.description } : {}),
    inLanguage: ctx.locale,
  }

  if (collection.collectionType === 'menu') {
    return {
      ...base,
      '@type': COLLECTION_TYPE.menu,
      ...(sections.length > 0 ? { hasMenuSection: sections.map((s) => menuSectionOf(s, ctx)) } : {}),
    }
  }

  const items = flatten(sections)
  // Recomputed from what is actually emitted, not collection.hasOffers: the
  // only offers in the tree may belong to omitted items.
  const hasOffers = items.some((i) => i.hasOffers && i.offers.length > 0)

  if (hasOffers) {
    return {
      ...base,
      '@type': 'OfferCatalog',
      ...(items.length > 0
        ? {
            itemListElement: items.flatMap((item) =>
              item.offers.length > 0
                ? item.offers.map((o) => ({ ...offerOf(o), itemOffered: itemEntity(item, ctx) }))
                : [itemEntity(item, ctx)],
            ),
          }
        : {}),
    }
  }

  return {
    ...base,
    '@type': COLLECTION_TYPE.list,
    ...(items.length > 0
      ? {
          numberOfItems: items.length,
          itemListElement: items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            ...describe(item),
            ...linkOf(item, ctx),
          })),
        }
      : {}),
  }
}
