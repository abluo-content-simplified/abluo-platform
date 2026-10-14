// ── Catalogue — the resolved public DTO ───────────────────────────────────────
//
// Authority: ADR-033 D4, D7/A6, D9, D10, D11, D14, A2–A8, B1–B4, C1.
// Spec:      catalogue-module-v1-spec.md §4, §6.3–6.6, §7.
//
// THIS IS THE CONTRACT. The catalogue routes (item / collection / landing page
// dispatch inside [...slug]), catalogueListingSection, generateMetadata and
// structured.ts (JSON-LD, Amendment B) build against these shapes and nothing
// else. They are produced from the GROQ rows in src/lib/sanity/queries.ts by
// the pure functions in ./resolve.ts.
//
// Guarantees every consumer may rely on:
//   - Everything here has already passed the ADR-032 D3 visibility rule, in
//     GROQ and again in TypeScript (isPublicAt). Hidden content never arrives;
//     a consumer has nothing to filter (B4).
//   - Text is resolved for the request locale with the fallback chain
//     requested → site default → en. Never an empty object, never
//     translationStatus (spec §7).
//   - `effectiveCurrency` is the PROJECT currency (D7/A6). The reserved
//     offer.currency field is never read; there is nothing to coalesce.
//   - No Sanity `_id` anywhere (ADR-031 D3). `publicId` is the public identity
//     of items and collections; `key` (the Sanity array `_key`) is the stable
//     identity of offers, options, option lists and sections (D14).
//   - A collection's section tree renders EVERY stored section (A7): orphans
//     become recovery roots, cycles are appended flat, and `issues` says what
//     is wrong. A section with no items is still present (AC 19).
//   - Unlisted items/collections can be in a DTO (direct link, explicit pick);
//     `visibility` is carried so a consumer can emit robots noindex. The
//     sitemap query excludes them on its own.
//
// What structured.ts needs for B1, and where it is:
//   collection → collectionType ('menu' → Menu/MenuSection/MenuItem, 'list' →
//                ItemList, or OfferCatalog when hasOffers), sections (nested),
//                name, description, page (canonical slug map), publicId
//   item       → itemProfile (D-2: foodOrDrink/product → Product, service →
//                Service on its own page), name, description, images, offers (price,
//                effectiveCurrency, state → availability), page, publicId
// Product.sku does not exist in V1 (B3).

import type { PortableTextContent, SanityCrop, SanityHotspot, SanityImageAsset } from '@/lib/sanity/types'
import type { AllergenKey } from './allergens'
import type { AvailabilityState, Weekday } from './availability'
import type { TreeIssue } from './sections'

export type CatalogueItemProfile = 'foodOrDrink' | 'product' | 'service'

/**
 * A food-or-drink item's allergen declaration (ADR-033 D-3), resolved for the
 * request locale. Never inferred: the website prints only what was declared.
 * `notReviewed` cannot be published (server + Studio), but a consumer still
 * renders nothing for it rather than guessing.
 */
export type AllergenDeclarationDTO =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain: AllergenKey[]; note: string | null }
  | { status: 'noneDeclared'; mayContain: AllergenKey[]; note: string | null }
export type CatalogueCollectionType = 'menu' | 'list'
export type CatalogueVisibility = 'public' | 'websiteOnly' | 'unlisted'

/** One entry of a module vocabulary (channels, categories, dietary tags). */
export type CatalogueTermDTO = {
  /** Stable machine value — never shown, never translated. */
  value: string
  /** Label for the request locale. */
  label: string
  color: string | null
}

/**
 * A public page reference. Present only when the document has `hasPage`.
 * `slugs` is the canonical slug map (locale → slug, set locales only): the
 * source of the canonical URL, hreflang alternates and the SlugMapProvider.
 * `slug` is the request locale's — null when the page is not translated into
 * it. There is deliberately NO fallback to another locale's slug: the primary
 * lookup has none, so such a link would 404.
 */
export type CataloguePageRefDTO = {
  slug: string | null
  slugs: Partial<Record<string, string>>
}

export type CatalogueImageDTO = {
  /** Pass to the image URL builder (asset + the Media Library crop/hotspot). */
  image: { asset: SanityImageAsset; hotspot: SanityHotspot | null; crop: SanityCrop | null }
  url: string | null
  width: number | null
  height: number | null
  lqip: string | null
  alt: string | null
  /** CSS object-position from the Media Library focal point (ADR-022). */
  objectPosition: string
}

export type CatalogueAvailabilityDTO = {
  /** Empty = every day. Names the day the interval STARTS (A1). */
  days: Weekday[]
  /** "HH:mm"; both null = all day. May wrap past midnight (A1). */
  from: string | null
  to: string | null
}

export type CatalogueOfferDTO = {
  /** The offer's stable identity — Sanity array `_key`, never regenerated (D14). */
  key: string
  /** Stable channel value; null = unscoped, applies to any channel without its own offer (A2). */
  channel: string | null
  /** Channel label for the request locale; null when unscoped or not in config. */
  channelLabel: string | null
  /** Stored amount, unchanged. 0 means free (spec §4.2). */
  price: number
  /** = project currency, always (D7/A6). */
  effectiveCurrency: string
  /** Intl.NumberFormat(locale, effectiveCurrency). */
  formattedPrice: string
  /** price === 0 — the renderer shows its localized "Free". */
  isFree: boolean
  /** "per 100 g", "from" — displayed, never parsed. */
  priceNote: string | null
  availability: CatalogueAvailabilityDTO[]
  /**
   * The availability rules evaluated at resolve time in the SITE time zone
   * (A8). null when the site has no time zone configured — never guessed from
   * the server's zone. Says nothing about channel precedence: use
   * resolveOffer (offers.ts) via `asResolverOffers` for "what does it cost on
   * channel X now".
   */
  state: AvailabilityState | null
}

