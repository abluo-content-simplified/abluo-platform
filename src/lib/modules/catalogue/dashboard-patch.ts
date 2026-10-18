// ── Catalogue — dashboard patch validation (pure, server side) ────────────────
//
// Authority: ADR-033 (D2, D7, D14, A1–A3, A7), spec §11 (validation table).
//
// Every autosave patch the client dashboard sends for an item, a collection or
// an option list passes through `cleanCatalogueSet()` before anything is
// written: a field allowlist per kind, site languages only, length and count
// limits, and every array REBUILT from what the client sent (keys kept when
// safe, values re-typed) — so the stored shape is the schema's, whatever the
// browser sent. Offers are rebuilt WITHOUT `currency` (reserved, D7/A6); the
// reserved `locationKey` is never taken from the client and only carried over
// from the stored offer with the same `_key` (D14: identity is the key).
//
// No I/O. References (photos, items, option lists) are returned for the caller
// to check against the project; the slug namespace check is the caller's too.

import { ALLERGEN_DECLARATION_STATUSES, isAllergenKey, orderedAllergens, type AllergenDeclarationStatus } from './allergens'
import { offerIssues, type Offer } from './offers'
import { ruleIssues, WEEKDAYS } from './availability'
import { catalogueLinkUrl, CATALOGUE_LINK_LIMITS } from './links'
import { cleanMoreAmazonUrls } from './amazon-delivery'
import { treeIssues, type SectionNode } from './sections'
import { COLLECTION_TYPES, VISIBILITIES, newOrphans, slugFromName } from './dashboard-form'
import type { Referrer } from '@/lib/lifecycle/service'
import type { NamedSlugConflict } from './validation'
import { can, isItemProfile } from './profiles'
import { bookYearMax, normalizeIsbn, parseBookYear } from './isbn'

export type CatalogueKind = 'item' | 'collection' | 'optionList'

export const CATALOGUE_TYPE: Record<CatalogueKind, 'catalogueItem' | 'catalogueCollection' | 'catalogueOptionList'> = {
  item: 'catalogueItem',
  collection: 'catalogueCollection',
  optionList: 'catalogueOptionList',
}

export type CatalogueErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'archived'
  | 'archive_first'
  | 'in_use'
  | 'missing_name'
  | 'missing_slug'
  | 'slug_taken'
  | 'no_options'
  | 'invalid_schedule'
  /** D-3: a food item's allergens are not reviewed (or the declaration is incomplete). */
  | 'allergens_not_reviewed'
  /** E-3: an address exists in a language without a name in it; `detail.locales` names them. */
  | 'slug_without_name'
  /** D-3a: a free-text "add" choice used by a food item is not reviewed; `detail.dependencies` names list · choice. */
  | 'option_allergens_not_reviewed'
  /** D-4: the document references never-published content; `detail.dependencies` names each. */
  | 'unpublished_dependencies'
  | 'failed'

export type CatalogueErrorDetail = {
  conflicts?: NamedSlugConflict[]
  referrers?: Referrer[]
  /** D-4/D-5: the documents a publish depends on (never published, or not publishable by this editor). */
  dependencies?: Referrer[]
  /** E-3: the languages with an address but no name. */
  locales?: string[]
  field?: string
}

export class CatalogueError extends Error {
  constructor(
    readonly code: CatalogueErrorCode,
    message: string,
    readonly detail?: CatalogueErrorDetail
  ) {
    super(message)
    this.name = 'CatalogueError'
  }
}

export const CATALOGUE_LIMITS = {
  name: 120,
  byline: 160,
  /** Amendment I-3.2 — one free-text line. */
  author: 120,
  /** Amendment K — the publisher, one free-text line. */
  publisher: 120,
  /** An ISBN is 10 or 13 characters; the rest is slack for what was typed (never refused). */
  isbn: 32,
  description: 600,
  optionLabel: 80,
  images: 10,
  offers: 24,
  availability: 7,
  categories: 20,
  tags: 20,
  dietary: 20,
  optionLists: 12,
  options: 60,
  sections: 120,
  sectionItems: 300,
  patchBytes: 200_000,
  maxPrice: 9_999_999,
  /** Catalogue documents (drafts + published) per project and kind — caps create abuse. */
  documents: 3000,
} as const

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SLUG = /^[\p{Ll}\p{Lo}\p{N}]+(?:-[\p{Ll}\p{Lo}\p{N}]+)*$/u

