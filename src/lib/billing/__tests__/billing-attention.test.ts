import { describe, expect, it } from 'vitest'
import type { BillingStatusView } from '@/lib/admin/billing/types'
import { PAY_NOW_NUDGE_DAYS, billingAttention, billingNavBadge, billingNoticeShown } from '../client-access'

const NOW = new Date('2026-11-02T10:00:00Z')
const OWNER = { canManage: true }
const status = (s: Partial<BillingStatusView>): Pick<BillingStatusView, 'state' | 'reason' | 'daysLeft'> => ({ state: 'ok', reason: 'before_due', daysLeft: null, ...s })
const site = (s: Partial<BillingStatusView>, over: { arrangement?: 'stripe' | 'manual' | 'complimentary' | null; dueAt?: string | null } = {}) => ({
  status: status(s),
  arrangement: over.arrangement === undefined ? ('stripe' as const) : over.arrangement,
  dueAt: over.dueAt === undefined ? '2026-11-06T23:00:00Z' : over.dueAt,
})

describe('billingAttention', () => {
  it('before the due date: payNow only when the due date is ≤ 7 days away', () => {
    expect(billingAttention(site({}), OWNER, NOW)).toEqual({ kind: 'payNow', daysLeft: 5 })
    expect(billingAttention(site({}, { dueAt: '2026-11-09T09:00:00Z' }), OWNER, NOW)).toEqual({ kind: 'payNow', daysLeft: PAY_NOW_NUDGE_DAYS })
    expect(billingAttention(site({}, { dueAt: '2026-11-10T12:00:00Z' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({}, { dueAt: '2026-11-01T00:00:00Z' }), OWNER, NOW)).toEqual({ kind: 'payNow', daysLeft: 0 })
    expect(billingAttention(site({}, { dueAt: null }), OWNER, NOW)).toBeNull()
  })
  it('reminder → paymentDue with days left; locked / review → paused', () => {
    expect(billingAttention(site({ state: 'reminder', reason: 'awaiting_first_payment', daysLeft: 9 }), OWNER, NOW)).toEqual({ kind: 'paymentDue', daysLeft: 9 })
    expect(billingAttention(site({ state: 'reminder', reason: 'payment_failed', daysLeft: -1 }), OWNER, NOW)).toEqual({ kind: 'paymentDue', daysLeft: 0 })
    expect(billingAttention(site({ state: 'locked', reason: 'subscription_ended', daysLeft: 3 }), OWNER, NOW)).toEqual({ kind: 'paused' })
    expect(billingAttention(site({ state: 'review', reason: 'awaiting_first_payment' }), OWNER, NOW)).toEqual({ kind: 'paused' })
  })
  it('nothing to pay → null', () => {
    expect(billingAttention(site({ reason: 'paid' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ reason: 'complimentary' }, { arrangement: 'complimentary' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ state: 'reminder', reason: 'manual_overdue', daysLeft: 4 }, { arrangement: 'manual' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ reason: 'not_billed' }, { arrangement: null }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ reason: 'override_allow' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ state: 'locked', reason: 'override_restrict' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(site({ reason: 'invalid_record' }), OWNER, NOW)).toBeNull()
    expect(billingAttention(null, OWNER, NOW)).toBeNull()
  })
  it('only the person who can manage billing is nudged', () => {
    const due = site({ state: 'reminder', reason: 'awaiting_first_payment', daysLeft: 9 })
    expect(billingAttention(due, { canManage: false }, NOW)).toBeNull()
    expect(billingAttention(due, null, NOW)).toBeNull()
  })
})

describe('billingNavBadge / billingNoticeShown', () => {
  it('a nudge is one badge, labelled by its kind', () => {
    expect(billingNavBadge({ kind: 'paymentDue', daysLeft: 3 })).toEqual({ count: 1, labelKey: 'paymentDue' })
    expect(billingNavBadge({ kind: 'paused' })).toEqual({ count: 1, labelKey: 'paused' })
    expect(billingNavBadge(null)).toBeUndefined()
  })
  it('the enforcement banner shows for a non-ok status outside support visits', () => {
    expect(billingNoticeShown({ state: 'reminder' }, null)).toBe(true)
    expect(billingNoticeShown({ state: 'ok' }, null)).toBe(false)
    expect(billingNoticeShown(undefined, null)).toBe(false)
    expect(billingNoticeShown({ state: 'locked' }, { sessionId: 's' })).toBe(false)
  })
})
