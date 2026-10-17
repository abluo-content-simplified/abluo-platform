// ── Catalogue — raw GROQ rows → public DTO ────────────────────────────────────
//
// Pure functions: no fetching, no React, no Next.js. Each takes a row exactly
// as the catalogue queries in src/lib/sanity/queries.ts return it, plus a
// request context, and returns the contract in ./dto.ts (or null).
//
// Composes the module's own rules rather than restating them:
//   sections.ts      readingOrder — the tree, with fail-visible recovery (A7)
//   offers.ts        effectiveCurrency (D7/A6); asResolverOffers feeds resolveOffer
//   availability.ts  evaluate — serving hours in the site zone (A8)
//   lifecycle        isPublicAt — the ADR-032 D3 rule re-checked in TypeScript,
//                    so a stale cache or a hand-built row cannot leak hidden
//                    content (B4)
//   gallery/focal    focalObjectPosition — Media Library focal point (ADR-022)

import { focalObjectPosition } from '@/lib/gallery/focal'
import { LIFECYCLE_PUBLIC_RULES } from '@/lib/lifecycle/public-types'
import { isPublicAt, type LifecycleFields } from '@/lib/lifecycle/visibility'
import type { PortableTextContent, SanityCrop, SanityHotspot, SanityImageAsset } from '@/lib/sanity/types'
import { allergenDeclarationIssues, orderedAllergens } from './allergens'
import { evaluate, WEEKDAYS, type AvailabilityState, type Weekday } from './availability'
import { effectiveCurrency, type Offer } from './offers'
import { catalogueLinkUrl } from './links'
import { readingOrder } from './sections'
import { normalise } from './slugs'
import { can, profileOf } from './profiles'
import { normalizeIsbn, parseBookYear } from './isbn'
import { catalogueCategoryVocabulary, type CategoryTermRow } from '@/lib/taxonomy/vocabulary'
import type {
  CatalogueAvailabilityDTO,
  CatalogueCollectionDTO,
  CatalogueCollectionType,
  CatalogueConfigDTO,
  CatalogueImageDTO,
  CatalogueItemDTO,
  CatalogueItemPageDTO,
  CatalogueItemLinkDTO,
  AllergenDeclarationDTO,
  CatalogueBookDetailsDTO,
  CatalogueItemProfile,
  OptionAllergenDeclarationDTO,
  CatalogueLinkedItemDTO,
  CatalogueOfferDTO,
  CatalogueOptionDTO,
  CatalogueOptionListDTO,
  CataloguePageDTO,
  CataloguePageRefDTO,
  CatalogueSectionDTO,
  CatalogueTermDTO,
  CatalogueVisibility,
} from './dto'

// ── Raw rows (what the queries return) ───────────────────────────────────────

/** A text field: already locale-resolved by GROQ (string), or a raw localized object. */
export type RawText = string | Record<string, unknown> | null | undefined

/** `"slugMap": slug` — a localizedSlug object: { it: { current }, en: { current }, _type }. */
export type RawSlugMap = Record<string, unknown> | null | undefined

export type RawCatalogueImage = {
  image?: { asset?: SanityImageAsset | null; hotspot?: SanityHotspot | null; crop?: SanityCrop | null } | null
  width?: number | null
  height?: number | null
  lqip?: string | null
  url?: string | null
  alt?: RawText
}

export type RawCatalogueOffer = {
  _key: string
  channel?: string | null
  price?: number | null
  priceNote?: RawText
  availability?: { days?: readonly string[] | null; from?: string | null; to?: string | null }[] | null
  /** RESERVED (D14/A6). Never projected, never read. Typed only so tests can prove that. */
  currency?: string | null
  /** RESERVED (A5). Never projected, never read. */
  locationKey?: string | null
}

/** A stored allergen declaration as projected (item: with a locale-resolved note; choice: without). */
export type RawAllergenDeclaration = {
  status?: string | null
  allergens?: readonly string[] | null
  mayContain?: readonly string[] | null
  confirmed?: boolean | null
  note?: RawText
} | null