const bad = (message: string, field?: string): never => {
  throw new CatalogueError('invalid_value', message, field ? { field } : undefined)
}

export type PatchContext = {
  locales: ReadonlySet<string>
  channels: readonly string[]
  categories: readonly string[]
  /** Slice 7 — keys of the project's tag terms. */
  tags: readonly string[]
  dietary: readonly string[]
  /** The draft as stored (for offer locationKeys and pre-existing orphan sections). */
  previous: Record<string, unknown>
  newKey: () => string
}

export type CleanedPatch = {
  set: Record<string, unknown>
  unset: string[]
  setIfMissing: Record<string, unknown>
  /** Ids to check against the project before writing. */
  refs: { mediaAssets: string[]; items: string[]; optionLists: string[] }
  /** Slugs this patch sets (locale → slug), for the namespace check. */
  slugs: Record<string, string>
  /** `hasPage` after this patch, when it changes. */
  hasPage?: boolean
}

const FIELDS: Record<CatalogueKind, { localized: Record<string, { max: number; type: 'localizedString' | 'localizedText' }>; plain: readonly string[] }> = {
  item: {
    localized: {
      name: { max: CATALOGUE_LIMITS.name, type: 'localizedString' },
      byline: { max: CATALOGUE_LIMITS.byline, type: 'localizedString' },
      description: { max: CATALOGUE_LIMITS.description, type: 'localizedText' },
    },
    plain: ['itemProfile', 'bookDetails', 'categories', 'tags', 'links', 'images', 'offers', 'allergenDeclaration', 'dietary', 'optionLists', 'hasPage', 'visibility'],
  },
  collection: {
    localized: { name: { max: CATALOGUE_LIMITS.name, type: 'localizedString' }, description: { max: CATALOGUE_LIMITS.description, type: 'localizedText' } },
    plain: ['collectionType', 'sections', 'hasPage', 'visibility'],
  },
  optionList: {
    localized: { name: { max: CATALOGUE_LIMITS.name, type: 'localizedString' } },
    plain: ['options'],
  },
}

const ROUTABLE: ReadonlySet<CatalogueKind> = new Set(['item', 'collection'])

/** The allowlist alone — run before any read so a bad field costs nothing. */
export function assertAllowedPaths(kind: CatalogueKind, set: unknown): asserts set is Record<string, unknown> {
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new CatalogueError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(set).length > CATALOGUE_LIMITS.patchBytes) throw new CatalogueError('too_large', 'Too much at once.')
  const f = FIELDS[kind]
  for (const path of Object.keys(set)) {
    const [field, locale, ...rest] = path.split('.')
    const ok =
      (rest.length === 0 && locale === undefined && f.plain.includes(field)) ||
      (rest.length === 0 && !!locale && (field in f.localized || (field === 'slug' && ROUTABLE.has(kind))))
    if (!ok) throw new CatalogueError('invalid_field', `Field "${path}" cannot be changed here.`)
  }
}

function cleanText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max) bad('Too long or not text.', field)
  return (value as string).trim().replace(/[ \t]+/g, ' ')
}

function cleanLocalizedObject(value: unknown, locales: ReadonlySet<string>, max: number, field: string): Record<string, string> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) bad('One text per language.', field)
  const out: Record<string, string> = {}
  for (const [l, v] of Object.entries(value as Record<string, unknown>)) {
    if (l.startsWith('_')) continue
    if (!locales.has(l)) bad(`Language "${l}" is not on this site.`, field)
    const t = cleanText(v, max, field)
    if (t) out[l] = t
  }
  return out
}

function keyOr(raw: unknown, seen: Set<string>, newKey: () => string): string {
  let k = typeof raw === 'string' && KEY.test(raw) && !seen.has(raw) ? raw : ''
  while (!k || seen.has(k)) k = newKey()
  seen.add(k)
  return k
}

