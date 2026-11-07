// ── Reservations — domain types (ADR-044 D2) ─────────────────────────────────
//
// Pure types: no database, no network. Ids are plain strings, like the
// scheduling layer (src/lib/scheduling/types.ts). Money is integer cents plus a
// currency (EUR only in v1, the column is kept). No user-facing text lives here.

export type Currency = 'EUR'

/** Integer cents. Use assertCents() (money.ts) at the boundaries. */
export type Cents = number

export type ReservationErrorCode =
  | 'invalid_cents'
  | 'invalid_project_code'
  | 'invalid_argument'
  | 'sign_up_required_when_limited'

export class ReservationError extends Error {
  constructor(readonly code: ReservationErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ReservationError'
  }
}

// ── Statuses (ADR-044 D4: three separate machines) ───────────────────────────

export const BOOKING_STATUSES = ['pending', 'held', 'awaiting_payment', 'confirmed', 'cancelled', 'expired'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const REFUND_STATUSES = ['requested', 'approved', 'done', 'failed', 'rejected'] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

export type StateMachineName = 'booking' | 'payment' | 'refund'

// ── Allocations, options, passes ─────────────────────────────────────────────

/** `invitation_hold` / `gift_pending` are reserved for later (D2). */
export type AllocationKind = 'hold' | 'confirmed' | 'pass_attendance'

export type OptionKind = 'full_edition' | 'sessions' | 'drop_in' | 'pass'

export type BookingSource = 'website' | 'dashboard'
export type PaymentMethod = 'free' | 'bank_transfer' | 'cash' | 'other' | 'stripe'
export type RefundKind = 'refund' | 'manual_return' | 'credit'

/** What a pass holder does to attend a class (D9): `off` = just come, `opt_in` = "I'm coming". */
export type PassSignUpMode = 'off' | 'opt_in'

export type OwnerType = 'event' | 'course'

export type PassValidity =
  | { kind: 'fixed_end'; /** 'YYYY-MM-DD' in the project time zone */ endDate: string }
  | { kind: 'duration'; months: number }

export type PassScope =
  | { kind: 'courses'; ownerPublicIds: string[] }
  | { kind: 'all_courses' }

/** The pass part of a `pass` booking option. */
export type PassOption = {
  validity: PassValidity
  scope: PassScope
  /** null / undefined = unlimited entries. */
  entriesTotal?: number | null
}

/** A sold pass (booking_passes row, the fields the domain rules need). */
export type PassEntitlement = {
  /** 'YYYY-MM-DD' inclusive, project time zone */
  validFrom: string
  /** 'YYYY-MM-DD' inclusive, project time zone */
  validTo: string
  scope: PassScope
  entriesTotal: number | null
}

export type PassWindow = { validFrom: string; validTo: string }

// ── Booking rules (D7, D9, D16.14) ───────────────────────────────────────────

export type CancelOutcome = 'refund' | 'credit' | 'none'
export type OrganiserCancelOutcome = 'notify_only' | 'credit' | 'proportional_refund'

export type BookingRules = {
  /** Participant cancels the whole booking. */
  selfCancel: { enabled: boolean; deadlineHours: number; outcome: CancelOutcome }
  /** Participant skips one session. */
  absenceNotice: { enabled: boolean; releasePlace: boolean; outcome: CancelOutcome }
  /** Organiser cancels a session. */
  organiserCancelOutcome: OrganiserCancelOutcome
  acceptBankTransfer: boolean
  holdDays: number
  cutoffHoursBeforeFirstSession: number
  passSignUp: PassSignUpMode
  /** Days before the session when pass sign-up opens. null = always open. */
  signUpOpensDaysBefore: number | null
  /** Pass holders can change their answer until this many hours before. */
  answerChangeUntilHoursBefore: number
}

type DeepPartialNullable<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartialNullable<T[K]> | null : T[K] | null
}

/** An override level: undefined / null = "use the level above". */
export type BookingRulesOverride = DeepPartialNullable<BookingRules>
