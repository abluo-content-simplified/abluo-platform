// ── Pricing sections — monthly / yearly figures ──────────────────────────────
//
// Pure functions (no React) behind PricingCardsSection and
// ComparisonTableSection. Prices are typed in the section as NUMBERS; every
// derived figure (yearly total, monthly equivalent, saving, saving %) is
// computed here and never stored.
//
// Yearly price of a card:
//   1. the card's own `priceYearly`, when typed;
//   2. otherwise `priceMonthly × yearlyPaidMonths` when the section sets
//      "yearly = N months" (Abluo: 12 months for the price of 10 → N = 10);
//   3. otherwise none — the card has no yearly price and shows its monthly
//      price in both views.
//
// Rounding: the monthly equivalent (yearly ÷ 12) is a comparison figure. In
// 'auto' and 'none' decimals it is rounded to a whole amount (€290 / 12 →
// €24); 'always' keeps the currency's minor digits (€24.17). The yearly total
// is always shown beside it, so the rounded figure is never the only price.

import { formatPrice, isAmount, type PriceDecimals, type PriceFormatOptions } from '@/lib/price-list/format'
import type { PricingMessages } from '@/lib/i18n/pricing-messages'

export interface PriceInput {
  priceMonthly?: number | null
  priceYearly?: number | null
}

export interface Billing {
  monthly: number | null
  yearly: number | null
  /** yearly ÷ 12, unrounded. */
  monthlyEquivalent: number | null
  /** monthly × 12 — what twelve monthly payments cost. */
  fullYear: number | null
  /** fullYear − yearly, when positive. */
  saving: number | null
  /** saving ÷ fullYear × 100, rounded to a whole percent. */
  savingPercent: number | null
}

/** A usable "yearly = N months" setting: a positive number up to 12. */
export function paidMonths(value: unknown): number | null {
  return isAmount(value) && value > 0 && value <= 12 ? value : null
}

export function billingOf(card: PriceInput, yearlyPaidMonths?: number | null): Billing {
  const monthly = isAmount(card.priceMonthly) && card.priceMonthly >= 0 ? card.priceMonthly : null
  const months = paidMonths(yearlyPaidMonths)
  const typedYearly = isAmount(card.priceYearly) && card.priceYearly >= 0 ? card.priceYearly : null
  const yearly = typedYearly ?? (monthly !== null && months !== null ? round2(monthly * months) : null)
  const fullYear = monthly !== null ? round2(monthly * 12) : null
  const rawSaving = yearly !== null && fullYear !== null ? round2(fullYear - yearly) : null
  const saving = rawSaving !== null && rawSaving > 0 ? rawSaving : null
  const savingPercent = saving !== null && fullYear ? Math.round((saving / fullYear) * 100) : null
  return {
    monthly,
    yearly,
    monthlyEquivalent: yearly !== null ? yearly / 12 : null,
    fullYear,
    saving,
    savingPercent,
  }
}

/** True when at least one card has both a monthly and a yearly price — the only case a switch means anything. */
export function hasBothPeriods(cards: readonly PriceInput[], yearlyPaidMonths?: number | null): boolean {
  return cards.some((c) => {
    const b = billingOf(c, yearlyPaidMonths)
    return b.monthly !== null && b.yearly !== null
  })
}

export type SavingBadge = { kind: 'same' | 'upTo'; percent: number } | null

/**
 * The switch badge. Every card that saves the same percent → "Save 17%";
 * different percents → "Save up to X%"; nothing saves → no badge.
 * Cards without a yearly price are ignored.
 */
export function savingBadge(cards: readonly PriceInput[], yearlyPaidMonths?: number | null): SavingBadge {
  const percents = cards
    .map((c) => billingOf(c, yearlyPaidMonths))
    .filter((b) => b.monthly !== null && b.yearly !== null)
    .map((b) => b.savingPercent ?? 0)
  const positive = percents.filter((p) => p > 0)
  if (positive.length === 0) return null
  const max = Math.max(...positive)
  const allSame = percents.every((p) => p === max)
  return { kind: allSame ? 'same' : 'upTo', percent: max }
}

export function savingBadgeText(badge: SavingBadge, m: PricingMessages): string | null {
  if (!badge) return null
  return fillTemplate(badge.kind === 'same' ? m.save : m.saveUpTo, { percent: String(badge.percent) })
}

/** The monthly equivalent, rounded per the section's decimals (see header). */
export function formatEquivalent(value: number, opts: PriceFormatOptions): string {
  const mode: PriceDecimals = opts.decimals ?? 'auto'
  return mode === 'always' ? formatPrice(value, { ...opts, decimals: 'always' }) : formatPrice(Math.round(value), { ...opts, decimals: 'none' })
}

/** "{a} and {b}" → values. Unknown placeholders stay as typed, so a bad template is visible, never blank. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? values[key] : all))
}

/** The line under a yearly figure: "€290 a year instead of €348. You save €58 every year." */
export function yearlyLine(b: Billing, opts: PriceFormatOptions, m: PricingMessages): string | null {
  if (b.yearly === null) return null
  const yearly = formatPrice(b.yearly, opts)
  if (b.saving === null || b.fullYear === null) return fillTemplate(m.yearlyLineNoSaving, { yearly })
  return fillTemplate(m.yearlyLine, { yearly, full: formatPrice(b.fullYear, opts), saving: formatPrice(b.saving, opts) })
}

/** Compact cards showing the yearly total: "€190 / year (save €38)" — or just "€190 / year". */
export function yearlyTotalLine(b: Billing, opts: PriceFormatOptions, m: PricingMessages): string | null {
  if (b.yearly === null) return null
  const yearly = formatPrice(b.yearly, opts)
  if (b.saving === null) return `${yearly} ${m.perYear}`
  return fillTemplate(m.yearlyTotalSaving, { yearly, saving: formatPrice(b.saving, opts) })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