function stringSet(value: unknown, allowed: (v: string) => boolean, max: number, field: string): string[] {
  if (!Array.isArray(value) || value.length > max) bad('Too many values.', field)
  const out: string[] = []
  for (const v of value as unknown[]) {
    if (typeof v !== 'string' || !allowed(v)) bad('Unknown value.', field)
    if (!out.includes(v as string)) out.push(v as string)
  }
  return out
}

const twoDecimals = (n: number) => Math.round(n * 100) === Number((n * 100).toFixed(4))

/** Rebuilds `offers` (spec §4.2/§11): price ≥ 0 with ≤ 2 decimals, channel configured, from ≠ to, no overlap within a scope. */
export function cleanOffers(value: unknown, ctx: Pick<PatchContext, 'channels' | 'previous' | 'newKey'>): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > CATALOGUE_LIMITS.offers) bad('Too many prices.', 'offers')
  const prevLocation = new Map<string, string>()
  for (const o of (Array.isArray(ctx.previous.offers) ? ctx.previous.offers : []) as Record<string, unknown>[]) {
    if (typeof o?._key === 'string' && typeof o.locationKey === 'string' && o.locationKey) prevLocation.set(o._key, o.locationKey)
  }
  const seen = new Set<string>()
  const offers = (value as Record<string, unknown>[]).map((raw) => {
    if (!raw || typeof raw !== 'object') bad('Bad price.', 'offers')
    const price = raw.price
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > CATALOGUE_LIMITS.maxPrice || !twoDecimals(price)) {
      bad('A price is a positive amount with at most two decimals.', 'offers')
    }
    const channel = raw.channel == null || raw.channel === '' ? null : raw.channel
    if (channel !== null && (typeof channel !== 'string' || !ctx.channels.includes(channel))) bad(`Unknown service channel "${String(channel)}".`, 'offers')
    const key = keyOr(raw._key, seen, ctx.newKey)
    const av = raw.availability == null ? [] : raw.availability
    if (!Array.isArray(av) || av.length > CATALOGUE_LIMITS.availability) bad('Too many serving times.', 'offers')
    const aSeen = new Set<string>()
    const availability = (av as Record<string, unknown>[]).map((a) => {
      if (!a || typeof a !== 'object') bad('Bad serving time.', 'offers')
      const days = a.days == null ? [] : a.days
      if (!Array.isArray(days) || days.some((d) => !WEEKDAYS.includes(d as never))) bad('Unknown day.', 'offers')
      const from = typeof a.from === 'string' && a.from ? a.from : undefined
      const to = typeof a.to === 'string' && a.to ? a.to : undefined
      const rule = { days: days as string[], from: from ?? null, to: to ?? null }
      if (ruleIssues(rule).length) bad('A serving time needs a start and an end that differ.', 'offers')
      const orderedDays = WEEKDAYS.filter((d) => (days as string[]).includes(d))
      return {
        _key: keyOr(a._key, aSeen, ctx.newKey),
        _type: 'catalogueAvailability',
        ...(orderedDays.length ? { days: orderedDays } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }
    })
    const loc = prevLocation.get(key)
    return {
      _key: key,
      _type: 'catalogueOffer',
      ...(channel ? { channel } : {}),
      price,
      ...(availability.length ? { availability } : {}),
      // Reserved (D14/A5): never from the client; kept only where Studio already set it.
      ...(loc ? { locationKey: loc } : {}),
    }
  })
  const issues = offerIssues(offers as unknown as Offer[], ctx.channels)
  if (issues.some((i) => i.kind === 'overlappingOffers')) bad('Two prices for the same channel overlap in time.', 'offers')
  if (issues.length) bad('Check the prices.', 'offers')
  return offers
}

/**
 * F-2 — rebuilds `links`: ≤ 12 entries, each with a label in at least one site
 * language and an http(s) address that passes the platform href gate
 * (javascript:, data:, mailto:, relative and protocol-relative are refused).
 */
