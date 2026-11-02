import { describe, expect, it } from 'vitest'
import {
  centsToInput,
  formatMoney,
  needsExtensionReason,
  overrideFieldErrors,
  priceAppliesLater,
  profileFieldErrors,
  profileFieldsFor,
  profileFormFrom,
  romeDate,
  romeEndDate,
  reviewFieldErrors,
  overrideFormFrom,
  termsFieldErrors,
  termsFieldsFor,
  termsFormFrom,
  toOverrideInput,
  toProfileInput,
  toTermsInput,
  visibleActions,
  type ProfileForm,
} from '../card'
import type { BillingAgreementView, ProjectBillingView } from '../types'

const agreement = (over: Partial<BillingAgreementView> = {}): BillingAgreementView => ({
  arrangement: 'stripe', amountCents: 24000, currency: 'eur', interval: 'year', intervalCount: 1, startsOn: null,
  activationDueAt: '2026-11-19T23:00:00.000Z', activationExtensionReason: null, manualPaidThrough: null,
  override: 'none', overrideUntil: null, overrideReason: null, overrideSetAt: null, reviewAcknowledgedAt: null,
  reviewNote: null, termsVersion: 1, updatedAt: '2026-11-02T10:00:00.000Z', ...over,
})
const view = (over: Partial<Pick<ProjectBillingView, 'canEdit' | 'agreement' | 'status'>>) => ({
  canEdit: true,
  agreement: agreement(),
  status: { state: 'ok' as const, reason: 'paid' as const, clockStartedAt: null, day: null, daysLeft: null },
  ...over,
})

describe('formatting', () => {
  it('formats euro for the admin locale', () => {
    expect(formatMoney(24000, 'eur', 'en-GB')).toBe('€240.00')
    expect(formatMoney(1200050, 'eur', 'it-IT')).toMatch(/12\.000,50/)
  })
  it('falls back on a bad currency', () => expect(formatMoney(100, 'zz', 'en')).toContain('1.00'))
  it('turns cents back into typed text', () => {
    expect(centsToInput(24000)).toBe('240')
    expect(centsToInput(120050)).toBe('1200.50')
    expect(centsToInput(null)).toBe('')
  })
  it('reads due dates in Rome time', () => expect(romeDate('2026-11-19T23:00:00.000Z')).toBe('2026-11-20'))
})

describe('needsExtensionReason', () => {
  it('is false up to 30 days ahead and true beyond', () => {
    expect(needsExtensionReason('2026-12-02', '2026-11-02')).toBe(false)
    expect(needsExtensionReason('2026-12-03', '2026-11-02')).toBe(true)
    expect(needsExtensionReason('', '2026-11-02')).toBe(false)
  })
})

describe('visibleActions', () => {
  it('shows nothing to read-only admins', () => {
    expect(Object.values(visibleActions(view({ canEdit: false }))).some(Boolean)).toBe(false)
    expect(Object.values(visibleActions(view({ canEdit: false, agreement: null }))).some(Boolean)).toBe(false)
  })
  it('offers Set Up (and the contact) when not billed', () => {
    expect(visibleActions(view({ agreement: null }))).toMatchObject({ setUp: true, editTerms: false, override: false, review: false, editContact: true })
  })
  it('offers Mark as Reviewed only in review, Remove Override only with an override', () => {
    expect(visibleActions(view({})).review).toBe(false)
    expect(visibleActions(view({ status: { ...view({}).status, state: 'review' } })).review).toBe(true)
    expect(visibleActions(view({})).removeOverride).toBe(false)
    expect(visibleActions(view({ agreement: agreement({ override: 'allow' }) })).removeOverride).toBe(true)
  })
})

describe('terms form', () => {
  it('builds the action input and drops fields that do not apply', () => {
    const f = { ...termsFormFrom(null), amount: ' 240 ', activationDueOn: '2026-11-20', reason: 'ignored' }
    expect(toTermsInput('p1', f, '2026-11-02')).toMatchObject({ projectId: 'p1', arrangement: 'stripe', amount: '240', interval: 'year', activationDueOn: '2026-11-20', activationExtensionReason: null, manualPaidThrough: null })
    const far = toTermsInput('p1', { ...f, activationDueOn: '2027-03-01', reason: 'Client asked' }, '2026-11-02')
    expect(far.activationExtensionReason).toBe('Client asked')
    const free = toTermsInput('p1', { ...f, arrangement: 'complimentary', paidThrough: '2026-12-01' }, '2026-11-02')
    expect(free).toMatchObject({ amount: null, interval: null, manualPaidThrough: null })
    expect(toTermsInput('p1', { ...f, arrangement: 'manual', paidThrough: '2026-12-01' }, '2026-11-02').manualPaidThrough).toBe('2026-12-01')
  })
  it('prefills from an agreement', () => {
    expect(termsFormFrom(agreement())).toMatchObject({ arrangement: 'stripe', amount: '240', interval: 'year', activationDueOn: '2026-11-20' })
  })
  it('hides amount and paid-through where they do not apply', () => {
    expect(termsFieldsFor('complimentary')).toEqual({ price: false, paidThrough: false, dueDate: false })
    expect(termsFieldsFor('manual').paidThrough).toBe(true)
    expect(termsFieldsFor('stripe').paidThrough).toBe(false)
  })
  it('warns that a price change on a running subscription applies at renewal', () => {
    const sub = { status: 'active' as const, firstPaidAt: null, paymentFailedAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false }
    const f = termsFormFrom(agreement())
    expect(priceAppliesLater(agreement(), sub, f, 24000)).toBe(false)
    expect(priceAppliesLater(agreement(), sub, f, 30000)).toBe(true)
    expect(priceAppliesLater(agreement(), null, f, 30000)).toBe(false)
    expect(priceAppliesLater(null, sub, f, 30000)).toBe(false)
  })
})

