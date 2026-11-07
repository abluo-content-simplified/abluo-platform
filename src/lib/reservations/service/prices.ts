// ── Reservations — price resolution (ADR-044 D16.2, D8) ───────────────────────
// session override → option price of the category with the latest valid_from ≤
// booking date → category-less option price → not sellable.
import type { BookingOptionRow, OptionPriceRow } from '../server/types'

export type PriceCategory = { id: string; requiresMembership: boolean }
export type SessionPrice = { optionId?: string | null; occurrenceId: string; priceCategoryId: string | null; amountCents: number }

export type ResolvedPrice =
  | { ok: true; amountCents: number; source: 'session' | 'category' | 'default'; priceId: string | null; eligibilityReview: boolean }
  | { ok: false; code: 'not_sellable' }

const dateOnly = (v: string | null): string => (v ? v.slice(0, 10) : '')

/** Latest-valid_from price among those in force on `bookingDate` ('YYYY-MM-DD'). */
function latestInForce(prices: OptionPriceRow[], categoryId: string | null, bookingDate: string): OptionPriceRow | null {
  let best: OptionPriceRow | null = null
  for (const p of prices) {
    if (p.priceCategoryId !== categoryId) continue
    if (dateOnly(p.validFrom) > bookingDate) continue
    if (!best || dateOnly(p.validFrom) >= dateOnly(best.validFrom)) best = p
  }
  return best
}

export function resolvePrice(input: {
  option: Pick<BookingOptionRow, 'id' | 'prices' | 'requiresMembership'>
  priceCategoryId: string | null
  /** 'YYYY-MM-DD' in the project time zone. */
  bookingDate: string
  occurrenceId?: string | null
  sessionPrices?: SessionPrice[]
  categories?: PriceCategory[]
}): ResolvedPrice {
  const { option, priceCategoryId, bookingDate } = input
  const category = priceCategoryId ? input.categories?.find((c) => c.id === priceCategoryId) : undefined
  // Membership-required category (or option): self-declared, then the tenant checks (D8).
  const eligibilityReview = option.requiresMembership || category?.requiresMembership === true
  const done = (amountCents: number, source: 'session' | 'category' | 'default', priceId: string | null): ResolvedPrice =>
    Number.isSafeInteger(amountCents) && amountCents >= 0
      ? { ok: true, amountCents, source, priceId, eligibilityReview }
      : { ok: false, code: 'not_sellable' }

  if (input.occurrenceId) {
    const overrides = (input.sessionPrices ?? []).filter(
      (s) => s.occurrenceId === input.occurrenceId && (s.optionId == null || s.optionId === option.id),
    )
    const exact = overrides.find((s) => s.priceCategoryId === priceCategoryId)
    if (exact) return done(exact.amountCents, 'session', null)
    const any = priceCategoryId === null ? undefined : overrides.find((s) => s.priceCategoryId === null)
    if (any) return done(any.amountCents, 'session', null)
  }
  if (priceCategoryId) {
    const p = latestInForce(option.prices, priceCategoryId, bookingDate)
    if (p) return done(p.amountCents, 'category', p.id)
  }
  const d = latestInForce(option.prices, null, bookingDate)
  if (d) return done(d.amountCents, 'default', d.id)
  return { ok: false, code: 'not_sellable' }
}
