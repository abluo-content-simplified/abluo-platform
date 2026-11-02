/**
 * Pure helpers of the admin Billing card (ADR-041 Phase 2): money and date
 * formatting, which controls a viewer sees, form state ⇄ action inputs, and
 * mapping the server's error codes onto form fields. No I/O, client-safe.
 */
import { ACTIVATION_MAX_DAYS, type BillingArrangement, type BillingOverride } from '@/lib/billing/lifecycle'
import type {
  BillingAgreementView,
  BillingProfileView,
  BillingSubscriptionView,
  ProjectBillingView,
  SaveBillingProfileInput,
  SaveBillingTermsInput,
  SetBillingOverrideInput,
} from './types'

const DAY_MS = 86_400_000

/** "€ 240.00" for the admin's locale; never throws. */
export function formatMoney(cents: number, currency: string, locale: string): string {
  const value = cents / 100
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** Cents → what a person would type back into the amount field ("240", "1200.50"). */
export function centsToInput(cents: number | null): string {
  if (cents === null) return ''
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

/** ISO timestamp → calendar date (YYYY-MM-DD) in Europe/Rome, where due dates are set (ADR-041 D7). */
export function romeDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/**
 * The last day an override covers. The server stores an end date D as 00:00
 * Europe/Rome on D+1, so the day to show (and to prefill) is one millisecond earlier.
 */
export function romeEndDate(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '' : romeDate(new Date(t - 1).toISOString())
}

/** True when a due date (YYYY-MM-DD) lies more than ACTIVATION_MAX_DAYS after today (YYYY-MM-DD). */
export function needsExtensionReason(dueOn: string, today: string): boolean {
  const due = Date.parse(`${dueOn}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(due) || Number.isNaN(now)) return false
  return due - now > ACTIVATION_MAX_DAYS * DAY_MS
}

export type CardActions = {
  setUp: boolean
  editTerms: boolean
  override: boolean
  removeOverride: boolean
  review: boolean
  editContact: boolean
}

/** Which controls the card shows. Read-only admins see none; the server re-checks every action anyway. */
export function visibleActions(view: Pick<ProjectBillingView, 'canEdit' | 'agreement' | 'status'>): CardActions {
  const none: CardActions = { setUp: false, editTerms: false, override: false, removeOverride: false, review: false, editContact: false }
  if (!view.canEdit) return none
  if (!view.agreement) return { ...none, setUp: true, editContact: true }
  return {
    setUp: false,
    editTerms: true,
    override: true,
    removeOverride: view.agreement.override !== 'none',
    review: view.status.state === 'review',
    editContact: true,
  }
}

// ── Terms form ──────────────────────────────────────────────────────────────

export type TermsForm = {
  arrangement: BillingArrangement
  amount: string
  interval: 'month' | 'year'
  startsOn: string
  activationDueOn: string
  reason: string
  paidThrough: string
}

export function termsFormFrom(agreement: BillingAgreementView | null): TermsForm {
  return {
    arrangement: agreement?.arrangement ?? 'stripe',
    amount: centsToInput(agreement?.amountCents ?? null),
    interval: agreement?.interval ?? 'year',
    startsOn: agreement?.startsOn ?? '',
    activationDueOn: romeDate(agreement?.activationDueAt ?? null),
    reason: agreement?.activationExtensionReason ?? '',
    paidThrough: agreement?.manualPaidThrough ?? '',
  }
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function toTermsInput(projectId: string, f: TermsForm, today: string): SaveBillingTermsInput {
  const paid = f.arrangement !== 'complimentary'
  const dueOn = paid ? orNull(f.activationDueOn) : null
  return {
    projectId,
    arrangement: f.arrangement,
    amount: paid ? orNull(f.amount) : null,
    interval: paid ? f.interval : null,
    startsOn: orNull(f.startsOn),
    activationDueOn: dueOn,
    activationExtensionReason: dueOn && needsExtensionReason(dueOn, today) ? orNull(f.reason) : null,
    manualPaidThrough: f.arrangement === 'manual' ? orNull(f.paidThrough) : null,
  }
}

/** Form fields shown for an arrangement. */
export function termsFieldsFor(arrangement: BillingArrangement): { price: boolean; paidThrough: boolean; dueDate: boolean } {
  return { price: arrangement !== 'complimentary', paidThrough: arrangement === 'manual', dueDate: arrangement !== 'complimentary' }
}

const ACTIVE_SUBSCRIPTION = new Set(['active', 'trialing', 'past_due'])

/** Changing the price of a running Stripe subscription only takes effect at the next renewal. */
export function priceAppliesLater(
  agreement: BillingAgreementView | null,
  subscription: BillingSubscriptionView | null,
  f: TermsForm,
  parsedCents: number | null,
): boolean {
  if (!agreement || agreement.arrangement !== 'stripe' || f.arrangement !== 'stripe') return false
  if (!subscription || !ACTIVE_SUBSCRIPTION.has(subscription.status)) return false
  return parsedCents !== agreement.amountCents || f.interval !== agreement.interval
}

// ── Error codes → fields ────────────────────────────────────────────────────

export type FieldErrors = Record<string, string>

function mapCodes(fields: string[] | undefined, map: Record<string, string>): FieldErrors {
  const out: FieldErrors = {}
  for (const code of fields ?? []) {
    const field = map[code]
    if (field && !out[field]) out[field] = code
  }
  return out
}

/** field key → the error code to show (the message is `fieldErrors.<code>`). */
const TERMS_FIELD: Record<string, string> = {
  arrangement: 'arrangement',
  amount: 'amount',
  interval: 'interval',
  startsOn: 'startsOn',
  activationDueRequired: 'activationDueOn',
  activationDueOn: 'activationDueOn',
  activationReasonRequired: 'reason',
  activationExtensionReason: 'reason',
  manualPaidThrough: 'paidThrough',
}
export const termsFieldErrors = (fields: string[] | undefined): FieldErrors => mapCodes(fields, TERMS_FIELD)

const OVERRIDE_FIELD: Record<string, string> = { override: 'override', reasonRequired: 'reason', reason: 'reason', untilInPast: 'until', untilOn: 'until' }
export const overrideFieldErrors = (fields: string[] | undefined): FieldErrors => mapCodes(fields, OVERRIDE_FIELD)

export const PROFILE_FIELDS = ['billingEmail', 'customerType', 'legalName', 'contactName', 'addressLine1', 'addressLine2', 'postalCode', 'city', 'region', 'country', 'vatId', 'taxCode'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]
const PROFILE_ALIASES: Record<string, ProfileField> = { email: 'billingEmail', name: 'legalName', vat: 'vatId', countryCode: 'country', contact: 'contactName', fiscalCode: 'taxCode' }
export function profileFieldErrors(fields: string[] | undefined): FieldErrors {
  const map: Record<string, string> = {}
  for (const f of PROFILE_FIELDS) map[f] = f
  for (const [alias, f] of Object.entries(PROFILE_ALIASES)) map[alias] = f
  const out = mapCodes(fields, map)
  // The message key is the canonical field code, not the alias.
  for (const k of Object.keys(out)) out[k] = k
  return out
}

/** Acknowledging a review: a too-long note, or the site is no longer in review ('state', shown as the dialog's error). */
const REVIEW_FIELD: Record<string, string> = { note: 'note', state: 'state' }
export const reviewFieldErrors = (fields: string[] | undefined): FieldErrors => mapCodes(fields, REVIEW_FIELD)

// ── Override ────────────────────────────────────────────────────────────────

export type OverrideForm = { mode: Exclude<BillingOverride, 'none'>; untilOn: string; reason: string }

export function overrideFormFrom(agreement: BillingAgreementView | null): OverrideForm {
  const mode = agreement && agreement.override !== 'none' ? agreement.override : 'allow'
  return { mode, untilOn: romeEndDate(agreement?.overrideUntil ?? null), reason: agreement?.overrideReason ?? '' }
}

export function toOverrideInput(projectId: string, f: OverrideForm): SetBillingOverrideInput {
  return { projectId, override: f.mode, untilOn: orNull(f.untilOn), reason: orNull(f.reason) }
}

export const removeOverrideInput = (projectId: string): SetBillingOverrideInput => ({ projectId, override: 'none', untilOn: null, reason: null })

// ── Billing contact ─────────────────────────────────────────────────────────

export type ProfileForm = Record<Exclude<ProfileField, 'customerType'>, string> & { customerType: 'business' | 'individual' }

export function profileFormFrom(p: BillingProfileView | null): ProfileForm {
  return {
    billingEmail: p?.billingEmail ?? '',
    customerType: p?.customerType ?? 'business',
    legalName: p?.legalName ?? '',
    contactName: p?.contactName ?? '',
    addressLine1: p?.addressLine1 ?? '',
    addressLine2: p?.addressLine2 ?? '',
    postalCode: p?.postalCode ?? '',
    city: p?.city ?? '',
    region: p?.region ?? '',
    country: p?.country ?? '',
    vatId: p?.vatId ?? '',
    taxCode: p?.taxCode ?? '',
  }
}

/**
 * Which fields the profile form shows for a customer type and country:
 * business → contact person + VAT number; individual → neither, plus the
 * optional codice fiscale when the country is Italy. The name field is the
 * company name (business) or the full name (individual).
 */
export function profileFieldsFor(customerType: ProfileForm['customerType'], country: string): { contactName: boolean; vatId: boolean; taxCode: boolean; nameLabel: 'companyName' | 'fullName' } {
  const business = customerType === 'business'
  return {
    contactName: business,
    vatId: business,
    taxCode: !business && country.trim().toUpperCase() === 'IT',
    nameLabel: business ? 'companyName' : 'fullName',
  }
}

export function toProfileInput(tenantId: string, f: ProfileForm): SaveBillingProfileInput {
  const country = orNull(f.country)?.toUpperCase() ?? null
  const shown = profileFieldsFor(f.customerType, country ?? '')
  return {
    tenantId,
    billingEmail: orNull(f.billingEmail),
    customerType: f.customerType,
    legalName: orNull(f.legalName),
    // Hidden fields are cleared, so switching type never leaves stale data behind.
    contactName: shown.contactName ? orNull(f.contactName) : null,
    addressLine1: orNull(f.addressLine1),
    addressLine2: orNull(f.addressLine2),
    postalCode: orNull(f.postalCode),
    city: orNull(f.city),
    region: orNull(f.region),
    country,
    vatId: shown.vatId ? (orNull(f.vatId)?.replace(/\s+/g, '') ?? null) : null,
    taxCode: shown.taxCode ? (orNull(f.taxCode)?.replace(/\s+/g, '').toUpperCase() ?? null) : null,
  }
}
