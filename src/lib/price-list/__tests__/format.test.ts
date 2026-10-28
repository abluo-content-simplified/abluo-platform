import { describe, it, expect } from 'vitest'
import {
  formatPrice,
  formatPerPeriodAmount,
  perPeriodValue,
  quantityLabel,
  resolvePerPeriodUnit,
  rowPriceLine,
  rowSublabel,
} from '../format'
import { PRICE_LIST_MESSAGES_FOR_TEST, PER_PERIOD_UNITS, getPriceListMessages } from '@/lib/i18n/price-list-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

/** Intl uses no-break spaces (U+00A0, U+202F); compare with plain ones. */
const n = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

describe('formatPrice', () => {
  it('formats per locale with the currency (auto decimals)', () => {
    expect(n(formatPrice(300, { locale: 'en', currency: 'EUR' }))).toBe('€300')
    expect(n(formatPrice(300, { locale: 'fr', currency: 'EUR' }))).toBe('300 €')
    expect(n(formatPrice(300, { locale: 'de', currency: 'EUR' }))).toBe('300 €')
    expect(n(formatPrice(300, { locale: 'it', currency: 'EUR' }))).toBe('300 €')
    expect(n(formatPrice(32.5, { locale: 'en', currency: 'EUR' }))).toBe('€32.50')
    expect(n(formatPrice(32.5, { locale: 'fr', currency: 'EUR' }))).toBe('32,50 €')
  })

  it('defaults to EUR and accepts a lower-case code', () => {
    expect(n(formatPrice(80, { locale: 'en' }))).toBe('€80')
    expect(n(formatPrice(80, { locale: 'en', currency: 'chf' }))).toContain('CHF')
  })

  it('decimals: none rounds, always shows minor digits', () => {
    expect(n(formatPrice(32.5, { locale: 'en', decimals: 'none' }))).toBe('€33')
    expect(n(formatPrice(300, { locale: 'en', decimals: 'always' }))).toBe('€300.00')
    expect(n(formatPrice(300, { locale: 'de', decimals: 'always' }))).toBe('300,00 €')
  })

  it('respects currencies without minor units', () => {
    expect(n(formatPrice(1500, { locale: 'en', currency: 'JPY', decimals: 'always' }))).toBe('¥1,500')
  })

  it('never throws on a bad currency or locale', () => {
    expect(formatPrice(10, { locale: 'en', currency: 'NOPE' })).toBe('10 NOPE')
    expect(n(formatPrice(10, { locale: 'zz-invalid-@@', currency: 'EUR' }))).toBe('€10')
  })
})

