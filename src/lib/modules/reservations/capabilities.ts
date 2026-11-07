// ── Reservations module — project capabilities (ADR-044 D13) ─────────────────
//
// WHAT one project's bookings can use. Configured by Abluo in
// Studio → Modules → Reservations (one setting per capability). The tenant
// fills in the VALUES in dashboard → Bookings → Booking rules (ADR-014: one
// surface per concept; the tenant's `reservation_settings` are not module config).
//
// Three concerns, never mixed: configuration (this file) · permissions
// (ADR-028, `reservations.*`) · presentation (sections — not built yet).
//
// Rules (same as Events capabilities):
//   - Defaults are the plainest booking set-up (offline payments, nothing else).
//   - Switching a capability off hides it and makes the server refuse new use of
//     it. Stored bookings, passes and prices are never deleted or changed.
//   - `stripe` and `reminders` are fixed off here: Stripe is a later phase, and
//     reminders stay locked until Pro (D13, D10). They are NOT config fields, so
//     no admin can switch them on by accident.
//   - Pure: no I/O, importable from Studio, server, dashboard and tests.

export type PassSignUpCapability = 'off' | 'opt_in'

export type ReservationCapabilities = {
  /** Bank transfer / cash: the organiser confirms payment by hand. */
  offlinePayments: boolean
  /** Member / non-member and other price categories (tenant manages them in Booking rules). */
  priceCategories: boolean
  /** Passes (a right to attend, ADR-044 D9). Everything below only applies when this is on. */
  passes: boolean
  /** Passes with a number of entries (10-class card). */
  passEntries: boolean
  /** Passes valid until a fixed date (e.g. 31 Dec), priced by joining date. */
  passFixedEnd: boolean
  /** Passes valid for a duration from the start date (1 / 6 / 12 months …). */
  passDuration: boolean
  /** off = pass holders just come; opt_in = they can also answer "I'm coming". */
  passSignUp: PassSignUpCapability
  /** An option can require membership (self-declared until the Memberships module). */
  membershipRequirement: boolean
  /** Attendees can tell the organiser they cannot come (absence notice). */
  absenceNotice: boolean
  /** A minimum number of participants per target. */
  minimumParticipants: boolean
  /** Reminder emails. Locked off until Pro (D13). */
  reminders: false
  /** Online payment through Stripe. Locked off (later phase). */
  stripe: false
}

export const DEFAULT_RESERVATION_CAPABILITIES: ReservationCapabilities = Object.freeze({
  offlinePayments: true,
  priceCategories: false,
  passes: false,
  passEntries: false,
  passFixedEnd: false,
  passDuration: false,
  passSignUp: 'off',
  membershipRequirement: false,
  absenceNotice: false,
  minimumParticipants: false,
  reminders: false,
  stripe: false,
}) as ReservationCapabilities

/** The manifest config field ids that hold the capabilities (registry.ts → reservations). */
export const RESERVATION_CAPABILITY_CONFIG_IDS = [
  'capOfflinePayments',
  'capPriceCategories',
  'capPasses',
  'capPassEntries',
  'capPassFixedEnd',
  'capPassDuration',
  'capPassSignUp',
  'capMembershipRequirement',
  'capAbsenceNotice',
  'capMinimumParticipants',
] as const

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/** The project's capabilities from its stored Reservations config; anything missing or invalid → the default. */
export function resolveReservationCapabilities(config: Record<string, unknown> | null | undefined): ReservationCapabilities {
  const c = config ?? {}
  const d = DEFAULT_RESERVATION_CAPABILITIES
  const passes = bool(c.capPasses, d.passes)
  return {
    offlinePayments: bool(c.capOfflinePayments, d.offlinePayments),
    priceCategories: bool(c.capPriceCategories, d.priceCategories),
    passes,
    // Pass sub-capabilities mean nothing without passes.
    passEntries: passes && bool(c.capPassEntries, d.passEntries),
    passFixedEnd: passes && bool(c.capPassFixedEnd, d.passFixedEnd),
    passDuration: passes && bool(c.capPassDuration, d.passDuration),
    passSignUp: passes && c.capPassSignUp === 'opt_in' ? 'opt_in' : 'off',
    membershipRequirement: bool(c.capMembershipRequirement, d.membershipRequirement),
    absenceNotice: bool(c.capAbsenceNotice, d.absenceNotice),
    minimumParticipants: bool(c.capMinimumParticipants, d.minimumParticipants),
    reminders: false,
    stripe: false,
  }
}