export function cleanLinks(value: unknown, ctx: Pick<PatchContext, 'locales' | 'newKey'>): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > CATALOGUE_LINK_LIMITS.links) bad('Too many links.', 'links')
  const seen = new Set<string>()
  return (value as Record<string, unknown>[]).map((raw) => {
    if (!raw || typeof raw !== 'object') bad('Bad link.', 'links')
    const label = cleanLocalizedObject(raw.label, ctx.locales, CATALOGUE_LINK_LIMITS.label, 'links')
    // A buy link may go without a label: the website then shows the localized "Buy" (Amendment K).
    if (Object.keys(label).length === 0 && raw.kind !== 'buy') bad('A link needs a label.', 'links')
    const url = catalogueLinkUrl(raw.url)
    if (!url) bad('A link needs a web address starting with http:// or https://.', 'links')
    // Amendment K — additive: `kind` is stored only for a buy link (absent = info, as every older link);
    // `affiliate` only means something on a buy link. Anything else is refused, never guessed.
    if (raw.kind != null && raw.kind !== 'info' && raw.kind !== 'buy') bad('Unknown link kind.', 'links')
    if (raw.affiliate != null && typeof raw.affiliate !== 'boolean') bad('Bad affiliate flag.', 'links')
    const buy = raw.kind === 'buy'
    // Amazon links — other stores' product URLs. Parsed again HERE: the client's preview is never trusted.
    const moreUrls = buy ? cleanMoreAmazonUrls(raw.moreUrls, url!, (m) => bad(m, 'links')) : []
    return {
      _key: keyOr(raw._key, seen, ctx.newKey),
      _type: 'catalogueItemLink',
      ...(Object.keys(label).length ? { label: { _type: 'localizedString', ...label } } : {}),
      url,
      ...(buy ? { kind: 'buy' } : {}),
      ...(buy && raw.affiliate === true ? { affiliate: true } : {}),
      ...(moreUrls.length ? { moreUrls } : {}),
    }
  })
}

/** Rebuilds `optionLists` (attachments): known list ids, min ≥ 0, min ≤ max (max may exceed the list — a warning, D2). */
export function cleanAttachments(value: unknown, newKey: () => string): { value: Record<string, unknown>[]; lists: string[] } {
  if (!Array.isArray(value) || value.length > CATALOGUE_LIMITS.optionLists) bad('Too many option lists.', 'optionLists')
  const seen = new Set<string>()
  const lists: string[] = []
  const out = (value as Record<string, unknown>[]).map((raw) => {
    const listId = raw?.listId ?? (raw?.list as { _ref?: unknown } | undefined)?._ref
    if (typeof listId !== 'string' || !DOC_ID.test(listId)) bad('Unknown option list.', 'optionLists')
    const min = raw.min == null ? 0 : raw.min
    const max = raw.max == null ? null : raw.max
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || min > 99) bad('Bad minimum.', 'optionLists')
    if (max !== null && (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 99)) bad('Bad maximum.', 'optionLists')
    if (max !== null && (min as number) > (max as number)) bad('The minimum is above the maximum.', 'optionLists')
    lists.push(listId as string)
    return {
      _key: keyOr(raw._key, seen, newKey),
      _type: 'catalogueItemOptionList',
      list: { _type: 'reference', _ref: listId },
      min,
      ...(max !== null ? { max } : {}),
    }
  })
  return { value: out, lists: [...new Set(lists)] }
}

