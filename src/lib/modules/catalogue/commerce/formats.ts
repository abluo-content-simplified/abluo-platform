// ── Catalogue commerce — the format model (C3) ────────────────────────────────
//
// Authority: contract C2-C5-C10 §C3 (Rev 4); Tom D-21.
//
// A format is a sellable form of an item (Glass 25 cl, Paperback, 500 ml).
// Prices (C4) and the most specific availability override (C5) live on it.
// An item with no stored `formats` is ONE implicit format (`key: 'default'`, no
// label, no prices) — I-C3-1: formatsOf never returns [].

import { normalizeIsbn, isValidIsbn } from '../isbn'
import { can, type ItemProfile } from '../profiles'
import { FORMAT_LIMIT, PRICES_PER_FORMAT_LIMIT, type ChannelAvailabilityRule, type ChannelKey, type FormatIssueCode, type FormatKey, type IssueLevel, type Locale, type LocalizedString, type LocalizedText } from './commerce-types'
import type { ChannelSet } from './channels'
import { commerceOf } from './legacy-commerce'
import type { Price } from './prices'
import { withImplicit } from './read'

export { IMPLICIT_FORMAT_KEY } from './format-key'

export type QuantityUnit = 'ml' | 'cl' | 'l' | 'g' | 'kg' | 'piece'
export const QUANTITY_UNITS: readonly QuantityUnit[] = ['ml', 'cl', 'l', 'g', 'kg', 'piece']

export type FormatIdentifiers = {
  sku?: string
  isbn?: string
  gtin?: string
}

export type Format = {
  key: FormatKey
  /** null ONLY for the implicit format. A string when GROQ already resolved it. */
  label: LocalizedText | null
  identifiers: FormatIdentifiers
  quantity: { value: number; unit: QuantityUnit } | null
  /** Provenance from a format template (C3-6); never a live link. */
  templateKey: string | null
  /** Format rules (baseline + schedule, C5a); absent key = inherit. */
  availability: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
  prices: readonly Price[]
  /** Derived, never stored: true when label === null and it is the only format. */
  implicit: boolean
}

/** Project-level format suggestion (module config `formatTemplates`, C3-6): copied into a format, never linked. */
export type FormatTemplate = { key: string; label: LocalizedString; quantity?: { value: number; unit: QuantityUnit } }

export type RawCommerce = { formats?: unknown; offers?: unknown; channelAvailability?: unknown }

/** Raw item → ordered formats. Absent/empty `formats` (and no legacy offers) → [implicit format with no prices]. Never returns []. */
export function formatsOf(raw: RawCommerce | null | undefined, channels?: ChannelSet): readonly Format[] {
  return commerceOf(raw, channels).formats
}

/** True when the editor should show the simple single-price form (one format, no label). */
export function isSimple(formats: readonly Format[]): boolean {
  return formats.length === 1 && formats[0].label === null
}

const emptyFormat = (key: FormatKey, label: LocalizedString): Format => ({
  key,
  label,
  identifiers: {},
  quantity: null,
  templateKey: null,
  availability: new Map(),
  prices: [],
  implicit: false,
})

/** "Add another size or format": the implicit format becomes a labelled first format (label required), a new one is appended. Keys preserved. */
export function addFormat(formats: readonly Format[], firstLabel: LocalizedString, next: { key: FormatKey; label: LocalizedString }): Format[] {
  const out = formats.map((f, i) => (i === 0 && formats.length === 1 && f.label === null ? { ...f, label: firstLabel } : f))
  out.push(emptyFormat(next.key, next.label))
  return withImplicit(out)
}

/** Removing down to one format keeps that format's key and label; it becomes implicit only if its label is cleared deliberately. */
export function removeFormat(formats: readonly Format[], key: FormatKey): Format[] {
  return withImplicit(formats.filter((f) => f.key !== key))
}

/** ONE answer to "which ISBN identifies this format" (C3-5): own ISBN, else the book ISBN iff it is the only format. */
export function effectiveIsbn(format: Format, formats: readonly Format[], bookIsbn: string | null): string | null {
  if (format.identifiers.isbn) return normalizeIsbn(format.identifiers.isbn) || null
  if (formats.length === 1 && bookIsbn) return normalizeIsbn(bookIsbn) || null
  return null
}

/** GS1 mod-10 check digit over 8, 12, 13 or 14 digits. */
export function isValidGtin(raw: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(raw)) return false
  const digits = raw.split('').map(Number)
  const check = digits.pop()!
  let sum = 0
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)))
  return (10 - (sum % 10)) % 10 === check
}

const SKU = /^[A-Za-z0-9._-]{1,64}$/

export type FormatIssue = { code: FormatIssueCode; level: IssueLevel; key?: FormatKey }

const labelIn = (label: LocalizedText | null, locale: Locale): string | null => {
  if (label === null) return null
  const v = typeof label === 'string' ? label : label[locale]
  return v && v.trim() ? v : null
}

/** Save-time validation of an item's formats (C3-7). Price issues are prices.ts priceIssues; row issues are availabilityRowIssues. */
export function formatIssues(
  formats: readonly Format[],
  ctx: { channels: ChannelSet; defaultLocale: Locale; itemProfile: ItemProfile; bookIsbn: string | null },
): FormatIssue[] {
  const out: FormatIssue[] = []
  if (formats.length > FORMAT_LIMIT) out.push({ code: 'format.limitExceeded', level: 'error' })
  const keys = new Set<string>()
  const skus = new Map<string, FormatKey>()
  for (const f of formats) {
    if (keys.has(f.key)) out.push({ code: 'format.keyDuplicate', level: 'error', key: f.key })
    keys.add(f.key)
    if (formats.length >= 2 && !labelIn(f.label, ctx.defaultLocale)) out.push({ code: 'format.labelRequired', level: 'error', key: f.key })
    if (f.prices.length > PRICES_PER_FORMAT_LIMIT) out.push({ code: 'format.pricesLimitExceeded', level: 'error', key: f.key })
    const { sku, isbn, gtin } = f.identifiers
    if (sku !== undefined) {
      if (!SKU.test(sku)) out.push({ code: 'format.skuInvalid', level: 'error', key: f.key })
      else if (skus.has(sku)) out.push({ code: 'format.skuDuplicateInItem', level: 'error', key: f.key })
      else skus.set(sku, f.key)
    }
    if (isbn !== undefined) {
      if (!isValidIsbn(isbn)) out.push({ code: 'format.isbnInvalid', level: 'error', key: f.key })
      if (formats.length === 1 && ctx.bookIsbn && can(ctx.itemProfile, 'bookDetails')) out.push({ code: 'format.isbnConflictsBook', level: 'error', key: f.key })
    }
    if (gtin !== undefined && !isValidGtin(gtin)) out.push({ code: 'format.gtinInvalid', level: 'error', key: f.key })
    if (f.quantity) {
      const { value, unit } = f.quantity
      const valueOk = typeof value === 'number' && Number.isFinite(value) && value > 0 && Math.round(value * 1000) === Number((value * 1000).toFixed(6))
      if (unit !== undefined && !QUANTITY_UNITS.includes(unit)) out.push({ code: 'format.unitUnknown', level: 'error', key: f.key })
      if (!valueOk || unit === undefined) out.push({ code: 'format.quantityInvalid', level: 'error', key: f.key })
    }
    if (f.implicit && f.availability.size > 0) out.push({ code: 'format.implicitOverride', level: 'error', key: f.key })
  }
  return out
}