export type RawCatalogueOptionItem = {
  publicId?: string | null
  name?: RawText
  hasPage?: boolean | null
  slugMap?: RawSlugMap
  /** D-3a: a linked choice derives its declaration from the item. */
  itemProfile?: string | null
  allergenDeclaration?: RawAllergenDeclaration
} | null

export type RawCatalogueOption = {
  _key: string
  label?: RawText
  kind?: string | null
  priceDelta?: number | null
  /** true when the choice references an item at all (the item itself may not be public). */
  linked?: boolean | null
  item?: RawCatalogueOptionItem
  /** D-3a: a free-text "add" choice's own declaration (no note). */
  allergenDeclaration?: RawAllergenDeclaration
}

export type RawCatalogueOptionListAttachment = {
  _key: string
  min?: number | null
  max?: number | null
  /** null when the list is missing, in another project or not public. */
  list?: { name?: RawText; options?: RawCatalogueOption[] | null } | null
}

export type RawCatalogueItem = LifecycleFields & {
  /** Never projected by the catalogue queries; typed so tests can prove it never leaks. */
  _id?: string
  publicId?: string | null
  itemProfile?: string | null
  visibility?: string | null
  hasPage?: boolean | null
  name?: RawText
  /** F-1 — locale-resolved by GROQ, or a raw localized object. */
  byline?: RawText
  /** Amendment I-3 — as stored; every value unchecked until resolveBookDetails. */
  bookDetails?: { author?: unknown; year?: unknown; isbn?: unknown } | null
  description?: RawText
  /** F-2 — `label` locale-resolved by GROQ (or raw localized); `url` unchecked until resolveLinks. */
  links?: ({ _key?: string | null; label?: RawText; url?: unknown } | null)[] | null
  slugMap?: RawSlugMap
  categories?: readonly string[] | null
  /** D-3 — as projected: status, allergens, mayContain, confirmed, note (locale-resolved). */
  allergenDeclaration?: RawAllergenDeclaration
  dietary?: readonly string[] | null
  images?: (RawCatalogueImage | null)[] | null
  offers?: (RawCatalogueOffer | null)[] | null
  optionLists?: (RawCatalogueOptionListAttachment | null)[] | null
}

export type RawCatalogueItemPage = RawCatalogueItem & {
  body?: PortableTextContent | null
  redirectFrom?: unknown
}

export type RawCatalogueSection = {
  _key: string
  parentKey?: string | null
  name?: RawText
  items?: (RawCatalogueItem | null)[] | null
}

export type RawCatalogueCollection = LifecycleFields & {
  _id?: string
  publicId?: string | null
  collectionType?: string | null
  visibility?: string | null
  hasPage?: boolean | null
  name?: RawText
  description?: RawText
  slugMap?: RawSlugMap
  sections?: (RawCatalogueSection | null)[] | null
  redirectFrom?: unknown
}

export type RawCataloguePage = {
  heroTitle?: RawText
  heroSubtitle?: RawText
  seoTitle?: RawText
  seoDescription?: RawText
  sections?: unknown[] | null
}

type RawTerm = { value?: string | null; label?: RawText; color?: string | null }

export type RawCatalogueConfigRow = {
  catalogue?: {
    currency?: string | null
    publicSegment?: string | null
    publicSegmentHistory?: readonly string[] | null
    showPricesByDefault?: boolean | null
    serviceChannels?: (RawTerm | null)[] | null
    categories?: (RawTerm | null)[] | null
    dietaryTags?: (RawTerm | null)[] | null
  } | null
  /** ADR-033 Amendment J — the project's category term records (label locale-resolved by GROQ). */
  categoryTerms?: readonly (CategoryTermRow | null)[] | null
  timeZone?: string | null
} | null

// ── Context ───────────────────────────────────────────────────────────────────

export type CatalogueResolveContext = {
  /** Request locale. */
  locale: string
  /** Site default locale — second step of the text fallback chain. */
  defaultLocale?: string | null
  config: CatalogueConfigDTO
  /** The instant visibility and availability are evaluated at. */
  now: Date
}