/** Rebuilds an option list's `options`: label per language, kind add/remove, price change (may be negative), optional linked item. */
export function cleanOptions(value: unknown, locales: ReadonlySet<string>, newKey: () => string): { value: Record<string, unknown>[]; items: string[] } {
  if (!Array.isArray(value) || value.length > CATALOGUE_LIMITS.options) bad('Too many options.', 'options')
  const seen = new Set<string>()
  const items: string[] = []
  const out = (value as Record<string, unknown>[]).map((raw) => {
    if (!raw || typeof raw !== 'object') bad('Bad option.', 'options')
    const label = cleanLocalizedObject(raw.label, locales, CATALOGUE_LIMITS.optionLabel, 'options')
    const kind = raw.kind == null ? 'add' : raw.kind
    if (kind !== 'add' && kind !== 'remove') bad('Unknown option kind.', 'options')
    const delta = raw.priceDelta == null ? 0 : raw.priceDelta
    if (typeof delta !== 'number' || !Number.isFinite(delta) || Math.abs(delta) > CATALOGUE_LIMITS.maxPrice || !twoDecimals(delta)) bad('Bad price change.', 'options')
    const itemId = raw.itemId ?? (raw.item as { _ref?: unknown } | undefined)?._ref ?? null
    if (itemId !== null && (typeof itemId !== 'string' || !DOC_ID.test(itemId))) bad('Unknown item.', 'options')
    if (itemId) items.push(itemId as string)
    // D-3a: only a free-text "add" choice carries its own declaration (no note);
    // a linked choice takes its item's, a "remove" never subtracts allergens.
    const freeAdd = kind === 'add' && !itemId
    const allergenDeclaration = freeAdd ? (raw.allergenDeclaration == null ? { status: 'notReviewed' } : cleanAllergenDeclaration(raw.allergenDeclaration, locales, { note: false })) : null
    return {
      _key: keyOr(raw._key, seen, newKey),
      _type: 'catalogueOption',
      label: { _type: 'localizedString', ...label },
      kind,
      priceDelta: delta,
      ...(itemId ? { item: { _type: 'reference', _ref: itemId } } : {}),
      ...(allergenDeclaration ? { allergenDeclaration } : {}),
    }
  })
  return { value: out, items: [...new Set(items)] }
}

/**
 * Rebuilds `sections`: unique keys, names per language, items as references.
 * Refuses what the editor must never CREATE (A7): a new orphan (a parentKey
 * naming no section) or a cycle. A pre-existing orphan — same key, same
 * parentKey as stored — passes, so broken content stays visible until repaired.
 */
export function cleanSections(value: unknown, ctx: Pick<PatchContext, 'locales' | 'previous' | 'newKey'>): { value: Record<string, unknown>[]; items: string[] } {
  if (!Array.isArray(value) || value.length > CATALOGUE_LIMITS.sections) bad('Too many sections.', 'sections')
  const seen = new Set<string>()
  const items: string[] = []
  const out = (value as Record<string, unknown>[]).map((raw) => {
    if (!raw || typeof raw !== 'object') bad('Bad section.', 'sections')
    if (typeof raw._key !== 'string' || !KEY.test(raw._key) || seen.has(raw._key)) bad('Bad section key.', 'sections')
    seen.add(raw._key as string)
    const name = cleanLocalizedObject(raw.name, ctx.locales, CATALOGUE_LIMITS.name, 'sections')
    const parentKey = raw.parentKey == null || raw.parentKey === '' ? null : raw.parentKey
    if (parentKey !== null && (typeof parentKey !== 'string' || !KEY.test(parentKey))) bad('Bad parent.', 'sections')
    const ids = raw.items == null ? [] : raw.items
    if (!Array.isArray(ids) || ids.length > CATALOGUE_LIMITS.sectionItems) bad('Too many items in a section.', 'sections')
    const iSeen = new Set<string>()
    const refs = (ids as unknown[]).map((r) => {
      const id = typeof r === 'string' ? r : (r as { _ref?: unknown } | null)?._ref
      if (typeof id !== 'string' || !DOC_ID.test(id)) bad('Unknown item.', 'sections')
      items.push(id as string)
      return { _key: keyOr((r as { _key?: unknown } | null)?._key, iSeen, ctx.newKey), _type: 'reference', _ref: id }
    })
    return { _key: raw._key, _type: 'catalogueSection', name: { _type: 'localizedString', ...name }, ...(parentKey ? { parentKey } : {}), items: refs }
  })
  const previous = (Array.isArray(ctx.previous.sections) ? ctx.previous.sections : []) as SectionNode[]
  if (newOrphans(previous, out as unknown as SectionNode[]).length) bad('A subsection needs an existing parent section.', 'sections')
  const cycle = treeIssues(out as unknown as SectionNode[]).find((i) => i.kind === 'cycle')
  if (cycle && cycle.kind === 'cycle') {
    const before = new Map(previous.map((s) => [s._key, s.parentKey ?? null]))
    const fresh = cycle.keys.some((k) => before.get(k) !== ((out.find((s) => s._key === k) as { parentKey?: string } | undefined)?.parentKey ?? null))
    if (fresh) bad('A section cannot sit inside itself.', 'sections')
  }
  return { value: out, items: [...new Set(items)] }
}

