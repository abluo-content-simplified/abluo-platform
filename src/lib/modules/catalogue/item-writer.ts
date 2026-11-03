// ── Catalogue — the R2 item writer: formats, availability and categories ─────
//
// Authority: C10-6 R2 row, C3 (formats), C4 (prices), C5/C5a (availability
// rows + schedules), C1 (assignment), D-10, D-15, D-21.
//
// The dashboard's item save path (`cleanCatalogueSet`) calls these. Pure: no
// I/O, no clock. Every value is REBUILT from what the client sent into the
// stored shapes of schema-commerce.ts, then validated with the commerce and
// taxonomy pure functions (formatIssues, priceIssues, availabilityRowIssues,
// validateAssignment) — the same rules everywhere, never a second copy.
//
// The writer switches shape ON THE DOCUMENT IT WRITES (C10-6 governing rule):
//   * whenever it writes commerce (or the stored draft still carries legacy
//     `offers`), it writes `formats` (+ `channelAvailability`) and UNSETS `offers`;
//   * whenever it writes categories (or the draft still carries legacy
//     `categories`), it writes `primaryCategory`/`additionalCategories` and
//     UNSETS `categories`.
// A legacy document is therefore converted on its FIRST save, whatever field
// that save touches, with exactly the values the dual-read showed (C10-3 /
// C10-4 / C1.9 mappings — the same pure functions), so nothing visible changes.

import { normalizeIsbn } from './isbn'
import { isItemProfile, type ItemProfile } from './profiles'
import { availabilityRowIssues } from './commerce/channel-availability'
import { readChannels, type ChannelSet } from './commerce/channels'
import { CHANNEL_LIMIT, FORMAT_LIMIT, OVERRIDES_PER_RULE_LIMIT, PRICES_PER_FORMAT_LIMIT, isChannelAvailabilityState, type ChannelAvailabilityRule } from './commerce/commerce-types'
import { IMPLICIT_FORMAT_KEY } from './commerce/format-key'
import { formatIssues, QUANTITY_UNITS } from './commerce/formats'
import { commerceOf, legacyOffersToFormats } from './commerce/legacy-commerce'
import { priceIssues } from './commerce/prices'
import { readFormatDocs } from './commerce/read'
import { WEEKDAYS } from './commerce/windows'
import { WEEKLY_OVERRIDE_TYPE } from './commerce/availability-schedule'
import { flatTree, itemCategoryAssignment } from './taxonomy/read'
import { validateAssignment } from './taxonomy/tree'
import { assignmentPatch, ruleRow } from './taxonomy/write-model'
import { MAX_ADDITIONAL_CATEGORIES } from './taxonomy/limits'
import type { CategoryAssignment, CategoryTree } from './taxonomy/types'

/** What a refusal needs: the server's message and the field it is about (dashboard-patch `bad`). */
export type Refuse = (message: string, field: string) => never

export const ITEM_WRITER_LIMITS = {
  formatLabel: 80,
  identifier: 64,
  templateKey: 64,
  priceNote: 80,
  windows: 7,
  maxPrice: 9_999_999,
} as const

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const twoDecimals = (n: number) => Math.round(n * 100) === Number((n * 100).toFixed(4))
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export type WriterContext = {
  locales: ReadonlySet<string>
  channelSet: ChannelSet
  categoryTree: CategoryTree
  previous: Record<string, unknown>
  newKey: () => string
}

/** The channel set a writer uses: the project's (readChannels over `serviceChannels`), or the bare key list of an older caller. */
export function writerChannels(raw: unknown, keys: readonly string[]): ChannelSet {
  if (Array.isArray(raw)) return readChannels(raw).channels
  return readChannels(keys.map((value) => ({ value, label: {} }))).channels
}

/** The tree a writer validates against: the project's, or a flat tree over the vocabulary keys of an older caller. */
export const writerTree = (tree: CategoryTree | undefined, keys: readonly string[]): CategoryTree => tree ?? flatTree(keys)

function keyOr(raw: unknown, seen: Set<string>, newKey: () => string): string {
  let k = typeof raw === 'string' && KEY.test(raw) && !seen.has(raw) ? raw : ''
  while (!k || seen.has(k)) k = newKey()
  seen.add(k)
  return k
}

function text(value: unknown, max: number, field: string, refuse: Refuse): string {
  if (typeof value !== 'string' || value.length > max) refuse('Too long or not text.', field)
  return (value as string).trim().replace(/[ \t]+/g, ' ')
}