/**
 * Spec §5: `currency` is a select with default EUR. An installation saved
 * before the field existed carries no value and gets that default; this is the
 * config field's default restated for reading, not a second authority.
 */
export const CATALOGUE_DEFAULT_CURRENCY = 'EUR'

// ── Small helpers ─────────────────────────────────────────────────────────────

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/**
 * Text for the request locale. GROQ normally resolves it (loc()); a raw
 * localized object is accepted too and resolved with the same chain —
 * requested → site default → en. Never returns an empty string.
 */
export function text(value: RawText, locale: string, defaultLocale?: string | null): string | null {
  if (typeof value === 'string') return nonEmpty(value)
  if (!value || typeof value !== 'object') return null
  for (const l of [locale, defaultLocale, 'en']) {
    if (!l) continue
    const v = nonEmpty((value as Record<string, unknown>)[l])
    if (v) return v
  }
  return null
}

/** locale → slug for every locale whose slug is set. */
export function slugsOf(slugMap: RawSlugMap): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {}
  if (!slugMap || typeof slugMap !== 'object') return out
  for (const [locale, v] of Object.entries(slugMap)) {
    if (locale.startsWith('_')) continue
    const current = v && typeof v === 'object' ? nonEmpty((v as { current?: unknown }).current) : null
    if (current) out[locale] = current
  }
  return out
}

/** The page reference, or null when the document has no page (hasPage false or no slug at all). */
export function pageRefOf(hasPage: boolean | null | undefined, slugMap: RawSlugMap, locale: string): CataloguePageRefDTO | null {
  if (hasPage !== true) return null
  const slugs = slugsOf(slugMap)
  if (Object.keys(slugs).length === 0) return null
  return { slug: slugs[locale] ?? null, slugs }
}

/**
 * A money amount for `locale` in `currency` (Intl.NumberFormat). Whole amounts
 * drop the decimals ("€8"), fractional ones keep two ("€8.50") — the events
 * module's rule, so a site reads one way. Never throws: an unknown code falls
 * back to "8.5 XYZ".
 */