describe('per-period calculation', () => {
  it('divides price by quantity and rounds like Intl (230 / 7 → 32.86)', () => {
    expect(perPeriodValue(300, 12)).toBe(25)
    expect(n(formatPerPeriodAmount(perPeriodValue(230, 7)!, { locale: 'en' }))).toBe('€32.86')
    expect(n(formatPerPeriodAmount(perPeriodValue(110, 3)!, { locale: 'en' }))).toBe('€36.67')
    expect(n(formatPerPeriodAmount(25, { locale: 'en' }))).toBe('€25.00')
    expect(n(formatPerPeriodAmount(25, { locale: 'en', decimals: 'none' }))).toBe('€25')
  })

  it('missing or non-positive quantity → no value', () => {
    expect(perPeriodValue(300, null)).toBeNull()
    expect(perPeriodValue(300, undefined)).toBeNull()
    expect(perPeriodValue(300, 0)).toBeNull()
    expect(perPeriodValue(300, -2)).toBeNull()
    expect(perPeriodValue(null, 12)).toBeNull()
  })

  it('unit: only known units turn it on', () => {
    expect(resolvePerPeriodUnit('month')).toBe('month')
    expect(resolvePerPeriodUnit('none')).toBeNull()
    expect(resolvePerPeriodUnit(undefined)).toBeNull()
    expect(resolvePerPeriodUnit('fortnight')).toBeNull()
  })

  it('on: shows "€25.00/month", spoken "per month", localized', () => {
    const en = rowPriceLine({ price: 300, quantity: 12 }, { locale: 'en', perPeriod: 'month' })!
    expect(n(en.visible)).toBe('€25.00/month')
    expect(n(en.spoken)).toBe('€25.00 per month')
    const fr = rowPriceLine({ price: 300, quantity: 12 }, { locale: 'fr', perPeriod: 'month' })!
    expect(n(fr.visible)).toBe('25,00 €/mois')
    expect(n(fr.spoken)).toBe('25,00 € par mois')
    expect(n(rowPriceLine({ price: 230, quantity: 7 }, { locale: 'de', perPeriod: 'month' })!.visible)).toBe('32,86 €/Monat')
    expect(n(rowPriceLine({ price: 230, quantity: 7 }, { locale: 'it', perPeriod: 'month' })!.visible)).toBe('32,86 €/mese')
  })

  it('off: no line, even with a quantity', () => {
    expect(rowPriceLine({ price: 300, quantity: 12 }, { locale: 'en' })).toBeNull()
    expect(rowPriceLine({ price: 300, quantity: 12 }, { locale: 'en', perPeriod: 'none' })).toBeNull()
  })

  it('on, but the row has no quantity → nothing', () => {
    expect(rowPriceLine({ price: 300 }, { locale: 'en', perPeriod: 'month' })).toBeNull()
  })

  it('priceNote overrides the calculation (and shows when the calculation is off)', () => {
    expect(rowPriceLine({ price: 300, quantity: 12, priceNote: 'one-off fee' }, { locale: 'en', perPeriod: 'month' })).toEqual({
      visible: 'one-off fee',
      spoken: 'one-off fee',
    })
    expect(rowPriceLine({ price: 300, priceNote: 'billed yearly' }, { locale: 'en' })?.visible).toBe('billed yearly')
    expect(rowPriceLine({ price: 300, quantity: 12, priceNote: '   ' }, { locale: 'en', perPeriod: 'month' })?.visible).toContain('/month')
  })
})

describe('sub-label', () => {
  it('auto "12 months" only when empty, unit on and quantity set', () => {
    expect(rowSublabel({ quantity: 12 }, { locale: 'en', perPeriod: 'month' })).toBe('12 months')
    expect(rowSublabel({ quantity: 1 }, { locale: 'en', perPeriod: 'month' })).toBe('1 month')
    expect(rowSublabel({ quantity: 12 }, { locale: 'fr', perPeriod: 'month' })).toBe('12 mois')
    expect(rowSublabel({ quantity: 8 }, { locale: 'de', perPeriod: 'month' })).toBe('8 Monate')
    expect(rowSublabel({ quantity: 10 }, { locale: 'it', perPeriod: 'month' })).toBe('10 mesi')
    expect(rowSublabel({ quantity: 12, sublabel: 'Full year' }, { locale: 'en', perPeriod: 'month' })).toBe('Full year')
    expect(rowSublabel({ quantity: 12 }, { locale: 'en' })).toBeNull()
    expect(rowSublabel({}, { locale: 'en', perPeriod: 'month' })).toBeNull()
  })

  it('uses plural rules (fr: 1 séance, 2 séances)', () => {
    expect(quantityLabel(1, 'session', 'fr')).toBe('1 séance')
    expect(quantityLabel(2, 'session', 'fr')).toBe('2 séances')
    expect(quantityLabel(2, 'person', 'en')).toBe('2 people')
  })
})

describe('price list messages', () => {
  it('cover every platform locale and every unit', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = PRICE_LIST_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      for (const u of PER_PERIOD_UNITS) {
        expect(m.units[u].one, `${code}.${u}.one`).toBeTruthy()
        expect(m.units[u].other, `${code}.${u}.other`).toBeTruthy()
        expect(m.units[u].per, `${code}.${u}.per`).toBeTruthy()
      }
    }
  })
  it('falls back to English', () => {
    expect(getPriceListMessages('xx').units.month.one).toBe('month')
    expect(getPriceListMessages(undefined).units.month.per).toBe('per month')
  })
})