/** The whole patch, field by field. Pure; throws CatalogueError on the first refused value. */
export function cleanCatalogueSet(kind: CatalogueKind, input: Record<string, unknown>, ctx: PatchContext): CleanedPatch {
  assertAllowedPaths(kind, input)
  const r: CleanedPatch = { set: {}, unset: [], setIfMissing: {}, refs: { mediaAssets: [], items: [], optionLists: [] }, slugs: {} }
  const f = FIELDS[kind]
  for (const [path, value] of Object.entries(input)) {
    const [field, locale] = path.split('.')
    if (locale !== undefined) {
      if (!ctx.locales.has(locale)) throw new CatalogueError('invalid_field', `Language "${locale}" is not on this site.`)
      if (field === 'slug') {
        if (value === '' || value === null) {
          r.unset.push(`slug.${locale}`)
          continue
        }
        if (typeof value !== 'string' || value.length > 96) bad('Bad address.', path)
        const slug = slugFromName(value as string)
        if (!slug || !SLUG.test(slug)) bad('Bad address.', path)
        r.setIfMissing.slug = { _type: 'localizedSlug' }
        r.set[`slug.${locale}`] = { _type: 'slug', current: slug }
        r.slugs[locale] = slug
        continue
      }
      const spec = f.localized[field]
      const t = cleanText(value, spec.max, path)
      r.setIfMissing[field] = { _type: spec.type }
      if (t) r.set[path] = t
      else r.unset.push(path)
      continue
    }
    switch (field) {
      case 'itemProfile':
        if (!isItemProfile(value)) bad('Unknown profile.', field)
        r.set.itemProfile = value
        break
      case 'collectionType':
        if (!COLLECTION_TYPES.includes(value as never)) bad('Unknown collection type.', field)
        r.set.collectionType = value
        break
      case 'visibility':
        if (!VISIBILITIES.includes(value as never)) bad('Unknown visibility.', field)
        r.set.visibility = value
        break
      case 'hasPage':
        if (typeof value !== 'boolean') bad('Must be true or false.', field)
        r.set.hasPage = value
        r.hasPage = value as boolean
        break
      case 'categories': {
        const v = stringSet(value, (c) => ctx.categories.includes(c), CATALOGUE_LIMITS.categories, field)
        if (v.length) r.set.categories = v
        else r.unset.push('categories')
        break
      }
      case 'tags': {
        const v = stringSet(value, (c) => ctx.tags.includes(c), CATALOGUE_LIMITS.tags, field)
        if (v.length) r.set.tags = v
        else r.unset.push('tags')
        break
      }
      case 'dietary': {
        const v = stringSet(value, (c) => ctx.dietary.includes(c), CATALOGUE_LIMITS.dietary, field)
        if (v.length) r.set.dietary = v
        else r.unset.push('dietary')
        break
      }
      case 'allergenDeclaration':
        r.set.allergenDeclaration = cleanAllergenDeclaration(value, ctx.locales)
        break
      case 'bookDetails': {
        const v = cleanBookDetails(value)
        if (v) r.set.bookDetails = v
        else r.unset.push('bookDetails')
        break
      }
      case 'images': {
        const ids = stringSet(value, (id) => DOC_ID.test(id), CATALOGUE_LIMITS.images, field)
        r.refs.mediaAssets.push(...ids)
        const seen = new Set<string>()
        if (ids.length) r.set.images = ids.map((id) => ({ _key: keyOr(null, seen, ctx.newKey), _type: 'reference', _ref: id }))
        else r.unset.push('images')
        break
      }
      case 'offers': {
        const v = cleanOffers(value, ctx)
        if (v.length) r.set.offers = v
        else r.unset.push('offers')
        break
      }
      case 'links': {
        const v = cleanLinks(value, ctx)
        if (v.length) r.set.links = v
        else r.unset.push('links')
        break
      }
      case 'optionLists': {
        const v = cleanAttachments(value, ctx.newKey)
        r.refs.optionLists.push(...v.lists)
        if (v.value.length) r.set.optionLists = v.value
        else r.unset.push('optionLists')
        break
      }
      case 'options': {
        const v = cleanOptions(value, ctx.locales, ctx.newKey)
        r.refs.items.push(...v.items)
        r.set.options = v.value
        break
      }
      case 'sections': {
        const v = cleanSections(value, ctx)
        r.refs.items.push(...v.items)
        r.set.sections = v.value
        break
      }
      default:
        throw new CatalogueError('invalid_field', `Field "${path}" cannot be changed here.`)
    }
  }
  if (kind === 'item') applyItemRules(r, input, ctx.previous)
  if (ROUTABLE.has(kind)) applySlugNameRule(r, input, ctx.previous)
  return r
}

