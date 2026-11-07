import { describe, expect, it } from 'vitest'
import { resolvePrice } from '../prices'
import { option } from './fake-store'

const px = (id: string, cat: string | null, amountCents: number, validFrom: string | null) =>
  ({ id, optionId: 'o', priceCategoryId: cat, amountCents, currency: 'EUR' as const, validFrom })

describe('resolvePrice', () => {
  const o = option({ prices: [
    px('a', 'member', 5000, '2026-01-01'),
    px('b', 'member', 4000, '2026-06-01'),
    px('c', 'member', 3000, '2027-01-01'),
    px('d', null, 9000, null),
  ] })
  const cats = [{ id: 'member', requiresMembership: true }, { id: 'adult', requiresMembership: false }]

  it('picks the latest valid_from <= booking date for the category', () => {
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2026-03-01', categories: cats })).toMatchObject({ ok: true, amountCents: 5000, source: 'category', priceId: 'a' })
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2026-06-01', categories: cats })).toMatchObject({ amountCents: 4000 }) // boundary inclusive
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2026-11-07', categories: cats })).toMatchObject({ amountCents: 4000 })
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2027-01-01', categories: cats })).toMatchObject({ amountCents: 3000 })
  })
  it('falls back to the category-less price, then to not sellable', () => {
    expect(resolvePrice({ option: o, priceCategoryId: 'adult', bookingDate: '2026-11-07', categories: cats })).toMatchObject({ ok: true, amountCents: 9000, source: 'default' })
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2025-01-01', categories: cats })).toMatchObject({ amountCents: 9000 })
    expect(resolvePrice({ option: option({ prices: [] }), priceCategoryId: null, bookingDate: '2026-11-07' })).toEqual({ ok: false, code: 'not_sellable' })
    expect(resolvePrice({ option: option({ prices: [px('x', null, 100, '2027-01-01')] }), priceCategoryId: null, bookingDate: '2026-11-07' })).toEqual({ ok: false, code: 'not_sellable' })
  })
  it('a session override beats everything', () => {
    const r = resolvePrice({
      option: o, priceCategoryId: 'member', bookingDate: '2026-11-07', occurrenceId: 's1', categories: cats,
      sessionPrices: [{ occurrenceId: 's1', priceCategoryId: 'member', amountCents: 1234 }, { occurrenceId: 's2', priceCategoryId: 'member', amountCents: 1 }],
    })
    expect(r).toMatchObject({ ok: true, amountCents: 1234, source: 'session' })
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2026-11-07', occurrenceId: 's3', categories: cats, sessionPrices: [] })).toMatchObject({ source: 'category' })
  })
  it('membership-required categories (or options) set eligibility review', () => {
    expect(resolvePrice({ option: o, priceCategoryId: 'member', bookingDate: '2026-11-07', categories: cats })).toMatchObject({ eligibilityReview: true })
    expect(resolvePrice({ option: o, priceCategoryId: 'adult', bookingDate: '2026-11-07', categories: cats })).toMatchObject({ eligibilityReview: false })
    expect(resolvePrice({ option: option({ requiresMembership: true }), priceCategoryId: null, bookingDate: '2026-11-07' })).toMatchObject({ eligibilityReview: true })
  })
})
