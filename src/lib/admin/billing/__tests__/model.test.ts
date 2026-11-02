import { describe, expect, it } from 'vitest'
import { hasPlatformPermission, BILLING_ADMIN_PERMISSION } from '../access'
import { parseEuroToCents, validateBillingTerms, validateOverride, type BillingTermsInput } from '../model'

const NOW = new Date('2026-11-02T10:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
const terms = (t: Partial<BillingTermsInput> = {}): BillingTermsInput => ({
  arrangement: 'stripe', amountCents: 24000, interval: 'year', startsOn: '2026-11-02',
  activationDueAt: NOW, activationExtensionReason: null, manualPaidThrough: null, ...t,
})

describe('billing.admin (ADR-041 D9)', () => {
  it('only an Abluo admin whose app_metadata lists billing.admin holds it', () => {
    expect(hasPlatformPermission({ platform_role: 'abluo_admin', platform_permissions: ['billing.admin'] }, BILLING_ADMIN_PERMISSION)).toBe(true)
    expect(hasPlatformPermission({ platform_role: 'abluo_admin' }, BILLING_ADMIN_PERMISSION)).toBe(false)
    expect(hasPlatformPermission({ platform_role: 'abluo_admin', platform_permissions: 'billing.admin' }, BILLING_ADMIN_PERMISSION)).toBe(false)
    expect(hasPlatformPermission({ platform_role: 'tenant_user', platform_permissions: ['billing.admin'] }, BILLING_ADMIN_PERMISSION)).toBe(false)
    expect(hasPlatformPermission(null, BILLING_ADMIN_PERMISSION)).toBe(false)
  })
})

describe('parseEuroToCents', () => {
  it.each([
    ['240', 24000], ['240,00', 24000], ['240.5', 24050], ['1.200,50', 120050], ['1,200.50', 120050], ['€ 180', 18000], ['1200', 120000],
  ])('%s → %i', (s, c) => expect(parseEuroToCents(s)).toBe(c))
  it.each(['', '0', '-5', 'abc', '12,345', '1.200', '1.2.3', '2000000'])('%s → null', (s) => expect(parseEuroToCents(s)).toBeNull())
})

describe('validateBillingTerms', () => {
  it('a normal Stripe agreement is valid', () => expect(validateBillingTerms(terms(), NOW)).toEqual([]))
  it('Stripe needs amount, interval and a payment due date', () => {
    expect(validateBillingTerms(terms({ amountCents: null, interval: null, activationDueAt: null }), NOW)).toEqual(['amount', 'interval', 'activationDueRequired'])
  })
  it('a due date more than 30 days ahead needs a reason (the database enforces the same)', () => {
    expect(validateBillingTerms(terms({ activationDueAt: days(31) }), NOW)).toEqual(['activationReasonRequired'])
    expect(validateBillingTerms(terms({ activationDueAt: days(31), activationExtensionReason: '  ' }), NOW)).toEqual(['activationReasonRequired'])
    expect(validateBillingTerms(terms({ activationDueAt: days(90), activationExtensionReason: 'Launch in February' }), NOW)).toEqual([])
    expect(validateBillingTerms(terms({ activationDueAt: days(30) }), NOW)).toEqual([])
  })
  it('complimentary needs nothing; manual needs amount and interval; paid-through only for manual', () => {
    expect(validateBillingTerms(terms({ arrangement: 'complimentary', amountCents: null, interval: null, activationDueAt: null }), NOW)).toEqual([])
    expect(validateBillingTerms(terms({ arrangement: 'manual', activationDueAt: null, manualPaidThrough: '2027-01-31' }), NOW)).toEqual([])
    expect(validateBillingTerms(terms({ manualPaidThrough: '2027-01-31' }), NOW)).toEqual(['manualPaidThrough'])
    expect(validateBillingTerms(terms({ arrangement: 'manual', activationDueAt: null, manualPaidThrough: '31/01/2027' }), NOW)).toEqual(['manualPaidThrough'])
  })
  it('rejects an unknown arrangement and bad dates', () => {
    expect(validateBillingTerms(terms({ arrangement: 'barter' as never }), NOW)).toEqual(['arrangement'])
    expect(validateBillingTerms(terms({ startsOn: '2026-13-01' }), NOW)).toEqual(['startsOn'])
  })
})

describe('validateOverride', () => {
  it('allow/restrict need a reason; an end date must be in the future; none needs nothing', () => {
    expect(validateOverride({ override: 'none', until: null, reason: null }, NOW)).toEqual([])
    expect(validateOverride({ override: 'allow', until: null, reason: '' }, NOW)).toEqual(['reasonRequired'])
    expect(validateOverride({ override: 'restrict', until: days(-1), reason: 'Unpaid since March' }, NOW)).toEqual(['untilInPast'])
    expect(validateOverride({ override: 'allow', until: days(14), reason: 'Bank transfer on its way' }, NOW)).toEqual([])
  })
})
