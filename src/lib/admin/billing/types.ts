/**
 * Contract between the admin billing server layer and the admin billing UI
 * (ADR-041 Phase 2). Plain, serialisable data only: dates are ISO strings so
 * the view can cross the server → client component boundary.
 *
 * Written first so the server layer (`queries.ts`, `actions.ts`) and the
 * screens (Billing card, Projects list, Admin Home) can be built in parallel.
 */
import type { BillingArrangement, BillingOverride, BillingReason, BillingState, StripeSubscriptionStatus } from '@/lib/billing/lifecycle'

/** The computed state of one project, as `resolveProjectBilling()` returns it (dates as ISO). */
export type BillingStatusView = {
  state: BillingState
  reason: BillingReason
  clockStartedAt: string | null
  day: number | null
  daysLeft: number | null
}

export type BillingAgreementView = {
  arrangement: BillingArrangement
  amountCents: number | null
  /** 'eur' in v1. */
  currency: string
  interval: 'month' | 'year' | null
  intervalCount: number
  startsOn: string | null
  activationDueAt: string | null
  activationExtensionReason: string | null
  manualPaidThrough: string | null
  override: BillingOverride
  overrideUntil: string | null
  overrideReason: string | null
  overrideSetAt: string | null
  reviewAcknowledgedAt: string | null
  reviewNote: string | null
  termsVersion: number
  updatedAt: string
}

export type BillingSubscriptionView = {
  status: StripeSubscriptionStatus
  firstPaidAt: string | null
  paymentFailedAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** The client's (tenant's) billing identity — shared by all its projects (ADR-041 D9, D14). */
export type BillingProfileView = {
  billingEmail: string | null
  customerType: 'business' | 'individual' | null
  legalName: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
  vatId: string | null
  vatVerification: 'none' | 'pending' | 'verified' | 'unverified' | 'unavailable'
  vatVerifiedAt: string | null
}

export type ProjectBillingView = {
  projectId: string
  tenantId: string
  /** false outside production (test data, ADR-041 D6) — the UI shows a "Test data" pill. */
  livemode: boolean
  status: BillingStatusView
  /** null = not billed (ADR-041 D4). */
  agreement: BillingAgreementView | null
  subscription: BillingSubscriptionView | null
  /** null = no billing profile recorded for the client yet. */
  profile: BillingProfileView | null
  /** The client's OTHER projects (they share the billing profile). */
  otherProjects: { id: string; name: string; slug: string }[]
  /** Last billing change on this project from admin_audit_log, if any. */
  lastChange: { action: string; at: string; actorEmail: string | null } | null
  /** Does the viewer hold `billing.admin`? Controls are hidden otherwise; the actions re-check. */
  canEdit: boolean
}

/** One row per project for the Projects list and Admin Home (cheap, no Stripe). */
export type ProjectBillingSummary = {
  projectId: string
  state: BillingState
  reason: BillingReason
  day: number | null
  /** Day-29 review acknowledged for the CURRENT clock (ack time ≥ clock start). */
  reviewAcknowledged: boolean
  billed: boolean
}

/** Result of every billing server action. */
export type BillingActionResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'invalid' | 'notFound' | 'failed'; fields?: string[] }

/** Inputs of the server actions (what the forms send). Money as typed text is parsed server-side. */
export type SaveBillingTermsInput = {
  projectId: string
  arrangement: BillingArrangement
  /** As typed, e.g. "240" or "1200,50"; ignored for complimentary. */
  amount: string | null
  interval: 'month' | 'year' | null
  startsOn: string | null
  /** ISO date (YYYY-MM-DD) — due at the start of that day, Europe/Rome. */
  activationDueOn: string | null
  activationExtensionReason: string | null
  manualPaidThrough: string | null
}
export type SetBillingOverrideInput = { projectId: string; override: BillingOverride; untilOn: string | null; reason: string | null }
export type AcknowledgeBillingReviewInput = { projectId: string; note: string | null }
export type SaveBillingProfileInput = {
  tenantId: string
  billingEmail: string | null
  customerType: 'business' | 'individual' | null
  legalName: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
  vatId: string | null
}