export function formatPrice(amount: number, currency: string, locale: string, opts: { signed?: boolean } = {}): string {
  const code = currency.trim().toUpperCase()
  const digits = Number.isInteger(amount) ? 0 : 2
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      ...(opts.signed ? { signDisplay: 'exceptZero' as const } : {}),
    }).format(amount)
  } catch {
    return `${opts.signed && amount > 0 ? '+' : ''}${amount} ${code}`
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const COLLECTION_TYPES: readonly CatalogueCollectionType[] = ['menu', 'list']
const VISIBILITIES: readonly CatalogueVisibility[] = ['public', 'websiteOnly', 'unlisted']

// Defaults are the schema's own: B1 maps an item's own page to Product by
// default; B2 makes 'list' the collection default; AC 30 makes 'public' the
// visibility default.
const itemProfileOf = profileOf
const collectionTypeOf = (v: unknown): CatalogueCollectionType =>
  COLLECTION_TYPES.includes(v as CatalogueCollectionType) ? (v as CatalogueCollectionType) : 'list'
const visibilityOf = (v: unknown): CatalogueVisibility =>
  VISIBILITIES.includes(v as CatalogueVisibility) ? (v as CatalogueVisibility) : 'public'

function termsOf(rows: readonly (RawTerm | null)[] | null | undefined, locale: string, defaultLocale?: string | null): CatalogueTermDTO[] {
  const out: CatalogueTermDTO[] = []
  for (const r of rows ?? []) {
    const value = nonEmpty(r?.value)
    if (!value) continue
    out.push({ value, label: text(r?.label, locale, defaultLocale) ?? value, color: nonEmpty(r?.color) })
  }
  return out
}

/** Stored keys → configured terms, in stored order; keys no longer in config are dropped. */
function pickTerms(keys: readonly string[] | null | undefined, vocabulary: readonly CatalogueTermDTO[]): CatalogueTermDTO[] {
  const byValue = new Map(vocabulary.map((t) => [t.value, t]))
  const seen = new Set<string>()
  const out: CatalogueTermDTO[] = []
  for (const k of keys ?? []) {
    const t = byValue.get(k)
    if (t && !seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}

/**
 * D-3 — the declaration of a food-or-drink item; null for any other profile.
 * Never inferred: a declaration that is not reviewed, or not valid as stored
 * (no allergen ticked under "contains", "none" not confirmed, unknown keys),
 * resolves to `notReviewed` — the website then shows nothing rather than a
 * claim nobody made. Keys come back valid, deduplicated, in Annex II order.
 */
function allergenDeclarationOf(row: RawCatalogueItem, profile: CatalogueItemProfile, ctx: CatalogueResolveContext): AllergenDeclarationDTO | null {
  if (!can(profile, 'foodInformation')) return null
  return declarationOf(row.allergenDeclaration, ctx)
}

function declarationOf(raw: RawAllergenDeclaration | undefined, ctx: CatalogueResolveContext): AllergenDeclarationDTO {
  const shape = raw ? { status: raw.status, ...(raw.allergens != null && { allergens: raw.allergens }), ...(raw.mayContain != null && { mayContain: raw.mayContain }), ...(raw.confirmed != null && { confirmed: raw.confirmed }) } : null
  if (!raw || allergenDeclarationIssues(shape).length) return { status: 'notReviewed' }
  const note = text(raw.note, ctx.locale, ctx.defaultLocale)
  if (raw.status === 'noneDeclared') return { status: 'noneDeclared', mayContain: orderedAllergens(raw.mayContain), note }
  return { status: 'containsListedAllergens', allergens: orderedAllergens(raw.allergens), mayContain: orderedAllergens(raw.mayContain), note }
}

/**
 * D-3a — a choice's declaration, only on a food-or-drink item (null elsewhere):
 *   remove            → null (never subtracts the item's base allergens)
 *   linked to an item → that item's declaration (no note); an item that is not
 *                       public or not food → notReviewed / null, never guessed
 *   free-text add     → its own declaration
 */
function optionDeclarationOf(o: RawCatalogueOption, parentIsFood: boolean, ctx: CatalogueResolveContext): OptionAllergenDeclarationDTO | null {
  if (!parentIsFood || o.kind === 'remove') return null
  if (o.linked || o.item) {
    if (!o.item) return { status: 'notReviewed' }
    if (!can(profileOf(o.item.itemProfile), 'foodInformation')) return null
    return withoutNote(declarationOf(o.item.allergenDeclaration, ctx))
  }
  return withoutNote(declarationOf(o.allergenDeclaration ? { ...o.allergenDeclaration, note: undefined } : o.allergenDeclaration, ctx))
}

function withoutNote(d: AllergenDeclarationDTO): OptionAllergenDeclarationDTO {
  if (d.status === 'containsListedAllergens') return { status: d.status, allergens: d.allergens, mayContain: d.mayContain }
  if (d.status === 'noneDeclared') return { status: d.status, mayContain: d.mayContain }
  return { status: d.status }
}

// ── Config ────────────────────────────────────────────────────────────────────

/** The catalogue installation's config, or null when the module is not installed / disabled. */
export function resolveCatalogueConfig(
  row: RawCatalogueConfigRow,
  locale: string,
  defaultLocale?: string | null,
): CatalogueConfigDTO | null {
  const c = row?.catalogue
  if (!c) return null
  const segment = normalise(c.publicSegment ?? '') || null
  const history: string[] = []
  for (const h of c.publicSegmentHistory ?? []) {
    const n = normalise(h)
    if (n && n !== segment && !history.includes(n)) history.push(n)
  }
  return {
    currency: (nonEmpty(c.currency) ?? CATALOGUE_DEFAULT_CURRENCY).trim().toUpperCase(),
    segment,
    segmentHistory: history,
    showPricesByDefault: c.showPricesByDefault !== false,
    channels: termsOf(c.serviceChannels, locale, defaultLocale),
    categories: termsOf(catalogueCategoryVocabulary(row?.categoryTerms, c.categories), locale, defaultLocale),
    dietaryTags: termsOf(c.dietaryTags, locale, defaultLocale),
    timeZone: nonEmpty(row?.timeZone),
  }
}

// ── Images ────────────────────────────────────────────────────────────────────

function imagesOf(rows: RawCatalogueItem['images'], ctx: CatalogueResolveContext): CatalogueImageDTO[] {
  const out: CatalogueImageDTO[] = []
  for (const r of rows ?? []) {
    const asset = r?.image?.asset
    if (!asset?._ref) continue
    const hotspot = r?.image?.hotspot ?? null
    const crop = r?.image?.crop ?? null
    out.push({
      image: { asset: { _ref: asset._ref, _type: 'reference' }, hotspot, crop },
      url: nonEmpty(r?.url),
      width: finite(r?.width) ? r!.width! : null,
      height: finite(r?.height) ? r!.height! : null,
      lqip: nonEmpty(r?.lqip),
      alt: text(r?.alt, ctx.locale, ctx.defaultLocale),
      objectPosition: focalObjectPosition({ hotspot, crop }),
    })
  }
  return out
}

// ── Offers ────────────────────────────────────────────────────────────────────

function availabilityOf(rows: RawCatalogueOffer['availability']): CatalogueAvailabilityDTO[] {
  return (rows ?? []).filter(Boolean).map((r) => ({
    days: (r.days ?? []).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)),
    from: nonEmpty(r.from),
    to: nonEmpty(r.to),
  }))
}

function stateOf(rules: CatalogueAvailabilityDTO[], ctx: CatalogueResolveContext): AvailabilityState | null {
  const tz = ctx.config.timeZone
  if (!tz) return null
  try {
    return evaluate(rules, ctx.now, tz)
  } catch {
    return null
  }
}

export function resolveOffers(rows: RawCatalogueItem['offers'], ctx: CatalogueResolveContext): CatalogueOfferDTO[] {
  // D7/A6: the project's currency, full stop. offer.currency is never read.
  const currency = effectiveCurrency({ currency: ctx.config.currency })
  const labels = new Map(ctx.config.channels.map((c) => [c.value, c.label]))
  const out: CatalogueOfferDTO[] = []
  for (const r of rows ?? []) {
    if (!r || typeof r._key !== 'string' || !finite(r.price) || r.price < 0) continue
    const channel = nonEmpty(r.channel)
    const availability = availabilityOf(r.availability)
    out.push({
      key: r._key,
      channel,
      channelLabel: channel ? labels.get(channel) ?? null : null,
      price: r.price,
      effectiveCurrency: currency,
      formattedPrice: formatPrice(r.price, currency, ctx.locale),
      isFree: r.price === 0,
      priceNote: text(r.priceNote, ctx.locale, ctx.defaultLocale),
      availability,
      state: stateOf(availability, ctx),
    })
  }
  return out
}

/** DTO offers in the shape offers.ts resolveOffer / channelState take. */
export function asResolverOffers(offers: readonly CatalogueOfferDTO[]): Offer[] {
  return offers.map((o) => ({ _key: o.key, channel: o.channel, price: o.price, availability: o.availability }))
}

// ── Options ───────────────────────────────────────────────────────────────────

function linkedItemOf(row: RawCatalogueOptionItem, ctx: CatalogueResolveContext): CatalogueLinkedItemDTO | null {
  if (!row) return null
  return {
    publicId: nonEmpty(row.publicId),
    name: text(row.name, ctx.locale, ctx.defaultLocale) ?? '',
    page: pageRefOf(row.hasPage, row.slugMap, ctx.locale),
  }
}

function optionListsOf(rows: RawCatalogueItem['optionLists'], ctx: CatalogueResolveContext, parentIsFood: boolean): CatalogueOptionListDTO[] {
  const out: CatalogueOptionListDTO[] = []
  for (const a of rows ?? []) {
    // A list that is missing, foreign or not public arrives as null and is skipped.
    if (!a || !a.list) continue
    const options: CatalogueOptionDTO[] = []
    for (const o of a.list.options ?? []) {
      if (!o || typeof o._key !== 'string') continue
      const delta = finite(o.priceDelta) ? o.priceDelta : 0
      options.push({
        key: o._key,
        label: text(o.label, ctx.locale, ctx.defaultLocale) ?? '',
        kind: o.kind === 'remove' ? 'remove' : 'add',
        priceDelta: delta,
        formattedDelta: delta === 0 ? null : formatPrice(delta, ctx.config.currency, ctx.locale, { signed: true }),
        item: linkedItemOf(o.item ?? null, ctx),
        allergenDeclaration: optionDeclarationOf(o, parentIsFood, ctx),
      })
    }
    out.push({
      key: a._key,
      name: text(a.list.name, ctx.locale, ctx.defaultLocale) ?? '',
      min: finite(a.min) && a.min > 0 ? a.min : 0,
      max: finite(a.max) ? a.max : null,
      options,
    })
  }
  return out
}

// ── Links (Amendment F-2) ─────────────────────────────────────────────────────

/** Stored order kept; an entry with no label in the chain, or an address failing the http(s) gate, is dropped. */
export function resolveLinks(rows: RawCatalogueItem['links'], ctx: CatalogueResolveContext): CatalogueItemLinkDTO[] {
  const out: CatalogueItemLinkDTO[] = []
  for (const [i, r] of (rows ?? []).entries()) {
    if (!r) continue
    const url = catalogueLinkUrl(r.url)
    const label = text(r.label, ctx.locale, ctx.defaultLocale)
    if (!url || !label) continue
    out.push({ key: nonEmpty(r._key) ?? `link${i}`, label, url })
  }
  return out
}

// ── Book details (Amendment I-3) ─────────────────────────────────────────────

/**
 * Only a profile that carries book details shows them: after "Change type" the
 * stored values are kept but hidden, not rendered and not in structured data.
 * Every value is re-checked here — a stored year out of range or a blank
 * author is simply dropped. null when nothing is left.
 */
export function resolveBookDetails(raw: RawCatalogueItem['bookDetails'], profile: CatalogueItemProfile): CatalogueBookDetailsDTO | null {
  if (!can(profile, 'bookDetails') || !raw || typeof raw !== 'object') return null
  const author = typeof raw.author === 'string' ? raw.author.trim().replace(/[ \t]+/g, ' ') : ''
  const isbn = normalizeIsbn(raw.isbn)
  const year = parseBookYear(raw.year)
  if (!author && !isbn && year === null) return null
  return { author: author || null, year, isbn: isbn || null }
}

// ── Items ─────────────────────────────────────────────────────────────────────

/**
 * An item as rendered anywhere (inside a collection, a listing, its own page).
 * null when the row is missing or fails the ADR-032 D3 rule at ctx.now.
 */
export function resolveItem(row: RawCatalogueItem | null | undefined, ctx: CatalogueResolveContext): CatalogueItemDTO | null {
  if (!row || !isPublicAt(row, LIFECYCLE_PUBLIC_RULES.catalogueItem, ctx.now)) return null
  const offers = resolveOffers(row.offers, ctx)
  const profile = itemProfileOf(row.itemProfile)
  const bookDetails = resolveBookDetails(row.bookDetails, profile)
  return {
    publicId: nonEmpty(row.publicId),
    itemProfile: profile,
    name: text(row.name, ctx.locale, ctx.defaultLocale) ?? '',
    // I-3.4: the author stands in as the byline at read time; nothing is copied into `byline` on save.
    byline: text(row.byline, ctx.locale, ctx.defaultLocale) ?? bookDetails?.author ?? null,
    bookDetails,
    description: text(row.description, ctx.locale, ctx.defaultLocale),
    links: resolveLinks(row.links, ctx),
    images: imagesOf(row.images, ctx),
    categories: pickTerms(row.categories, ctx.config.categories),
    allergenDeclaration: allergenDeclarationOf(row, itemProfileOf(row.itemProfile), ctx),
    dietary: pickTerms(row.dietary, ctx.config.dietaryTags),
    offers,
    hasOffers: offers.length > 0,
    optionLists: optionListsOf(row.optionLists, ctx, can(itemProfileOf(row.itemProfile), 'foodInformation')),
    visibility: visibilityOf(row.visibility),
    page: pageRefOf(row.hasPage, row.slugMap, ctx.locale),
  }
}

/** An item on its own page (catalogueItemBySlugQuery). null without a page. */
export function resolveItemPage(row: RawCatalogueItemPage | null | undefined, ctx: CatalogueResolveContext): CatalogueItemPageDTO | null {
  const item = resolveItem(row, ctx)
  if (!item || !item.page) return null
  return { ...item, page: item.page, body: Array.isArray(row!.body) && row!.body.length > 0 ? row!.body : null }
}

// ── Collections ───────────────────────────────────────────────────────────────

/**
 * A collection with its resolved section tree. Every stored section is
 * rendered (A7); hidden or dangling item references are dropped; a section
 * with no items stays (AC 19). null when the row is missing or not public.
 */
export function resolveCollection(
  row: RawCatalogueCollection | null | undefined,
  ctx: CatalogueResolveContext,
): CatalogueCollectionDTO | null {
  if (!row || !isPublicAt(row, LIFECYCLE_PUBLIC_RULES.catalogueCollection, ctx.now)) return null

  const raw = (row.sections ?? []).filter((s): s is RawCatalogueSection => !!s && typeof s._key === 'string')
  const { order, depth, recovered, issues } = readingOrder(raw)
  const recoveredKeys = new Set(recovered)
  const byKey = new Map<string, CatalogueSectionDTO>()
  const roots: CatalogueSectionDTO[] = []
  let hasOffers = false

  for (const s of order) {
    const items: CatalogueItemDTO[] = []
    for (const i of s.items ?? []) {
      const item = resolveItem(i, ctx)
      if (!item) continue
      if (item.hasOffers) hasOffers = true
      items.push(item)
    }
    const d = depth.get(s._key) ?? 0
    const parentKey = nonEmpty(s.parentKey)
    const node: CatalogueSectionDTO = {
      key: s._key,
      name: text(s.name, ctx.locale, ctx.defaultLocale) ?? '',
      parentKey,
      depth: d,
      recovered: recoveredKeys.has(s._key),
      items,
      children: [],
    }
    byKey.set(s._key, node)
    // readingOrder emits parents before children, so a non-root's parent node
    // already exists here.
    const parent = d > 0 && parentKey ? byKey.get(parentKey) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  return {
    publicId: nonEmpty(row.publicId),
    collectionType: collectionTypeOf(row.collectionType),
    name: text(row.name, ctx.locale, ctx.defaultLocale) ?? '',
    description: text(row.description, ctx.locale, ctx.defaultLocale),
    visibility: visibilityOf(row.visibility),
    page: pageRefOf(row.hasPage, row.slugMap, ctx.locale),
    currency: effectiveCurrency({ currency: ctx.config.currency }),
    sections: roots,
    issues,
    hasOffers,
  }
}

// ── Landing page ──────────────────────────────────────────────────────────────

export function resolveCataloguePage(
  row: RawCataloguePage | null | undefined,
  locale: string,
  defaultLocale?: string | null,
): CataloguePageDTO | null {
  if (!row) return null
  return {
    heroTitle: text(row.heroTitle, locale, defaultLocale),
    heroSubtitle: text(row.heroSubtitle, locale, defaultLocale),
    seoTitle: text(row.seoTitle, locale, defaultLocale),
    seoDescription: text(row.seoDescription, locale, defaultLocale),
    sections: Array.isArray(row.sections) ? row.sections : [],
  }
}