// ── Book details (Amendment I-3) ──────────────────────────────────────────────

const BOOK_INPUT_KEYS = new Set(['author', 'publisher', 'year', 'isbn'])

/**
 * All three values are optional and blank is always fine. The author is one
 * line of text; the year, when given, is a whole number from 1000 to next year
 * (anything else is refused, naming the field); the ISBN is NEVER refused — it
 * is stored without spaces and hyphens, as typed otherwise (the editor only
 * advises, structured data only emits a valid one). Null when nothing is left,
 * which unsets the field. Whether the item's profile shows them is the
 * reader's decision: a changed type keeps the values hidden.
 */
export function cleanBookDetails(value: unknown): Record<string, unknown> | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) bad('Unknown book details.', 'bookDetails')
  const v = value as Record<string, unknown>
  for (const k of Object.keys(v)) if (!k.startsWith('_') && !BOOK_INPUT_KEYS.has(k)) bad('Unknown book detail.', 'bookDetails')
  const out: Record<string, unknown> = {}
  if (v.author != null) {
    const author = cleanText(v.author, CATALOGUE_LIMITS.author, 'bookDetails.author')
    if (author) out.author = author
  }
  if (v.publisher != null) {
    const publisher = cleanText(v.publisher, CATALOGUE_LIMITS.publisher, 'bookDetails.publisher')
    if (publisher) out.publisher = publisher
  }
  if (v.year != null && !(typeof v.year === 'string' && v.year.trim() === '')) {
    const year = parseBookYear(v.year)
    if (year === null) bad(`The year must be a whole number from 1000 to ${bookYearMax()}.`, 'bookDetails.year')
    out.year = year
  }
  const isbn = normalizeIsbn(v.isbn).slice(0, CATALOGUE_LIMITS.isbn)
  if (isbn) out.isbn = isbn
  return Object.keys(out).length ? out : null
}

// ── Allergen declaration (ADR-033 D-3) ────────────────────────────────────────

const DECLARATION_INPUT_KEYS = new Set(['status', 'allergens', 'mayContain', 'confirmed', 'note'])

/**
 * Rebuilds a declaration with only its status's own fields. Unknown keys and
 * unknown allergen keys are refused. Incomplete states SAVE ("contains" with
 * nothing ticked yet, "none" not yet confirmed) so autosave never loses work;
 * publishing refuses them (publishBlockers).
 */
export function cleanAllergenDeclaration(value: unknown, locales: ReadonlySet<string>, opts: { note?: boolean } = {}): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Unknown allergen declaration.', 'allergenDeclaration')
  const v = value as Record<string, unknown>
  const allowNote = opts.note !== false
  for (const k of Object.keys(v)) if (!k.startsWith('_') && (!DECLARATION_INPUT_KEYS.has(k) || (k === 'note' && !allowNote))) bad('Unknown allergen declaration field.', 'allergenDeclaration')
  const status = v.status as AllergenDeclarationStatus
  if (!ALLERGEN_DECLARATION_STATUSES.includes(status)) bad('Unknown allergen declaration.', 'allergenDeclaration')
  if (status === 'notReviewed') return { status }
  const note = cleanLocalizedObject(v.note, locales, CATALOGUE_LIMITS.description, 'allergenDeclaration')
  const withNote = Object.keys(note).length ? { note: { _type: 'localizedText', ...note } } : {}
  const keys = (x: unknown) => orderedAllergens(stringSet(x == null ? [] : x, isAllergenKey, 14, 'allergenDeclaration'))
  const mayContain = keys(v.mayContain)
  // E-1: "may contain" is kept in BOTH reviewed states.
  if (status === 'noneDeclared') return { status, confirmed: v.confirmed === true, ...(mayContain.length ? { mayContain } : {}), ...withNote }
  return { status, allergens: keys(v.allergens), ...(mayContain.length ? { mayContain } : {}), ...withNote }
}

