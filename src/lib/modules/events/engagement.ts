// ── Events module — registration, prices and hosts helpers ────────────────────
//
// Pure functions (no React, no Next.js) shared by the event detail page and
// every event card. Kept here so the formatting rules live in one tested place.

import { withTenantPrefix } from '@/lib/sanity/href'
import type { EventHost, EventPriceOption } from '@/lib/sanity/types'

/** A price option whose amount is a real number — the only ones we render. */
export type PricedOption = EventPriceOption & { amount: number }

export const DEFAULT_CURRENCY = 'EUR'

/**
 * Format a money amount for `locale` with Intl.NumberFormat.
 * Whole amounts drop the decimals ("€30", not "€30.00"); fractional amounts
 * keep two. An unknown currency code or locale never throws — it falls back
 * to "30 XYZ".
 */
export function formatPrice(amount: number, currency: string | undefined, locale: string): string {
  const code = (currency?.trim() || DEFAULT_CURRENCY).toUpperCase()
  const digits = Number.isInteger(amount) ? 0 : 2
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `${amount} ${code}`
  }
}

/** Drop options without a usable numeric amount. */
export function validPriceOptions(options: EventPriceOption[] | null | undefined): PricedOption[] {
  return (options ?? []).filter(
    (o): o is PricedOption => typeof o?.amount === 'number' && Number.isFinite(o.amount)
  )
}

/**
 * Compact one-line price for listing cards.
 *   - no valid options          → null
 *   - one option / all equal    → "€30"
 *   - several, same currency    → fromTemplate with {price} = the lowest ("from €30")
 *   - several, mixed currencies → the first option's price
 */
export function priceSummary(
  options: EventPriceOption[] | null | undefined,
  locale: string,
  fromTemplate: string
): string | null {
  const valid = validPriceOptions(options)
  if (valid.length === 0) return null
  const currencyOf = (o: PricedOption) => (o.currency?.trim() || DEFAULT_CURRENCY).toUpperCase()
  const first = valid[0]
  if (valid.length === 1) return formatPrice(first.amount, first.currency, locale)

  const currencies = new Set(valid.map(currencyOf))
  if (currencies.size > 1) return formatPrice(first.amount, first.currency, locale)

  const amounts = valid.map((o) => o.amount)
  const min = Math.min(...amounts)
  const formatted = formatPrice(min, first.currency, locale)
  return amounts.every((a) => a === min) ? formatted : fromTemplate.replace('{price}', formatted)
}

export interface ResolvedEventLink {
  href: string
  /** True for http(s) and protocol-relative URLs — render with target="_blank". */
  external: boolean
}

const EXTERNAL_RE = /^(https?:)?\/\//i

/**
 * Resolve an authored link (registration URL, host URL) to a DOM href.
 * Absolute URLs pass through and are flagged external; site-relative paths
 * (`/teachers#florian-parra`) get the `/{locale}/{tenant}/` prefix via the
 * shared withTenantPrefix rule; `#anchor`, `mailto:` and `tel:` pass through
 * unchanged. Empty input → null.
 */
export function resolveEventLink(
  url: string | null | undefined,
  locale: string,
  tenantId: string
): ResolvedEventLink | null {
  const raw = url?.trim()
  if (!raw) return null
  return { href: withTenantPrefix(raw, locale, tenantId), external: EXTERNAL_RE.test(raw) }
}

/** Hosts that have a name — the only ones we render. */
export function visibleHosts(hosts: EventHost[] | null | undefined): (EventHost & { name: string })[] {
  return (hosts ?? []).filter((h): h is EventHost & { name: string } => typeof h?.name === 'string' && h.name.trim() !== '')
}
