// ── Reservations — Booking rules resolution (ADR-044 D7, D9, D16.14) ─────────
//
// project default → target override → session override. In an override,
// undefined and null both mean "use the level above". (So a nullable value such
// as signUpOpensDaysBefore cannot be re-set to "always open" by an override;
// that is a project-level choice.)
import {
  ReservationError,
  type BookingRules,
  type BookingRulesOverride,
  type PassSignUpMode,
} from './types'

export const DEFAULT_BOOKING_RULES: Readonly<BookingRules> = Object.freeze({
  selfCancel: { enabled: false, deadlineHours: 48, outcome: 'none' },
  absenceNotice: { enabled: false, releasePlace: false, outcome: 'none' },
  organiserCancelOutcome: 'notify_only',
  acceptBankTransfer: false,
  holdDays: 5,
  cutoffHoursBeforeFirstSession: 24,
  passSignUp: 'off',
  signUpOpensDaysBefore: null,
  answerChangeUntilHoursBefore: 2,
} as BookingRules)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mergeLevel(base: Record<string, unknown>, override: unknown): Record<string, unknown> {
  if (!isPlainObject(override)) return base
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    const o = override[key]
    if (o === undefined || o === null) continue
    const b = base[key]
    out[key] = isPlainObject(b) ? mergeLevel(b, o) : o
  }
  return out
}

/** Resolves the rules that apply to one session. Inputs are never mutated. */
export function resolveRules(
  projectDefaults: BookingRules,
  targetOverride?: BookingRulesOverride | null,
  sessionOverride?: BookingRulesOverride | null,
): BookingRules {
  const level1 = mergeLevel(projectDefaults as unknown as Record<string, unknown>, targetOverride)
  const level2 = mergeLevel(level1, sessionOverride)
  return level2 as unknown as BookingRules
}

/**
 * Limited places need a way to know who is coming (D9): places is a number and
 * pass sign-up is 'off' → 'sign_up_required_when_limited'. null / undefined
 * places = unlimited, always fine. Returns the error code or null.
 */
export function validateAttendanceConfig(
  places: number | null | undefined,
  passSignUp: PassSignUpMode,
): 'sign_up_required_when_limited' | null {
  if (typeof places === 'number' && passSignUp === 'off') return 'sign_up_required_when_limited'
  return null
}

export function assertAttendanceConfig(places: number | null | undefined, passSignUp: PassSignUpMode): void {
  const code = validateAttendanceConfig(places, passSignUp)
  if (code) throw new ReservationError(code)
}