/**
 * D-3 on a patch: a declaration belongs to food and drink only, and changing
 * an item's profile TO food resets it to `notReviewed` (whatever else the
 * patch says) — the editor must review it for this item. Away from food the
 * declaration is removed (it would never be shown).
 */
function applyItemRules(r: CleanedPatch, input: Record<string, unknown>, previous: Record<string, unknown>) {
  const before = previous.itemProfile
  const after = 'itemProfile' in input ? input.itemProfile : before
  if (!(isItemProfile(after) && can(after, 'foodInformation'))) {
    // Never stored for a product or service (a queued food edit racing a profile change is dropped, not an error).
    delete r.set.allergenDeclaration
    if (('itemProfile' in input || 'allergenDeclaration' in input) && previous.allergenDeclaration != null) r.unset.push('allergenDeclaration')
    return
  }
  if (!(isItemProfile(before) && can(before, 'foodInformation'))) r.set.allergenDeclaration = { status: 'notReviewed' }
}

/**
 * D-7 / E-3 — an address for a language exists only when the name is written
 * in it. Setting `slug.<l>` without a name in <l> is refused (naming the
 * language). Clearing `name.<l>` NEVER removes the address behind the editor's
 * back: the dashboard offers to clear it (with Undo), and publishing refuses
 * while it stays (`slug_without_name`).
 */
function applySlugNameRule(r: CleanedPatch, input: Record<string, unknown>, previous: Record<string, unknown>) {
  const prevNames = (previous.name && typeof previous.name === 'object' ? previous.name : {}) as Record<string, unknown>
  const nameAfter = (l: string) => {
    const k = `name.${l}`
    if (k in r.set) return String(r.set[k])
    if (r.unset.includes(k)) return ''
    return typeof prevNames[l] === 'string' ? (prevNames[l] as string).trim() : ''
  }
  const missing = Object.keys(r.slugs).filter((l) => !nameAfter(l))
  // invalid_value (not slug_without_name): the autosave drops just this path and shows it as refused.
  if (missing.length) throw new CatalogueError('invalid_value', 'Add the name in this language first.', { locales: missing, field: `slug.${missing[0]}` })
  void input
}

/** E-3 — languages whose address has no name in that language (publish refuses them). */
export function slugLocalesWithoutName(slugs: Record<string, string>, names: Record<string, string>): string[] {
  return Object.keys(slugs).filter((l) => !names[l]?.trim())
}

/**
 * Slugs a document gets when it is published with a page (spec §10.3:
 * "derived from the name per locale, unique per project"). Explicit slugs are
 * kept as typed (a clash is the caller's refusal, naming the other document);
 * a missing one is derived from that language's name and suffixed until free.
 */
export function slugsForPublish(input: {
  names: Record<string, string>
  slugs: Record<string, string>
  locales: readonly string[]
  taken: (locale: string) => ReadonlySet<string>
  fallback: string
}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of input.locales) {
    const explicit = input.slugs[l]
    if (explicit) {
      out[l] = explicit
      continue
    }
    const name = input.names[l]?.trim()
    if (!name) continue
    const base = slugFromName(name) || input.fallback
    const taken = input.taken(l)
    let candidate = base
    for (let n = 2; taken.has(candidate); n++) candidate = `${base.slice(0, 76).replace(/-+$/, '')}-${n}`
    out[l] = candidate
  }
  return out
}
