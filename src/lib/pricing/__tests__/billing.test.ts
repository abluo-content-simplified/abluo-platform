import { describe, it, expect } from 'vitest'
import { billingOf, hasBothPeriods, savingBadge, savingBadgeText, formatEquivalent, yearlyLine, yearlyTotalLine, fillTemplate, paidMonths } from '@/lib/pricing/billing'
import { getPricingMessages, PRICING_MESSAGES_FOR_TEST } from '@/lib/i18n/pricing-messages'

const n = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ')
const en = getPricingMessages('en')
const opts = { locale: 'en', currency: 'EUR', decimals: 'auto' as const }

describe('billingOf — 12 months for the price of 10', () => {
  it('Core €29: yearly €290, full year €348, saving €58, 17 %', () => {
    const b = billingOf({ priceMonthly: 29 }, 10)
    expect(b).toMatchObject({ monthly: 29, yearly: 290, fullYear: 348, saving: 58, savingPercent: 17 })
    expect(b.monthlyEquivalent).toBeCloseTo(24.1667, 3)
  })
  it('a typed yearly price wins over the rule', () => {
    expect(billingOf({ priceMonthly: 29, priceYearly: 300 }, 10)).toMatchObject({ yearly: 300, saving: 48, savingPercent: 14 })
  })
  it('no rule and no typed yearly price → no yearly figure', () => {
    expect(billingOf({ priceMonthly: 29 }, null)).toMatchObject({ yearly: null, saving: null, monthlyEquivalent: null })
  })
  it('a yearly price that saves nothing has no saving', () => {
    expect(billingOf({ priceMonthly: 10, priceYearly: 120 })).toMatchObject({ saving: null, savingPercent: null })
  })
  it('ignores a nonsense rule', () => {
    expect(paidMonths(0)).toBeNull()
    expect(paidMonths(13)).toBeNull()
    expect(billingOf({ priceMonthly: 10 }, 0).yearly).toBeNull()
  })
  it('decimals stay exact (66.75 × 10)', () => {
    expect(billingOf({ priceMonthly: 66.75 }, 10).yearly).toBe(667.5)
  })
})

describe('switch badge', () => {
  const plans = [{ priceMonthly: 29 }, { priceMonthly: 49 }, { priceMonthly: 69 }]
  it('same percent everywhere → "Save 17%"', () => {
    expect(savingBadgeText(savingBadge(plans, 10), en)).toBe('Save 17%')
  })
  it('different percents → "Save up to …"', () => {
    expect(savingBadgeText(savingBadge([{ priceMonthly: 10, priceYearly: 100 }, { priceMonthly: 10, priceYearly: 110 }]), en)).toBe('Save up to 17%')
  })
  it('nothing saves → no badge', () => {
    expect(savingBadge([{ priceMonthly: 10, priceYearly: 120 }])).toBeNull()
    expect(savingBadge(plans, null)).toBeNull()
  })
  it('hasBothPeriods', () => {
    expect(hasBothPeriods(plans, 10)).toBe(true)
    expect(hasBothPeriods(plans, null)).toBe(false)
  })
})

describe('formatting', () => {
  it('monthly equivalent rounds to whole amounts in auto, keeps cents in always', () => {
    expect(formatEquivalent(290 / 12, opts)).toBe('€24')
    expect(formatEquivalent(690 / 12, opts)).toBe('€58')
    expect(formatEquivalent(290 / 12, { ...opts, decimals: 'always' })).toBe('€24.17')
  })
  it('yearly line, as in the design', () => {
    expect(yearlyLine(billingOf({ priceMonthly: 29 }, 10), opts, en)).toBe('€290 a year instead of €348. You save €58 every year.')
    expect(yearlyLine(billingOf({ priceMonthly: 10, priceYearly: 120 }), opts, en)).toBe('€120 billed yearly')
  })
  it('yearly total line for compact cards', () => {
    expect(yearlyTotalLine(billingOf({ priceMonthly: 19 }, 10), opts, en)).toBe('€190 / year (save €38)')
  })
  it('Italian and German format their own way', () => {
    expect(n(yearlyLine(billingOf({ priceMonthly: 29 }, 10), { ...opts, locale: 'it' }, getPricingMessages('it')))).toBe('290 € all’anno invece di 348 €. Risparmi 58 € ogni anno.')
    expect(n(savingBadgeText({ kind: 'same', percent: 17 }, getPricingMessages('de')))).toBe('17 % sparen')
  })
  it('fillTemplate keeps unknown placeholders visible', () => {
    expect(fillTemplate('{a} {b}', { a: 'x' })).toBe('x {b}')
  })
})

describe('pricing messages', () => {
  it('every locale has every key, with the placeholders English has', () => {
    const keys = Object.keys(PRICING_MESSAGES_FOR_TEST.en) as (keyof typeof en)[]
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
    for (const [loc, msgs] of Object.entries(PRICING_MESSAGES_FOR_TEST)) {
      for (const k of keys) {
        expect(msgs[k], `${loc}.${k}`).toBeTruthy()
        expect(ph(msgs[k]), `${loc}.${k}`).toBe(ph(en[k]))
      }
    }
  })
  it('unknown locale falls back to English', () => {
    expect(getPricingMessages('xx')).toBe(en)
  })
})
