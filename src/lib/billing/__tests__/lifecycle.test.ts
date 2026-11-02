/**
 * ADR-041 — the per-project billing state, computed from payment facts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTIVATION_MAX_DAYS,
  BILLING_LOCK_LAST_DAY,
  BILLING_REMINDER_LAST_DAY,
  isBillingLocked,
  resolveProjectBilling,
  type ProjectBillingFacts,
  type SubscriptionFacts,
} from '../lifecycle'

const DAY = 86_400_000
const T0 = new Date('2027-03-01T09:00:00Z')
const at = (days: number, extraMs = 0) => new Date(T0.getTime() + days * DAY + extraMs)

const sub = (s: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  status: 'active', firstPaidAt: new Date('2026-03-01T09:00:00Z'), paymentFailedAt: null, currentPeriodEnd: null, endedAt: null, ...s,
})
const stripe = (f: Partial<ProjectBillingFacts> = {}): ProjectBillingFacts => ({
  arrangement: 'stripe', activationDueAt: new Date('2026-03-01T00:00:00Z'), manualPaidThrough: null,
  override: 'none', overrideUntil: null, subscription: sub(), ...f,
})

describe('resolveProjectBilling — no record / complimentary', () => {
  it('no billing record → ok (existing projects are not billed until migrated, D4)', () => {
    expect(resolveProjectBilling(null, T0)).toMatchObject({ state: 'ok', reason: 'not_billed' })
  })
  it('complimentary → ok forever', () => {
    expect(resolveProjectBilling(stripe({ arrangement: 'complimentary', subscription: null }), at(9999))).toMatchObject({ state: 'ok', reason: 'complimentary' })
  })
})

describe('resolveProjectBilling — the 14 / 28 / 29 ladder (from the first confirmed failure, D2)', () => {
  const failing = stripe({ subscription: sub({ status: 'past_due', paymentFailedAt: T0 }) })
  it.each([
    [0, 'reminder', 1, 14],
    [13, 'reminder', 14, 1],
    [14, 'locked', 15, 14],
    [27, 'locked', 28, 1],
    [28, 'review', 29, null],
    [400, 'review', 401, null],
  ] as const)('day offset %i → %s (day %i, %s left)', (offset, state, day, daysLeft) => {
    expect(resolveProjectBilling(failing, at(offset, 3_600_000))).toMatchObject({ state, reason: 'payment_failed', day, daysLeft, clockStartedAt: T0 })
  })
  it('exact boundaries: the lock starts at failure + 14 × 24 h, review at + 28 × 24 h', () => {
    expect(resolveProjectBilling(failing, at(14, -1)).state).toBe('reminder')
    expect(resolveProjectBilling(failing, at(14)).state).toBe('locked')
    expect(resolveProjectBilling(failing, at(28, -1)).state).toBe('locked')
    expect(resolveProjectBilling(failing, at(28)).state).toBe('review')
  })
  it('constants match the approved policy', () => {
    expect([BILLING_REMINDER_LAST_DAY, BILLING_LOCK_LAST_DAY]).toEqual([14, 28])
  })
  it('paying (failure settled → paymentFailedAt null) restores ok immediately, from any state', () => {
    for (const offset of [3, 20, 90]) {
      const paid = stripe({ subscription: sub({ status: 'active', paymentFailedAt: null }) })
      expect(resolveProjectBilling(paid, at(offset))).toMatchObject({ state: 'ok', reason: 'paid' })
    }
  })
  it('unpaid with an open failure follows the same ladder (status alone never decides)', () => {
    const unpaid = stripe({ subscription: sub({ status: 'unpaid', paymentFailedAt: T0 }) })
    expect(resolveProjectBilling(unpaid, at(20)).state).toBe('locked')
  })
})

describe('resolveProjectBilling — first payment (activation, D7)', () => {
  const due = T0
  it('before the due date → ok (provisioned early / trial)', () => {
    expect(resolveProjectBilling(stripe({ activationDueAt: due, subscription: null }), at(-5))).toMatchObject({ state: 'ok', reason: 'before_due' })
  })
  it('after the due date without a confirmed payment → the ladder runs from the due date', () => {
    const f = stripe({ activationDueAt: due, subscription: null })
    expect(resolveProjectBilling(f, at(1))).toMatchObject({ state: 'reminder', reason: 'awaiting_first_payment', day: 2 })
    expect(resolveProjectBilling(f, at(15)).state).toBe('locked')
    expect(resolveProjectBilling(f, at(30)).state).toBe('review')
  })
  it('a subscription that is `active` but has no confirmed payment is NOT activated (delayed methods)', () => {
    const f = stripe({ activationDueAt: due, subscription: sub({ status: 'active', firstPaidAt: null }) })
    expect(resolveProjectBilling(f, at(20))).toMatchObject({ state: 'locked', reason: 'awaiting_first_payment' })
  })
  it('an expired first checkout (incomplete_expired, never paid) keeps the activation clock', () => {
    const f = stripe({ activationDueAt: due, subscription: sub({ status: 'incomplete_expired', firstPaidAt: null }) })
    expect(resolveProjectBilling(f, at(3))).toMatchObject({ state: 'reminder', reason: 'awaiting_first_payment' })
  })
  it('the first confirmed payment activates', () => {
    expect(resolveProjectBilling(stripe({ activationDueAt: due }), at(20))).toMatchObject({ state: 'ok', reason: 'paid' })
  })
  it('the 30-day window matches the database trigger in migration 057', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/057_billing_foundation.sql'), 'utf8')
    expect(sql).toContain(`interval '${ACTIVATION_MAX_DAYS} days'`)
    expect(ACTIVATION_MAX_DAYS).toBe(30)
  })
})

describe('resolveProjectBilling — cancellation (D3)', () => {
  const end = T0
  it('cancel at period end: the paid period runs normally', () => {
    const f = stripe({ subscription: sub({ status: 'active', currentPeriodEnd: end }) })
    expect(resolveProjectBilling(f, at(-1))).toMatchObject({ state: 'ok', reason: 'paid' })
  })
  it('after the period ends the ladder starts at the end of the period', () => {
    const f = stripe({ subscription: sub({ status: 'canceled', endedAt: end, currentPeriodEnd: end }) })
    expect(resolveProjectBilling(f, at(-1))).toMatchObject({ state: 'ok' })
    expect(resolveProjectBilling(f, at(2))).toMatchObject({ state: 'reminder', reason: 'subscription_ended', clockStartedAt: end })
    expect(resolveProjectBilling(f, at(16)).state).toBe('locked')
  })
  it('falls back to current_period_end when ended_at is missing', () => {
    const f = stripe({ subscription: sub({ status: 'canceled', endedAt: null, currentPeriodEnd: end }) })
    expect(resolveProjectBilling(f, at(2)).reason).toBe('subscription_ended')
  })
})

describe('resolveProjectBilling — manual (bank transfer)', () => {
  const manual = (f: Partial<ProjectBillingFacts>) => stripe({ arrangement: 'manual', subscription: null, activationDueAt: null, ...f })
  it('paid through a date → ok through that whole day, ladder from the next day (UTC)', () => {
    const f = manual({ manualPaidThrough: '2027-02-28' })
    expect(resolveProjectBilling(f, new Date('2027-02-28T23:59:59Z'))).toMatchObject({ state: 'ok', reason: 'paid' })
    expect(resolveProjectBilling(f, new Date('2027-03-01T00:00:00Z'))).toMatchObject({ state: 'reminder', reason: 'manual_overdue', day: 1 })
    expect(resolveProjectBilling(f, new Date('2027-03-15T00:00:00Z')).state).toBe('locked')
  })
  it('never paid, with a due date → ladder from the due date; with neither → ok', () => {
    expect(resolveProjectBilling(manual({ activationDueAt: T0 }), at(20)).state).toBe('locked')
    expect(resolveProjectBilling(manual({}), at(20))).toMatchObject({ state: 'ok', reason: 'before_due' })
  })
})

describe('resolveProjectBilling — Super Admin override (D9)', () => {
  const failing = stripe({ subscription: sub({ paymentFailedAt: T0 }) })
  it('allow wins while it lasts, then the real state returns', () => {
    const f = { ...failing, override: 'allow' as const, overrideUntil: at(40) }
    expect(resolveProjectBilling(f, at(35))).toMatchObject({ state: 'ok', reason: 'override_allow' })
    expect(resolveProjectBilling(f, at(41)).state).toBe('review')
  })
  it('allow without an end date lasts until removed', () => {
    expect(resolveProjectBilling({ ...failing, override: 'allow', overrideUntil: null }, at(500)).state).toBe('ok')
  })
  it('restrict locks a project even when it is paid', () => {
    expect(resolveProjectBilling({ ...stripe(), override: 'restrict', overrideUntil: null }, T0)).toMatchObject({ state: 'locked', reason: 'override_restrict' })
  })
})

describe('resolveProjectBilling — fails open on inconsistent data (D8)', () => {
  it.each([
    ['stripe without a due date and no payment', stripe({ activationDueAt: null, subscription: null })],
    ['canceled without any end date', stripe({ subscription: sub({ status: 'canceled', endedAt: null, currentPeriodEnd: null }) })],
    ['manual with a malformed date', stripe({ arrangement: 'manual', subscription: null, manualPaidThrough: '28/02/2027' })],
    ['unknown arrangement', { ...stripe(), arrangement: 'barter' as never }],
    ['invalid date', stripe({ subscription: sub({ paymentFailedAt: new Date('nope') }) })],
  ])('%s → ok / invalid_record', (_name, facts) => {
    expect(resolveProjectBilling(facts, at(100))).toMatchObject({ state: 'ok', reason: 'invalid_record' })
  })
})

describe('isBillingLocked', () => {
  it('locked and review lock; ok and reminder do not', () => {
    expect(['ok', 'reminder', 'locked', 'review'].map((s) => isBillingLocked(s as never))).toEqual([false, false, true, true])
  })
})
