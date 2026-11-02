/**
 * Pure mapping between billing table rows and the view models (ADR-041).
 * No I/O: `queries.ts` reads the rows, these functions shape them, so the
 * rules are testable without a database.
 */
import { resolveProjectBilling, type BillingArrangement, type BillingOverride, type ProjectBillingFacts, type ProjectBillingStatus, type StripeSubscriptionStatus } from '@/lib/billing/lifecycle'
import type { BillingAgreementView, BillingProfileView, BillingStatusView, BillingSubscriptionView, ProjectBillingSummary } from './types'

export type ProjectBillingRow = {
  project_id: string
  arrangement: BillingArrangement
  amount_cents: number | null
  currency: string
  billing_interval: 'month' | 'year' | null
  interval_count: number
  starts_on: string | null
  activation_due_at: string | null
  activation_extension_reason: string | null
  manual_paid_through: string | null
  terms_version: number
  billing_subscription_id: string | null
  override: BillingOverride
  override_until: string | null
  override_reason: string | null
  override_set_at: string | null
  review_acknowledged_at: string | null
  review_note: string | null
  updated_at: string
}

export type BillingSubscriptionRow = {
  id: string
  status: StripeSubscriptionStatus
  first_paid_at: string | null
  payment_failed_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  ended_at: string | null
}

export type BillingProfileRow = {
  billing_email: string | null
  customer_type: 'business' | 'individual' | null
  legal_name: string | null
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  region: string | null
  country: string | null
  vat_id: string | null
  vat_verification: BillingProfileView['vatVerification']
  vat_verified_at: string | null
}

export const PROJECT_BILLING_COLUMNS =
  'project_id, arrangement, amount_cents, currency, billing_interval, interval_count, starts_on, activation_due_at, activation_extension_reason, manual_paid_through, terms_version, billing_subscription_id, override, override_until, override_reason, override_set_at, review_acknowledged_at, review_note, updated_at'
export const BILLING_SUBSCRIPTION_COLUMNS = 'id, status, first_paid_at, payment_failed_at, current_period_end, cancel_at_period_end, ended_at'
export const BILLING_PROFILE_COLUMNS =
  'billing_email, customer_type, legal_name, address_line1, address_line2, postal_code, city, region, country, vat_id, vat_verification, vat_verified_at'

/** A timestamp string → Date; null for null or unparseable input. */
function date(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const iso = (v: string | Date | null | undefined): string | null => {
  const d = v instanceof Date ? v : date(v)
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

export function toFacts(row: ProjectBillingRow, sub: BillingSubscriptionRow | null): ProjectBillingFacts {
  return {
    arrangement: row.arrangement,
    activationDueAt: date(row.activation_due_at),
    manualPaidThrough: row.manual_paid_through,
    override: row.override,
    overrideUntil: date(row.override_until),
    subscription: sub
      ? {
          status: sub.status,
          firstPaidAt: date(sub.first_paid_at),
          paymentFailedAt: date(sub.payment_failed_at),
          currentPeriodEnd: date(sub.current_period_end),
          endedAt: date(sub.ended_at),
        }
      : null,
  }
}

export function toStatusView(s: ProjectBillingStatus): BillingStatusView {
  return { state: s.state, reason: s.reason, clockStartedAt: iso(s.clockStartedAt), day: s.day, daysLeft: s.daysLeft }
}

export function toAgreementView(row: ProjectBillingRow): BillingAgreementView {
  return {
    arrangement: row.arrangement,
    amountCents: row.amount_cents,
    currency: row.currency,
    interval: row.billing_interval,
    intervalCount: row.interval_count,
    startsOn: row.starts_on,
    activationDueAt: iso(row.activation_due_at),
    activationExtensionReason: row.activation_extension_reason,
    manualPaidThrough: row.manual_paid_through,
    override: row.override,
    overrideUntil: iso(row.override_until),
    overrideReason: row.override_reason,
    overrideSetAt: iso(row.override_set_at),
    reviewAcknowledgedAt: iso(row.review_acknowledged_at),
    reviewNote: row.review_note,
    termsVersion: row.terms_version,
    updatedAt: iso(row.updated_at) ?? row.updated_at,
  }
}

export function toSubscriptionView(sub: BillingSubscriptionRow): BillingSubscriptionView {
  return {
    status: sub.status,
    firstPaidAt: iso(sub.first_paid_at),
    paymentFailedAt: iso(sub.payment_failed_at),
    currentPeriodEnd: iso(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  }
}

export function toProfileView(row: BillingProfileRow): BillingProfileView {
  return {
    billingEmail: row.billing_email,
    customerType: row.customer_type,
    legalName: row.legal_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    city: row.city,
    region: row.region,
    country: row.country,
    vatId: row.vat_id,
    vatVerification: row.vat_verification,
    vatVerifiedAt: iso(row.vat_verified_at),
  }
}

/** Was the day-29 review acknowledged for the CURRENT clock (acknowledged at/after the clock started)? */
export function isReviewAcknowledged(ackAt: string | null, clockStartedAt: Date | null): boolean {
  const ack = date(ackAt)
  return !!ack && !!clockStartedAt && ack.getTime() >= clockStartedAt.getTime()
}

/** One row of the Projects list / Admin Home. `billed` = money is expected (anything but complimentary). */
export function summarise(row: ProjectBillingRow, sub: BillingSubscriptionRow | null, now: Date): ProjectBillingSummary {
  const status = resolveProjectBilling(toFacts(row, sub), now)
  return {
    projectId: row.project_id,
    state: status.state,
    reason: status.reason,
    day: status.day,
    reviewAcknowledged: isReviewAcknowledged(row.review_acknowledged_at, status.clockStartedAt),
    billed: row.arrangement !== 'complimentary',
  }
}