function localizedText(value: unknown, locales: ReadonlySet<string>, max: number, field: string, refuse: Refuse): Record<string, string> {
  if (value == null) return {}
  if (!isObj(value)) refuse('One text per language.', field)
  const out: Record<string, string> = {}
  for (const [l, v] of Object.entries(value as Record<string, unknown>)) {
    if (l.startsWith('_')) continue
    if (!locales.has(l)) refuse(`Language "${l}" is not on this site.`, field)
    const t = text(v, max, field, refuse)
    if (t) out[l] = t
  }
  return out
}

function hhmm(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function days(v: unknown, field: string, refuse: Refuse): string[] {
  const d = v == null ? [] : v
  if (!Array.isArray(d) || d.some((x) => !WEEKDAYS.includes(x as never))) refuse('Unknown day.', field)
  return WEEKDAYS.filter((x) => (d as string[]).includes(x))
}

// ── Availability rows (C5-7, C5a-2) ──────────────────────────────────────────

/** One explicit rule from the client: `{ state, schedule?: [{ _key?, days?, from?, to?, state }] }`. */
export function cleanRule(raw: unknown, field: string, refuse: Refuse, newKey: () => string): ChannelAvailabilityRule {
  if (!isObj(raw)) refuse('Bad availability.', field)
  const r = raw as Record<string, unknown>
  if (!isChannelAvailabilityState(r.state)) refuse('Available or unavailable.', field)
  const schedule = r.schedule == null ? [] : r.schedule
  if (!Array.isArray(schedule) || schedule.length > OVERRIDES_PER_RULE_LIMIT) refuse('Too many hours.', field)
  const seen = new Set<string>()
  const overrides = (schedule as unknown[]).map((o) => {
    if (!isObj(o)) refuse('Bad hours.', field)
    const x = o as Record<string, unknown>
    if (x._type !== undefined && x._type !== WEEKLY_OVERRIDE_TYPE) refuse('Unknown kind of hours.', field)
    if (!isChannelAvailabilityState(x.state)) refuse('Available or unavailable.', field)
    return { kind: 'weekly' as const, key: keyOr(x._key ?? x.key, seen, newKey), days: days(x.days, field, refuse) as never[], from: hhmm(x.from) ?? null, to: hhmm(x.to) ?? null, state: x.state as ChannelAvailabilityRule['state'] }
  })
  return { state: r.state as ChannelAvailabilityRule['state'], overrides }
}

/**
 * Rebuilds rule rows (item `channelAvailability` or a format's): `_key` = channel (C5-7), one row
 * per channel, through the one row writer (`ruleRow`), then `availabilityRowIssues` — errors refuse.
 */
export function cleanRuleRows(value: unknown, ctx: Pick<WriterContext, 'channelSet' | 'newKey'>, field: string, refuse: Refuse): Record<string, unknown>[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > CHANNEL_LIMIT) refuse('Too many channels.', field)
  const seen = new Set<string>()
  const rows = (value as unknown[]).map((raw) => {
    if (!isObj(raw)) refuse('Bad availability.', field)
    const r = raw as Record<string, unknown>
    const channel = typeof r.channel === 'string' && r.channel ? r.channel : typeof r._key === 'string' ? r._key : ''
    if (!channel) refuse('Unknown channel.', field)
    if (seen.has(channel)) refuse('One rule per channel.', field)
    seen.add(channel)
    return ruleRow(channel, cleanRule(r, field, refuse, ctx.newKey))
  })
  const errors = availabilityRowIssues(rows, ctx.channelSet).filter((i) => i.level === 'error')
  if (errors.length) refuse(errors[0].code === 'availability.unknownChannel' ? `Unknown service channel "${errors[0].channel}".` : 'Check the hours.', field)
  return rows
}

// ── Formats and prices (C3, C4) ───────────────────────────────────────────────