describe('error codes → fields', () => {
  it('maps terms errors onto the right field', () => {
    expect(termsFieldErrors(['amount', 'activationReasonRequired', 'manualPaidThrough', 'bogus'])).toEqual({
      amount: 'amount', reason: 'activationReasonRequired', paidThrough: 'manualPaidThrough',
    })
    expect(termsFieldErrors(undefined)).toEqual({})
  })
  it('maps override and profile errors', () => {
    expect(overrideFieldErrors(['reasonRequired', 'untilInPast'])).toEqual({ reason: 'reasonRequired', until: 'untilInPast' })
    expect(profileFieldErrors(['vatId', 'email'])).toEqual({ vatId: 'vatId', billingEmail: 'billingEmail' })
  })
})

describe('override and profile inputs', () => {
  it('trims and nulls blanks', () => {
    expect(toOverrideInput('p', { mode: 'allow', untilOn: '', reason: '  Friend  ' })).toEqual({ projectId: 'p', override: 'allow', untilOn: null, reason: 'Friend' })
  })
  it('normalises country and VAT number', () => {
    const f = { billingEmail: ' a@b.it ', customerType: 'business' as const, legalName: 'X', contactName: ' Maria ', addressLine1: '', addressLine2: '', postalCode: '', city: '', region: '', country: 'it', vatId: 'IT 123 456', taxCode: '' }
    expect(toProfileInput('t', f)).toMatchObject({ tenantId: 't', billingEmail: 'a@b.it', country: 'IT', vatId: 'IT123456', addressLine1: null, contactName: 'Maria', taxCode: null })
  })
  const form = (over: Partial<ProfileForm> = {}): ProfileForm => ({
    billingEmail: 'a@b.it', customerType: 'business', legalName: 'Acme Srl', contactName: 'Maria Rossi', addressLine1: 'Via Roma 1', addressLine2: '',
    postalCode: '48015', city: 'Cervia', region: 'RA', country: 'IT', vatId: 'IT12345678901', taxCode: 'RSSMRA80A01H501U', ...over,
  })
  it('a business keeps contact person and VAT number but no codice fiscale', () => {
    expect(toProfileInput('t', form())).toMatchObject({ contactName: 'Maria Rossi', vatId: 'IT12345678901', taxCode: null })
  })
  it('an individual clears VAT number and contact person; keeps the codice fiscale only in Italy', () => {
    expect(toProfileInput('t', form({ customerType: 'individual', taxCode: 'rssmra80a01h501u' }))).toMatchObject({ contactName: null, vatId: null, taxCode: 'RSSMRA80A01H501U' })
    expect(toProfileInput('t', form({ customerType: 'individual', country: 'DE' }))).toMatchObject({ contactName: null, vatId: null, taxCode: null })
  })
  it('profileFieldsFor shows the fields of the customer type', () => {
    expect(profileFieldsFor('business', 'IT')).toEqual({ contactName: true, vatId: true, taxCode: false, nameLabel: 'companyName' })
    expect(profileFieldsFor('individual', 'it')).toEqual({ contactName: false, vatId: false, taxCode: true, nameLabel: 'fullName' })
    expect(profileFieldsFor('individual', 'DE')).toEqual({ contactName: false, vatId: false, taxCode: false, nameLabel: 'fullName' })
  })
  it('profileFormFrom reads the new fields', () => {
    expect(profileFormFrom(null)).toMatchObject({ customerType: 'business', contactName: '', taxCode: '' })
  })
})

describe('review round-trips', () => {
  it('shows the last covered day of an override, so re-saving does not drift', () => {
    // Server stores end date 2026-12-10 as 00:00 Rome on 2026-12-11 = 23:00Z on the 10th.
    expect(romeEndDate('2026-12-10T23:00:00.000Z')).toBe('2026-12-10')
    expect(overrideFormFrom(agreement({ override: 'allow', overrideUntil: '2026-12-10T23:00:00.000Z' })).untilOn).toBe('2026-12-10')
    expect(romeEndDate(null)).toBe('')
  })
  it('maps the extra server codes', () => {
    expect(termsFieldErrors(['activationDueOn', 'activationExtensionReason'])).toEqual({ activationDueOn: 'activationDueOn', reason: 'activationExtensionReason' })
    expect(overrideFieldErrors(['untilOn', 'reason'])).toEqual({ until: 'untilOn', reason: 'reason' })
    expect(reviewFieldErrors(['note', 'state'])).toEqual({ note: 'note', state: 'state' })
  })
  it('keeps the due date and its reason for manual, drops them for complimentary', () => {
    const f = { ...termsFormFrom(null), arrangement: 'manual' as const, amount: '100', activationDueOn: '2027-03-01', reason: 'Agreed' }
    expect(toTermsInput('p', f, '2026-11-02')).toMatchObject({ activationDueOn: '2027-03-01', activationExtensionReason: 'Agreed' })
    expect(toTermsInput('p', { ...f, arrangement: 'complimentary' }, '2026-11-02')).toMatchObject({ activationDueOn: null, activationExtensionReason: null })
  })
})
