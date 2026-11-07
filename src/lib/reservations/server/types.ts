// ── Reservations — server-side row types (ADR-044 D2, migration 066) ─────────
// What the adapter returns. Camel-cased, parsed from snake_case rows; the
// booking-rule shapes come from the pure domain layer.
import type {
  BookingRulesOverride, BookingSource, BookingStatus, OptionKind, OwnerType, PaymentStatus,
} from '../types'

export type Actor = { kind: 'user' | 'participant' | 'system' | 'support'; id?: string | null }

export type LocalizedText = Record<string, string>

export type ReservationSettingsRow = {
  projectId: string
  /** The project-level override as stored; merge with defaults via rules.ts. */
  rules: BookingRulesOverride
  bankDetails: LocalizedText | null
  paymentInstructions: LocalizedText | null
  termsNote: LocalizedText | null
  referencePrefix: string | null
  supportAccessUntil: string | null
  version: number
}

export type TargetOwnerType = OwnerType | 'project'

export type ReservableTargetRow = {
  id: string
  projectId: string
  ownerType: TargetOwnerType
  ownerPublicId: string | null
  editionId: string | null
  registrationStatus: 'closed' | 'open'
  opensAt: string | null
  closesAt: string | null
  minParticipants: number | null
  minDecisionAt: string | null
  defaultPlaces: number | null
  maxPasses: number | null
  includeNewSessions: boolean
  rulesOverride: BookingRulesOverride | null
  version: number
}

export type OptionPriceRow = {
  id: string
  optionId: string
  priceCategoryId: string | null
  amountCents: number
  currency: 'EUR'
  validFrom: string | null
}

export type BookingOptionRow = {
  id: string
  projectId: string
  targetId: string
  kind: OptionKind
  label: LocalizedText
  description: LocalizedText | null
  status: 'draft' | 'active' | 'archived'
  sessionIds: string[] | null
  passScope: 'target' | 'courses' | 'all_courses' | null
  passScopeOwnerIds: string[] | null
  passValidity: 'fixed_end' | 'duration' | null
  passValidTo: string | null
  passDurationMonths: number | null
  passEntries: number | null
  requiresMembership: boolean
  minAge: number | null
  maxAge: number | null
  sort: number
  prices: OptionPriceRow[]
}

export type BookingRow = {
  id: string
  projectId: string
  targetId: string
  optionId: string | null
  reference: string
  status: BookingStatus
  paymentStatus: PaymentStatus
  paymentReview: boolean
  eligibilityReview: boolean
  locale: string
  source: BookingSource
  purchaserName: string | null
  purchaserEmail: string | null
  purchaserPhone: string | null
  totalCents: number
  snapshot: Record<string, unknown>
  holdExpiresAt: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  anonymisedAt: string | null
  version: number
  createdAt: string
}

export type PassRow = {
  id: string
  projectId: string
  bookingId: string
  attendeeId: string
  optionId: string
  targetId: string
  scope: 'target' | 'courses' | 'all_courses'
  scopeOwnerIds: string[] | null
  validFrom: string
  validTo: string
  entriesTotal: number | null
  status: 'active' | 'cancelled'
  anonymisedAt: string | null
  version: number
}

export type SessionAvailability = {
  occurrenceId: string
  /** null = unlimited (or no place row yet and no default given). */
  places: number | null
  /** Active allocations, counted like reservations_active_count(). */
  active: number
}

// ── Results of the write functions ───────────────────────────────────────────
export type BookResult = { bookingId: string; reference: string; replayed: boolean }
export type PassAttendResult = { allocationId: string; replayed: boolean }
export type PassWithdrawResult = { released: boolean; entryReturned: boolean }
export type ReleaseResult = { released: number; cancelled: boolean }
/** `confirmed: false` + `full` = lapsed holds could not come back (booking flagged payment_review). */
export type ConfirmResult = { confirmed: boolean; replayed: boolean; full: string[] }
export type RecordPaymentResult = { paymentId: string; paymentStatus: PaymentStatus; confirm: ConfirmResult | null }
export type SetPlacesResult = { capacityId: string; places: number | null; active: number }
export type ExpiredHold = { bookingId: string; projectId: string }
export type LinkAttemptResult = { allowed: boolean; attemptId: number | null; retryAfterSeconds: number }