function cleanPrice(raw: unknown, ctx: Pick<WriterContext, 'locales' | 'newKey'>, seen: Set<string>, refuse: Refuse): Record<string, unknown> {
  if (!isObj(raw)) refuse('Bad price.', 'formats')
  const p = raw as Record<string, unknown>
  // Reserved (D7, D14, A5; REVIEW X-14): never written by the dashboard.
  if (p.currency != null || p.locationKey != null) refuse('This price field cannot be changed here.', 'formats')
  const amount = p.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > ITEM_WRITER_LIMITS.maxPrice || !twoDecimals(amount)) refuse('A price is a positive amount with at most two decimals.', 'formats')
  const channel = p.channel == null || p.channel === '' ? null : p.channel
  if (channel !== null && typeof channel !== 'string') refuse('Unknown service channel.', 'formats')
  const note = localizedText(p.note, ctx.locales, ITEM_WRITER_LIMITS.priceNote, 'formats', refuse)
  const w = p.windows == null ? [] : p.windows
  if (!Array.isArray(w) || w.length > ITEM_WRITER_LIMITS.windows) refuse('Too many times for one price.', 'formats')
  const wSeen = new Set<string>()
  const windows = (w as unknown[]).map((x) => {
    if (!isObj(x)) refuse('Bad time.', 'formats')
    const r = x as Record<string, unknown>
    const d = days(r.days, 'formats', refuse)
    const from = hhmm(r.from)
    const to = hhmm(r.to)
    return { _key: keyOr(r._key ?? r.key, wSeen, ctx.newKey), _type: 'catalogueWeeklyWindow', ...(d.length ? { days: d } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }
  })
  return {
    _key: keyOr(p._key ?? p.key, seen, ctx.newKey),
    _type: 'cataloguePrice',
    amount,
    ...(channel ? { channel } : {}),
    ...(Object.keys(note).length ? { note: { _type: 'localizedString', ...note } } : {}),
    ...(windows.length ? { windows } : {}),
  }
}

function cleanIdentifiers(raw: unknown, refuse: Refuse): Record<string, string> {
  if (raw == null) return {}
  if (!isObj(raw)) refuse('Bad codes.', 'formats')
  const out: Record<string, string> = {}
  for (const k of ['sku', 'isbn', 'gtin'] as const) {
    const v = (raw as Record<string, unknown>)[k]
    if (v == null || v === '') continue
    const t = text(v, ITEM_WRITER_LIMITS.identifier, 'formats', refuse)
    const value = k === 'isbn' ? normalizeIsbn(t) : k === 'gtin' ? t.replace(/\s+/g, '') : t
    if (value) out[k] = value
  }
  return out
}

function cleanQuantity(raw: unknown, refuse: Refuse): { value: number; unit: string } | null {
  if (raw == null) return null
  if (!isObj(raw)) refuse('Bad quantity.', 'formats')
  const q = raw as Record<string, unknown>
  if (q.value == null && q.unit == null) return null
  if (typeof q.value !== 'number' || typeof q.unit !== 'string' || !QUANTITY_UNITS.includes(q.unit as never)) refuse('A quantity needs an amount and a unit.', 'formats')
  return { value: q.value as number, unit: q.unit as string }
}

export type FormatsContext = WriterContext & { itemProfile: ItemProfile; bookIsbn: string | null; defaultLocale: string }

/**
 * Rebuilds `formats` (C3-3 stored shape) and validates them with the commerce functions:
 * `formatIssues` (labels with ≥ 2 formats, 24 formats, codes, quantity, implicit override),
 * `priceIssues` (amounts, unknown channels, windows, overlap per scope — I-C4-2),
 * `availabilityRowIssues` (format overrides). Errors refuse; warnings save.
 */
export function cleanFormats(value: unknown, ctx: FormatsContext, refuse: Refuse): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > FORMAT_LIMIT) refuse('Too many sizes or formats.', 'formats')
  const seen = new Set<string>()
  const docs = (value as unknown[]).map((raw) => {
    if (!isObj(raw)) refuse('Bad format.', 'formats')
    const f = raw as Record<string, unknown>
    const label = localizedText(f.label, ctx.locales, ITEM_WRITER_LIMITS.formatLabel, 'formats', refuse)
    const identifiers = cleanIdentifiers(f.identifiers, refuse)
    const quantity = cleanQuantity(f.quantity, refuse)
    const templateKey = f.templateKey == null || f.templateKey === '' ? null : f.templateKey
    if (templateKey !== null && (typeof templateKey !== 'string' || !KEY.test(templateKey))) refuse('Unknown template.', 'formats')
    const prices = f.prices == null ? [] : f.prices
    if (!Array.isArray(prices) || prices.length > PRICES_PER_FORMAT_LIMIT) refuse('Too many prices.', 'formats')
    const pSeen = new Set<string>()
    const rows = cleanRuleRows(f.channelAvailability, ctx, 'formats', refuse)
    return {
      _key: keyOr(f._key ?? f.key, seen, ctx.newKey),
      _type: 'catalogueFormat',
      ...(Object.keys(label).length ? { label: { _type: 'localizedString', ...label } } : {}),
      ...(Object.keys(identifiers).length ? { identifiers } : {}),
      ...(quantity ? { quantity } : {}),
      ...(templateKey ? { templateKey } : {}),
      ...(rows.length ? { channelAvailability: rows } : {}),
      prices: (prices as unknown[]).map((p) => cleanPrice(p, ctx, pSeen, refuse)),
    }
  })
  validateFormatDocs(docs, ctx, refuse)
  return docs
}

