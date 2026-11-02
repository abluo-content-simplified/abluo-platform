/**
 * Billing state of one project — ADR-041 D2, D3, D7, D9.
 *
 * PURE. No I/O, no clock of its own (`now` is passed in), no Stripe, no
 * database. The state is computed on every request from the project's real
 * payment facts (timestamps written by the webhook pipeline into migration
 * 057's tables), never stored and never advanced by a scheduled job — so a
 * customer who pays is unlocked on the very next request.
 *
 * Not wired into the application yet (ADR-041 §4 step 2).
 */

/** Days 1–14 after the clock starts: reminders only. */
export const BILLING_REMINDER_LAST_DAY = 14
/** Days 15–28: the project is locked for editing. Day 29 onwards: Super Admin review. */
export const BILLING_LOCK_LAST_DAY = 28
/**
 * How far ahead a first-payment due date may be set without a recorded
 * reason (Tom, 2026-10-30). Enforced in the database by
 * `project_billing_activation_window()` (migration 057); a test keeps the two equal.
 */
export const ACTIVATION_MAX_DAYS = 30

const DAY_MS = 86_400_000

export type BillingArrangement = 'stripe' | 'manual' | 'complimentary'
export type BillingOverride = 'none' | 'allow' | 'restrict'
export type StripeSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'

/** The linked subscription, as snapshotted in `billing_subscriptions`. */
export type SubscriptionFacts = {
  status: StripeSubscriptionStatus
  /** First CONFIRMED payment (invoice.paid). Activation is this, never `status`. */
  firstPaidAt: Date | null
  /** First confirmed failure of the open episode; null once settled. */
  paymentFailedAt: Date | null
  currentPeriodEnd: Date | null
  endedAt: Date | null
}

/** One project's `project_billing` row for the environment's mode, plus its subscription. */
export type ProjectBillingFacts = {
  arrangement: BillingArrangement
  activationDueAt: Date | null
  /** `manual` only — paid up to and including this calendar date (YYYY-MM-DD). */
  manualPaidThrough: string | null
  override: BillingOverride
  overrideUntil: Date | null
  subscription: SubscriptionFacts | null
}

export type BillingState = 'ok' | 'reminder' | 'locked' | 'review'

export type BillingReason =
  | 'not_billed'
  | 'complimentary'
  | 'override_allow'
  | 'override_restrict'
  | 'before_due'
  | 'paid'
  | 'awaiting_first_payment'
  | 'payment_failed'
  | 'subscription_ended'
  | 'manual_overdue'
  | 'invalid_record'

export type ProjectBillingStatus = {
  state: BillingState
  reason: BillingReason
  /** When the 14/28-day clock started; null when no clock runs. */
  clockStartedAt: Date | null
  /** 1-based day on the clock (day 1 = the first 24 h). */
  day: number | null
  /** reminder: days until the lock · locked: days until review · otherwise null. */
  daysLeft: number | null
}

const ok = (reason: BillingReason): ProjectBillingStatus => ({ state: 'ok', reason, clockStartedAt: null, day: null, daysLeft: null })

/** Is the billing state one in which editing is locked? (`review` behaves as `locked` for the client.) */
export function isBillingLocked(state: BillingState): boolean {
  return state === 'locked' || state === 'review'
}

/** The 14 / 28 / 29+ ladder for a clock that started at `start`. Before `start` → ok. */
export function clockState(start: Date, now: Date, reason: BillingReason, beforeReason: BillingReason): ProjectBillingStatus {
  const elapsed = now.getTime() - start.getTime()
  if (!Number.isFinite(elapsed)) return ok('invalid_record')
  if (elapsed < 0) return ok(beforeReason)
  const day = Math.floor(elapsed / DAY_MS) + 1
  if (day <= BILLING_REMINDER_LAST_DAY) {
    return { state: 'reminder', reason, clockStartedAt: start, day, daysLeft: BILLING_REMINDER_LAST_DAY + 1 - day }
  }
  if (day <= BILLING_LOCK_LAST_DAY) {
    return { state: 'locked', reason, clockStartedAt: start, day, daysLeft: BILLING_LOCK_LAST_DAY + 1 - day }
  }
  return { state: 'review', reason, clockStartedAt: start, day, daysLeft: null }
}

/** `YYYY-MM-DD` paid-through date → the first instant NOT covered (next day, 00:00 UTC). */
function dayAfter(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
}

function overrideActive(facts: ProjectBillingFacts, now: Date): boolean {
  return facts.override !== 'none' && (facts.overrideUntil === null || now < facts.overrideUntil)
}

/**
 * The billing state of one project at `now`.
 *
 * `facts === null` (no `project_billing` row for this mode) → `ok`: existing
 * projects are not billed until migrated explicitly (ADR-041 D4).
 *
 * Anything inconsistent resolves to `ok` with reason `invalid_record`:
 * billing is not a security boundary, and a data problem must never lock a
 * paying client (ADR-041 D8). The caller logs it.
 */
export function resolveProjectBilling(facts: ProjectBillingFacts | null, now: Date): ProjectBillingStatus {
  if (!facts) return ok('not_billed')

  // D9 — Super Admin override wins while it lasts; an expired one is ignored.
  if (overrideActive(facts, now)) {
    return facts.override === 'allow'
      ? ok('override_allow')
      : { state: 'locked', reason: 'override_restrict', clockStartedAt: null, day: null, daysLeft: null }
  }

  switch (facts.arrangement) {
    case 'complimentary':
      return ok('complimentary')

    case 'manual': {
      const start = facts.manualPaidThrough ? dayAfter(facts.manualPaidThrough) : facts.activationDueAt
      if (facts.manualPaidThrough && !start) return ok('invalid_record')
      if (!start) return ok('before_due') // nothing due yet
      return clockState(start, now, 'manual_overdue', facts.manualPaidThrough ? 'paid' : 'before_due')
    }

    case 'stripe': {
      const sub = facts.subscription
      // D7 — not activated until the first CONFIRMED payment, whatever `status`
      // says (delayed methods can be `active` before money arrives).
      if (!sub || !sub.firstPaidAt) {
        if (!facts.activationDueAt) return ok('invalid_record')
        return clockState(facts.activationDueAt, now, 'awaiting_first_payment', 'before_due')
      }
      // D2 — an unresolved confirmed failure: the clock runs from the FIRST failure.
      if (sub.paymentFailedAt) {
        return clockState(sub.paymentFailedAt, now, 'payment_failed', 'paid')
      }
      // D3 — after cancellation the paid period runs; the clock starts at its end.
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        const end = sub.endedAt ?? sub.currentPeriodEnd
        if (!end) return ok('invalid_record')
        return clockState(end, now, 'subscription_ended', 'paid')
      }
      return ok('paid')
    }

    default:
      return ok('invalid_record')
  }
}