/** A catalogue item an option points at (a side also sold alone). */
export type CatalogueLinkedItemDTO = {
  publicId: string | null
  name: string
  page: CataloguePageRefDTO | null
}

/** D-3a — a choice's declaration (never a note). */
export type OptionAllergenDeclarationDTO =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain: AllergenKey[] }
  | { status: 'noneDeclared'; mayContain: AllergenKey[] }

export type CatalogueOptionDTO = {
  key: string
  label: string
  kind: 'add' | 'remove'
  priceDelta: number
  /** "+€1.50" / "−€1"; null when the delta is 0 (free choice). */
  formattedDelta: string | null
  item: CatalogueLinkedItemDTO | null
  /**
   * D-3a. null when the item is not food or drink, or for a "remove" choice
   * (it never subtracts the item's base allergens). A linked choice carries
   * its item's declaration; a free-text "add" choice its own.
   */
  allergenDeclaration: OptionAllergenDeclarationDTO | null
}

/** An option list as attached to an item: min/max belong to the attachment (D2). */
export type CatalogueOptionListDTO = {
  /** The attachment's `_key`. */
  key: string
  name: string
  min: number
  /** null = unlimited. */
  max: number | null
  options: CatalogueOptionDTO[]
}

/** F-2 — one external link of an item. `url` has passed the http(s) gate; never an offer. */
export type CatalogueItemLinkDTO = {
  key: string
  /** Request locale, else default locale (editorial text, not an address). */
  label: string
  url: string
}

export type CatalogueItemDTO = {
  publicId: string | null
  itemProfile: CatalogueItemProfile
  name: string
  /** F-1 — a short plain line under the name (author, producer, practitioner …); null when none. */
  byline: string | null
  description: string | null
  /** F-2 — ordered; entries without a label or with an unsafe address are already dropped. */
  links: CatalogueItemLinkDTO[]
  images: CatalogueImageDTO[]
  categories: CatalogueTermDTO[]
  /**
   * D-3. null for products and services (no allergen interface, nothing rendered).
   * Keys are platform constants (C3); labels from messages catalogue.allergens.*.
   */
  allergenDeclaration: AllergenDeclarationDTO | null
  dietary: CatalogueTermDTO[]
  offers: CatalogueOfferDTO[]
  /** True when the item carries at least one offer (OfferCatalog vs ItemList, B1). */
  hasOffers: boolean
  optionLists: CatalogueOptionListDTO[]
  visibility: CatalogueVisibility
  /** null when the item has no page of its own (hasPage false, AC 13). */
  page: CataloguePageRefDTO | null
}

/** An item on its own page. */
export type CatalogueItemPageDTO = CatalogueItemDTO & {
  page: CataloguePageRefDTO
  body: PortableTextContent | null
}

export type CatalogueSectionDTO = {
  /** Sanity array `_key` — the section's identity. */
  key: string
  name: string
  /** As stored. Never rewritten, even for a recovered orphan (A7). */
  parentKey: string | null
  /** 0 for a root (including recovery roots). */
  depth: number
  /** Promoted to a root because its parent is missing or cyclic (A7). */
  recovered: boolean
  /** Public items only, in stored order. May be empty (AC 19). */
  items: CatalogueItemDTO[]
  children: CatalogueSectionDTO[]
}

export type CatalogueCollectionDTO = {
  publicId: string | null
  collectionType: CatalogueCollectionType
  name: string
  description: string | null
  visibility: CatalogueVisibility
  page: CataloguePageRefDTO | null
  /** = project currency (D7). */
  currency: string
  /** Root sections, children nested, in reading order. */
  sections: CatalogueSectionDTO[]
  /** Tree problems from sections.ts — rendered anyway, reported here. */
  issues: TreeIssue[]
  /** Any item in the tree carries an offer (OfferCatalog, B1). */
  hasOffers: boolean
}

/** The landing page at /{segment} (C1). */
export type CataloguePageDTO = {
  heroTitle: string | null
  heroSubtitle: string | null
  seoTitle: string | null
  seoDescription: string | null
  /** Page sections as projected by PAGE_SECTIONS_PROJECTION; rendered by the section renderer. */
  sections: unknown[]
}

/** The catalogue installation's configuration, resolved for one request. */
export type CatalogueConfigDTO = {
  /** ISO 4217. The sole persisted currency (D7). */
  currency: string
  /** The public base-path segment (D11). null = not configured: no routes. */
  segment: string | null
  /** Every previous segment; each 301s to the current one (D11.3). */
  segmentHistory: string[]
  showPricesByDefault: boolean
  channels: CatalogueTermDTO[]
  categories: CatalogueTermDTO[]
  dietaryTags: CatalogueTermDTO[]
  /** Site IANA time zone for availability (A8). null = unknown. */
  timeZone: string | null
}