const FORMAT_MESSAGE: Partial<Record<string, string>> = {
  'format.labelRequired': 'With two or more sizes or formats, each needs a name.',
  'format.limitExceeded': 'Too many sizes or formats.',
  'format.implicitOverride': 'Set the availability on the item itself.',
  'format.isbnConflictsBook': 'Use the ISBN of the book or of the format, not both.',
}

function validateFormatDocs(docs: readonly Record<string, unknown>[], ctx: FormatsContext, refuse: Refuse) {
  const formats = readFormatDocs(docs)
  const formatErrors = formatIssues(formats, { channels: ctx.channelSet, defaultLocale: ctx.defaultLocale, itemProfile: ctx.itemProfile, bookIsbn: ctx.bookIsbn }).filter((i) => i.level === 'error')
  if (formatErrors.length) refuse(FORMAT_MESSAGE[formatErrors[0].code] ?? 'Check the sizes and formats.', 'formats')
  for (const f of formats) {
    const errors = priceIssues(f, ctx.channelSet).filter((i) => i.level === 'error')
    if (!errors.length) continue
    const c = errors[0].code
    refuse(
      c === 'price.overlap' ? 'Two prices for the same channel overlap in time.' : c === 'price.unknownChannel' ? `Unknown service channel "${errors[0].scope}".` : c.startsWith('price.window') ? 'A time needs a start and an end that differ.' : 'Check the prices.',
      'formats',
    )
  }
}

/** True when stored `formats` would say nothing beyond the implicit empty format (absent = implicit, I-C3-1). */
export function isEmptyImplicit(docs: readonly Record<string, unknown>[]): boolean {
  if (docs.length === 0) return true
  if (docs.length > 1) return false
  const f = docs[0]
  return f._key === IMPLICIT_FORMAT_KEY && !f.label && !f.identifiers && !f.quantity && !f.templateKey && !f.channelAvailability && (f.prices as unknown[]).length === 0
}

// ── Shape switch on the written document (C10-6 R2) ──────────────────────────

const hasLegacyOffers = (doc: Record<string, unknown>) => Array.isArray(doc.offers) && doc.offers.some((o) => o !== null && o !== undefined)
const hasFormats = (doc: Record<string, unknown>) => Array.isArray(doc.formats) && doc.formats.length > 0
const hasStoredRules = (doc: Record<string, unknown>) => Array.isArray(doc.channelAvailability) && doc.channelAvailability.length > 0

export type ShapePatch = { set: Record<string, unknown>; unset: string[] }

/**
 * Commerce half of the switch. `written` = what this patch already set for `formats` /
 * `channelAvailability` (undefined = not touched). Returns the final set/unset for the three fields.
 *
 *  - formats: as written; else, on a legacy draft, `legacyOffersToFormats(offers)` (C10-3 — the
 *    same mapping the dual-read shows); `offers` is UNSET whenever the draft carries them.
 *  - channelAvailability: as written; else, on a legacy draft without stored rows in a project
 *    whose channels are still UNMIGRATED (C10-4), the rows the dual-read derived from the offers
 *    (`commerceOf` → old(i, c)) — so availability stays exactly what it was.
 */
export function commerceShape(previous: Record<string, unknown>, written: { formats?: Record<string, unknown>[]; channelAvailability?: Record<string, unknown>[] }, channelSet: ChannelSet): ShapePatch | null {
  const legacy = hasLegacyOffers(previous)
  if (!legacy && written.formats === undefined && written.channelAvailability === undefined) return null
  const out: ShapePatch = { set: {}, unset: [] }
  let formats = written.formats
  if (formats === undefined && legacy && !hasFormats(previous)) formats = legacyOffersToFormats(previous.offers as unknown[]) as unknown as Record<string, unknown>[]
  if (formats !== undefined) {
    if (isEmptyImplicit(formats)) out.unset.push('formats')
    else out.set.formats = formats
  }
  let rows = written.channelAvailability
  if (rows === undefined && legacy && !hasFormats(previous) && !hasStoredRules(previous)) {
    const derived = commerceOf(previous, channelSet).itemRules
    if (derived.size) rows = [...derived].map(([c, rule]) => ruleRow(c, rule))
  }
  if (rows !== undefined) {
    if (rows.length) out.set.channelAvailability = rows
    else out.unset.push('channelAvailability')
  }
  if (Array.isArray(previous.offers)) out.unset.push('offers')
  return out
}

