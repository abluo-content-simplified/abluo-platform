import { describe, expect, it } from 'vitest'
import { billingPillModel } from '../billing-status-model'
import type { BillingStatusView } from '@/lib/admin/billing/types'

const v = (p: Partial<BillingStatusView>): BillingStatusView => ({ state: 'ok', reason: 'paid', clockStartedAt: null, day: null, daysLeft: null, ...p })

describe('billingPillModel', () => {
  it('not billed', () => {
    expect(billingPillModel(null, true).key).toBe('notBilled')
    expect(billingPillModel(v({ reason: 'complimentary' }), false).key).toBe('complimentary')
    expect(billingPillModel(v({ state: 'locked', reason: 'override_restrict' }), false).key).toBe('overrideRestricted')
    expect(billingPillModel(v({ reason: 'override_allow' }), false).key).toBe('overrideAllowed')
    expect(billingPillModel(v({ reason: 'not_billed' })).key).toBe('notBilled')
  })
  it('ok states', () => {
    expect(billingPillModel(v({ reason: 'paid' }))).toMatchObject({ key: 'paid', tone: 'success' })
    expect(billingPillModel(v({ reason: 'complimentary' })).key).toBe('complimentary')
    expect(billingPillModel(v({ reason: 'before_due' })).key).toBe('notDue')
    expect(billingPillModel(v({ reason: 'override_allow' })).key).toBe('overrideAllowed')
    expect(billingPillModel(v({ reason: 'invalid_record' })).key).toBe('checkData')
  })
  it('reminder', () => {
    expect(billingPillModel(v({ state: 'reminder', reason: 'awaiting_first_payment', day: 3, daysLeft: 12 }))).toEqual({ key: 'paymentDue', tone: 'highlight', values: { daysLeft: 12 } })
    expect(billingPillModel(v({ state: 'reminder', daysLeft: null })).key).toBe('paymentDueNoDays')
  })
  it('locked', () => {
    expect(billingPillModel(v({ state: 'locked', reason: 'payment_failed', day: 20 }))).toEqual({ key: 'locked', tone: 'highlight', values: { day: 20 } })
    expect(billingPillModel(v({ state: 'locked', reason: 'override_restrict' })).key).toBe('overrideRestricted')
    expect(billingPillModel(v({ state: 'locked', day: null })).key).toBe('lockedNoDay')
  })
  it('review', () => {
    expect(billingPillModel(v({ state: 'review', reason: 'payment_failed' })).key).toBe('needsReview')
  })
})
