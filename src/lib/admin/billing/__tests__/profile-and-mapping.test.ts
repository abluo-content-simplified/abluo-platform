import { describe, it, expect } from 'vitest'
import { isIsoDate } from '@/lib/billing/dates'
import { romeDayEnd, romeDayStart, validateBillingProfile } from '../model'
import { summarise, toFacts, toAgreementView, type ProjectBillingRow, type BillingSubscriptionRow } from '../mapping'

const row = (r: Partial<ProjectBillingRow> = {}): ProjectBillingRow => ({
  project_id: 'p1', arrangement: 'stripe', amount_cents: 24000, currency: 'eur', billing_interval: 'year', interval_count: 1, starts_on: null,
  activation_due_at: '2026-10-01T00:00:00Z', activation_extension_reason: null, manual_paid_through: null, terms_version: 1,
  billing_subscription_id: null, override: 'none', override_until: null, override_reason: null, override_set_at: null,
  review_acknowledged_at: null, review_note: null, updated_at: '2026-10-01T00:00:00Z', ...r,
})
const sub = (s: Partial<BillingSubscriptionRow> = {}): BillingSubscriptionRow => ({
  id: 's1', status: 'active', first_paid_at: '2026-10-02T00:00:00Z', payment_failed_at: null, current_period_end: '2027-10-02T00:00:00Z', cancel_at_period_end: false, ended_at: null, ...s,
})

describe('validateBillingProfile', () => {
  const ok = { billingEmail: ' A@B.it ', customerType: 'business', legalName: 'Acme', country: 'it', vatId: 'it 123 456' }
  it('normalises', () => {
    expect(validateBillingProfile(ok)).toEqual({
      ok: true,
      value: { billingEmail: 'a@b.it', customerType: 'business', legalName: 'Acme', addressLine1: null, addressLine2: null, postalCode: null, city: null, region: null, country: 'IT', vatId: 'IT123456' },
    })
  })
  it('flags bad email, country, vat, type', () => {
    const r = validateBillingProfile({ billingEmail: 'x', country: 'ITA', vatId: '1234', customerType: 'company' })
    expect(r).toEqual({ ok: false, fields: ['billingEmail', 'customerType', 'country', 'vatId'] })
  })
  it('business needs a legal name; individual does not; all blank is fine', () => {
    expect(validateBillingProfile({ customerType: 'business' })).toEqual({ ok: false, fields: ['legalName'] })
    expect(validateBillingProfile({ customerType: 'individual' }).ok).toBe(true)
    expect(validateBillingProfile({}).ok).toBe(true)
  })
  it('enforces column lengths', () => {
    expect(validateBillingProfile({ postalCode: '1'.repeat(21) })).toEqual({ ok: false, fields: ['postalCode'] })
  })
})

describe('isIsoDate', () => {
  it('rejects calendar-invalid dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    for (const bad of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '26-01-01', '']) expect(isIsoDate(bad)).toBe(false)
  })
})

describe('Europe/Rome day boundaries', () => {
  it('winter and summer offsets', () => {
    expect(romeDayStart('2026-01-15')?.toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(romeDayStart('2026-07-15')?.toISOString()).toBe('2026-07-14T22:00:00.000Z')
    expect(romeDayStart('2026-03-29')?.toISOString()).toBe('2026-03-28T23:00:00.000Z') // DST day starts at +1
    expect(romeDayEnd('2026-03-28')?.toISOString()).toBe('2026-03-28T23:00:00.000Z')
  })
  it('invalid dates', () => {
    expect(romeDayStart('2026-13-01')).toBeNull()
    expect(romeDayEnd('nope')).toBeNull()
  })
})

describe('summarise / toFacts', () => {
  const now = new Date('2026-11-02T00:00:00Z')
  it('maps rows to facts', () => {
    const f = toFacts(row({ billing_subscription_id: 's1' }), sub())
    expect(f.activationDueAt).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(f.subscription?.firstPaidAt).toEqual(new Date('2026-10-02T00:00:00Z'))
  })
  it('paid subscription → ok', () => {
    expect(summarise(row({ billing_subscription_id: 's1' }), sub(), now)).toMatchObject({ projectId: 'p1', state: 'ok', reason: 'paid', billed: true })
  })
  it('unpaid past due → clock; acknowledgement counts only for the current clock', () => {
    const base = summarise(row({ activation_due_at: '2026-10-25T00:00:00Z' }), null, now)
    expect(base.state).toBe('reminder')
    expect(base.reviewAcknowledged).toBe(false)
    const review = new Date('2026-12-15T00:00:00Z')
    expect(summarise(row({ activation_due_at: '2026-10-25T00:00:00Z' }), null, review).state).toBe('review')
    expect(summarise(row({ activation_due_at: '2026-10-25T00:00:00Z', review_acknowledged_at: '2026-11-30T00:00:00Z' }), null, review).reviewAcknowledged).toBe(true)
    expect(summarise(row({ activation_due_at: '2026-10-25T00:00:00Z', review_acknowledged_at: '2026-09-01T00:00:00Z' }), null, review).reviewAcknowledged).toBe(false)
  })
  it('complimentary is not billed', () => {
    expect(summarise(row({ arrangement: 'complimentary', amount_cents: null, billing_interval: null, activation_due_at: null }), null, now)).toMatchObject({ state: 'ok', reason: 'complimentary', billed: false })
  })
  it('agreement view uses ISO strings', () => {
    expect(toAgreementView(row({ updated_at: '2026-10-01T02:00:00+02:00' })).updatedAt).toBe('2026-10-01T00:00:00.000Z')
  })
})