/** Legacy `categories` → assignment (D-15): the first EXISTING category is primary; every stored key is kept, in order. */
export function convertedAssignment(categories: unknown, tree: CategoryTree): CategoryAssignment {
  const keys: string[] = []
  for (const raw of Array.isArray(categories) ? categories : []) {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (k && !keys.includes(k)) keys.push(k)
  }
  const primary = keys.find((k) => tree.nodes.has(k)) ?? keys[0] ?? null
  return { primary, additional: keys.filter((k) => k !== primary) }
}

const ASSIGNMENT_MESSAGE: Record<string, string> = {
  category_unknown: 'Unknown category.',
  category_primary_required: 'Choose a main category first.',
  category_archived_target: 'This category is no longer offered.',
  category_duplicate: 'A category is listed twice.',
  category_too_many: 'Too many categories.',
}

/**
 * Categories half of the switch. `input` holds what the client sent: the new fields
 * (`primaryCategory` string|null, `additionalCategories` string[]) and/or the legacy list
 * (`categories`, from an older open tab or a replayed journal — mapped with the same D-15 rule).
 * Untouched but legacy → converted (no validation: the values are the ones already stored).
 */
export function categoriesShape(previous: Record<string, unknown>, input: Record<string, unknown>, tree: CategoryTree, refuse: Refuse): ShapePatch | null {
  const touched = 'primaryCategory' in input || 'additionalCategories' in input || 'categories' in input
  const legacy = Array.isArray(previous.categories)
  if (!touched && !legacy) return null
  const before = legacy && previous.primaryCategory === undefined && previous.additionalCategories === undefined ? convertedAssignment(previous.categories, tree) : itemCategoryAssignment(previous)
  let next = before
  if (touched) {
    if ('categories' in input) {
      const v = input.categories
      if (!Array.isArray(v) || v.length > MAX_ADDITIONAL_CATEGORIES + 1 || v.some((x) => typeof x !== 'string')) refuse('Too many values.', 'categories')
      next = convertedAssignment(v, tree)
    }
    if ('primaryCategory' in input) {
      const p = input.primaryCategory
      if (p !== null && p !== '' && typeof p !== 'string') refuse('Unknown category.', 'primaryCategory')
      next = { ...next, primary: typeof p === 'string' && p.trim() ? p.trim() : null }
    }
    if ('additionalCategories' in input) {
      const a = input.additionalCategories
      if (a !== null && (!Array.isArray(a) || a.some((x) => typeof x !== 'string'))) refuse('Unknown category.', 'additionalCategories')
      next = { ...next, additional: ((a as string[] | null) ?? []).map((k) => k.trim()).filter(Boolean) }
    }
    // A primary that also sits in additional is the primary (never listed twice).
    next = { primary: next.primary, additional: next.additional.filter((k, i, all) => k !== next.primary && all.indexOf(k) === i) }
    const v = validateAssignment(tree, next, before)
    if (!v.ok) refuse(ASSIGNMENT_MESSAGE[v.code] ?? 'Check the categories.', v.code === 'category_primary_required' ? 'primaryCategory' : 'additionalCategories')
  }
  return assignmentPatch(next)
}

/** The profile and the book ISBN a patch leaves on the item (format validation needs both). */
export function profileAfter(input: Record<string, unknown>, previous: Record<string, unknown>): ItemProfile {
  const p = 'itemProfile' in input ? input.itemProfile : previous.itemProfile
  return isItemProfile(p) ? p : 'product'
}

export function bookIsbnAfter(set: Record<string, unknown>, unset: readonly string[], previous: Record<string, unknown>): string | null {
  if (unset.includes('bookDetails')) return null
  const b = ('bookDetails' in set ? set.bookDetails : previous.bookDetails) as { isbn?: unknown } | undefined
  return typeof b?.isbn === 'string' && b.isbn ? b.isbn : null
}
