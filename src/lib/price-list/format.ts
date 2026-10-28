// ── Price list — formatting and the per-period calculation ───────────────────
//
// Pure functions (no React, no Next.js) behind PriceListSection, kept here so
// the rules live in one tested place (src/lib/price-list/__tests__).
//
// Prices are stored as NUMBERS and the section's ISO currency code; they are
// formatted here, per visitor locale, with Intl.NumberFormat. "€300" is never
// stored as text.
//
// Decisions (2026-10-28):
//   - Decimals ('priceDecimals' on the section):
//       auto   — whole amounts drop the decimals (€300), fractional ones show
//                the currency's minor digits (€32.50). The default.
//       none   — always rounded to a whole amount (€33).
//       always — always the currency's minor digits (€300.00).
//   - The per-period line is a comparison figure, so it keeps the currency's
//     minor digits in 'auto' and 'always' (€25.00/month next to €32.86/month
//     lines up); only 'none' rounds it to a whole amount.
//   - A row's own priceNote always wins over the calculation: it is free text
//     for what a number cannot say ("one-off fee", "billed yearly").
//   - The automatic sub-label ("12 months") is used ONLY when the editor left
//     the sub-label empty, a unit is set and the row has a quantity. It keeps
//     the visible count and the figure it is divided by from drifting apart,
//     and it is translated for free in every platform locale. Typing any
//     sub-label replaces it, so nothing is hidden from the editor.

import { getPriceListMessages, PER_PERIOD_UNITS, type PerPeriodUnit } from '@/lib/i18n/price-list-messages'

export type PriceDecimals = 'auto' | 'none' | 'always'

export const DEFAULT_PRICE_CURRENCY = 'EUR'

export interface PriceFormatOptions {
  locale: string
  currency?: string | null
  decimals?: PriceDecimals | null
}

/** A line that reads one way on screen and another to a screen reader. */
export interface PriceLine {
  /** What sighted visitors see, e.g. "€25.00/month". */
  visible: string
  /** What a screen reader says, e.g. "€25.00 per month". Same as visible when there is nothing to expand. */
  spoken: string
}

function currencyCode(currency: string | null | undefined): string {
  return (currency?.trim() || DEFAULT_PRICE_CURRENCY).toUpperCase()
}

function safeLocale(locale: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : 'en'
  } catch {
    return 'en'
  }
}

/** The currency's minor digits (2 for EUR, 0 for JPY). Unknown codes → 2. */
function minorDigits(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** Is the value a usable price / quantity? */
export function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function format(amount: number, code: string, locale: string, digits: number): string {
  try {
    return new Intl.NumberFormat(safeLocale(locale), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    // An invalid currency code never throws on the page.
    return `${amount.toFixed(digits)} ${code}`
  }
}

/** Format a price for the visitor's locale and the section currency. */
export function formatPrice(amount: number, opts: PriceFormatOptions): string {
  const code = currencyCode(opts.currency)
  const minor = minorDigits(code)
  const mode = opts.decimals ?? 'auto'
  const digits = mode === 'none' ? 0 : mode === 'always' ? minor : Number.isInteger(amount) ? 0 : minor
  return format(amount, code, opts.locale, digits)
}

/** The per-period figure (price ÷ quantity), formatted. Rounding is Intl's (230 / 7 → 32.86). */
export function formatPerPeriodAmount(amount: number, opts: PriceFormatOptions): string {
  const code = currencyCode(opts.currency)
  const digits = opts.decimals === 'none' ? 0 : minorDigits(code)
  return format(amount, code, opts.locale, digits)
}

/** Narrow a stored value to a known unit; anything else (null, 'none', a removed unit) is off. */
export function resolvePerPeriodUnit(value: unknown): PerPeriodUnit | null {
  return typeof value === 'string' && (PER_PERIOD_UNITS as readonly string[]).includes(value) ? (value as PerPeriodUnit) : null
}

/** price ÷ quantity, or null when either is missing or the quantity is not positive. */
export function perPeriodValue(price: unknown, quantity: unknown): number | null {
  if (!isAmount(price) || !isAmount(quantity) || quantity <= 0) return null
  return price / quantity
}

/** "12 months", "1 mois", "8 Monate" — count + localized unit noun. */
export function quantityLabel(quantity: number, unit: PerPeriodUnit, locale: string): string {
  const words = getPriceListMessages(locale).units[unit]
  const loc = safeLocale(locale)
  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(loc).select(quantity)
  } catch {
    /* keep 'other' */
  }
  const noun = category === 'one' ? words.one : words.other
  return `${new Intl.NumberFormat(loc).format(quantity)} ${noun}`
}

export interface PriceRowInput {
  price?: number | null
  quantity?: number | null
  sublabel?: string | null
  priceNote?: string | null
}

export interface PriceSectionSettings extends PriceFormatOptions {
  perPeriod?: string | null
}

/**
 * The muted line under a row's price:
 *   1. the row's priceNote, when set (overrides everything);
 *   2. otherwise, with a per-period unit on and a quantity on the row,
 *      price ÷ quantity — "€25.00/month" (spoken "€25.00 per month");
 *   3. otherwise nothing.
 */
export function rowPriceLine(row: PriceRowInput, s: PriceSectionSettings): PriceLine | null {
  const note = row.priceNote?.trim()
  if (note) return { visible: note, spoken: note }
  const unit = resolvePerPeriodUnit(s.perPeriod)
  if (!unit) return null
  const value = perPeriodValue(row.price, row.quantity)
  if (value === null) return null
  const words = getPriceListMessages(s.locale).units[unit]
  const amount = formatPerPeriodAmount(value, s)
  return { visible: `${amount}/${words.one}`, spoken: `${amount} ${words.per}` }
}

/** The row's sub-label: the editor's text, or — when empty — the automatic "12 months". */
export function rowSublabel(row: PriceRowInput, s: PriceSectionSettings): string | null {
  const typed = row.sublabel?.trim()
  if (typed) return row.sublabel as string
  const unit = resolvePerPeriodUnit(s.perPeriod)
  if (!unit || !isAmount(row.quantity) || row.quantity <= 0) return null
  return quantityLabel(row.quantity, unit, s.locale)
}
