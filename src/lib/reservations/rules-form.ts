// ── Reservations — Booking rules form model (ADR-044 D7, D9, D13, D16.14/15) ──
//
// Pure (no I/O, browser-safe): the one place that maps the Booking rules
// screen to the `reservation_settings` columns and back.
//
//   stored `rules` jsonb ──resolveRules(DEFAULT_BOOKING_RULES, stored)──► effective rules
//   effective rules + localized texts + prefix ──► RulesValues (what the screen edits)
//   RulesValues ──validateRulesInput(caps, site languages)──► clean values or field errors
//   clean values ──applyRulesInput(stored rules)──► the new `rules` jsonb
//
// Capabilities (D13, super admin) decide which controls exist. A control whose
// capability is off is neither shown nor changed: its stored value is kept as it
// is, and a request that tries to switch it ON is refused (`capability_off`).
import { DEFAULT_BOOKING_RULES, resolveRules } from './rules'
import type { BookingRules, BookingRulesOverride, CancelOutcome, OrganiserCancelOutcome, PassSignUpMode } from './types'
import type { ReservationCapabilities } from '@/lib/modules/reservations/capabilities'

/** A text per site language: `{ en: '…', it: '…' }`. */
export type LocalizedText = Record<string, string>

export const CANCEL_OUTCOMES: readonly CancelOutcome[] = ['refund', 'credit', 'none']
export const ORGANISER_OUTCOMES: readonly OrganiserCancelOutcome[] = ['notify_only', 'credit', 'proportional_refund']
export const PASS_SIGN_UP_MODES: readonly PassSignUpMode[] = ['off', 'opt_in']

export const LIMITS = {
  holdDays: { min: 1, max: 30 },
  cutoffHours: { min: 0, max: 720 },
  deadlineHours: { min: 0, max: 720 },
  signUpOpensDays: { min: 1, max: 60 },
  answerChangeHours: { min: 0, max: 72 },
  referencePrefixMax: 6,
  bankDetailsChars: 600,
  paymentInstructionsChars: 1500,
  // The column checks (migration 066): length(jsonb::text).
  bankDetailsJson: 4000,
  paymentInstructionsJson: 8000,
} as const

export const REFERENCE_PREFIX_PATTERN = /^[A-Z0-9]{1,6}$/

/** What the screen edits and the save action receives (numbers are numbers; `null` = not set). */
export type RulesValues = {
  acceptBankTransfer: boolean
  holdDays: number
  cutoffHoursBeforeFirstSession: number
  /** Localized, only languages with text. `null` = nothing written. */
  bankDetails: LocalizedText | null
  paymentInstructions: LocalizedText | null
  selfCancel: { enabled: boolean; deadlineHours: number; outcome: CancelOutcome }
  absenceNotice: { enabled: boolean; releasePlace: boolean; outcome: CancelOutcome }
  organiserCancelOutcome: OrganiserCancelOutcome
  passSignUp: PassSignUpMode
  /** null = sign-up is open as soon as the session is on sale. */
  signUpOpensDaysBefore: number | null
  answerChangeUntilHoursBefore: number
  /** null = no prefix chosen (the bookings use a code made from the site). */
  referencePrefix: string | null
}

export type SettingsSnapshot = {
  rules: unknown
  bankDetails: LocalizedText | null
  paymentInstructions: LocalizedText | null
  referencePrefix: string | null
}

/** Which sections the screen shows, from the project's capabilities (D13). Never from the tenant. */
export type RulesVisibility = {
  payments: boolean
  absenceNotice: boolean
  /** The Passes section: passes are on AND the sign-up capability is `opt_in` (otherwise pass holders simply come). */
  passes: boolean
}

export function visibilityOf(caps: ReservationCapabilities): RulesVisibility {
  return {
    payments: caps.offlinePayments,
    absenceNotice: caps.absenceNotice,
    passes: caps.passes && caps.passSignUp === 'opt_in',
  }
}

export function effectiveRules(stored: unknown): BookingRules {
  const override = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as BookingRulesOverride) : null
  return resolveRules(DEFAULT_BOOKING_RULES as BookingRules, override)
}

const textsOrNull = (t: LocalizedText | null | undefined): LocalizedText | null => {
  const out: LocalizedText = {}
  for (const [k, v] of Object.entries(t ?? {})) if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  return Object.keys(out).length ? out : null
}

/** The stored settings as the screen's values (defaults where nothing is stored). */
export function valuesFromSettings(s: SettingsSnapshot): RulesValues {
  const r = effectiveRules(s.rules)
  return {
    acceptBankTransfer: r.acceptBankTransfer,
    holdDays: r.holdDays,
    cutoffHoursBeforeFirstSession: r.cutoffHoursBeforeFirstSession,
    bankDetails: textsOrNull(s.bankDetails),
    paymentInstructions: textsOrNull(s.paymentInstructions),
    selfCancel: { ...r.selfCancel },
    absenceNotice: { ...r.absenceNotice },
    organiserCancelOutcome: r.organiserCancelOutcome,
    passSignUp: r.passSignUp,
    signUpOpensDaysBefore: r.signUpOpensDaysBefore,
    answerChangeUntilHoursBefore: r.answerChangeUntilHoursBefore,
    referencePrefix: s.referencePrefix,
  }
}

export type RulesFieldError =
  | 'invalid' | 'out_of_range' | 'too_long' | 'bad_language' | 'bad_prefix' | 'capability_off'

/** Field keys the screen can attach an error to. */
export type RulesField =
  | 'holdDays' | 'cutoffHoursBeforeFirstSession' | 'bankDetails' | 'paymentInstructions' | 'acceptBankTransfer'
  | 'selfCancel.deadlineHours' | 'selfCancel.outcome' | 'absenceNotice.enabled' | 'absenceNotice.outcome'
  | 'organiserCancelOutcome' | 'passSignUp' | 'signUpOpensDaysBefore' | 'answerChangeUntilHoursBefore' | 'referencePrefix'

export type RulesErrors = Partial<Record<RulesField, RulesFieldError>>

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

function cleanTexts(
  v: unknown,
  languages: readonly string[],
  maxChars: number,
  maxJson: number,
): { ok: true; value: LocalizedText | null } | { ok: false; error: RulesFieldError } {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (!isObj(v)) return { ok: false, error: 'invalid' }
  const out: LocalizedText = {}
  for (const [lang, text] of Object.entries(v)) {
    if (typeof text !== 'string') return { ok: false, error: 'invalid' }
    const t = text.trim()
    if (!t) continue
    if (!languages.includes(lang)) return { ok: false, error: 'bad_language' }
    if (t.length > maxChars) return { ok: false, error: 'too_long' }
    out[lang] = t
  }
  if (!Object.keys(out).length) return { ok: true, value: null }
  if (JSON.stringify(out).length > maxJson) return { ok: false, error: 'too_long' }
  return { ok: true, value: out }
}

/**
 * Checks an untrusted RulesValues. Controls whose capability is off must not
 * be switched on (their other values are ignored — the stored ones stay).
 * Pure; the server runs it on every save and the screen runs it to explain a
 * disabled Save.
 */
export function validateRulesInput(
  input: unknown,
  vis: RulesVisibility,
  languages: readonly string[],
): { ok: true; value: RulesValues } | { ok: false; errors: RulesErrors } {
  const errors: RulesErrors = {}
  const i = isObj(input) ? input : {}

  // Payments (hidden entirely when offline payments are off).
  const acceptBankTransfer = i.acceptBankTransfer === true
  if (!vis.payments && acceptBankTransfer) errors.acceptBankTransfer = 'capability_off'
  if (typeof i.acceptBankTransfer !== 'boolean') errors.acceptBankTransfer = 'invalid'
  if (vis.payments) {
    if (!isInt(i.holdDays, LIMITS.holdDays.min, LIMITS.holdDays.max)) errors.holdDays = typeof i.holdDays === 'number' ? 'out_of_range' : 'invalid'
    if (!isInt(i.cutoffHoursBeforeFirstSession, LIMITS.cutoffHours.min, LIMITS.cutoffHours.max)) errors.cutoffHoursBeforeFirstSession = typeof i.cutoffHoursBeforeFirstSession === 'number' ? 'out_of_range' : 'invalid'
  }
  const bank = cleanTexts(i.bankDetails, languages, LIMITS.bankDetailsChars, LIMITS.bankDetailsJson)
  if (!bank.ok) errors.bankDetails = bank.error
  const instr = cleanTexts(i.paymentInstructions, languages, LIMITS.paymentInstructionsChars, LIMITS.paymentInstructionsJson)
  if (!instr.ok) errors.paymentInstructions = instr.error

  // Cancellations.
  const sc = isObj(i.selfCancel) ? i.selfCancel : {}
  if (typeof sc.enabled !== 'boolean') errors['selfCancel.deadlineHours'] = 'invalid'
  else if (!isInt(sc.deadlineHours, LIMITS.deadlineHours.min, LIMITS.deadlineHours.max)) errors['selfCancel.deadlineHours'] = typeof sc.deadlineHours === 'number' ? 'out_of_range' : 'invalid'
  if (!oneOf(CANCEL_OUTCOMES, sc.outcome)) errors['selfCancel.outcome'] = 'invalid'

  const an = isObj(i.absenceNotice) ? i.absenceNotice : {}
  if (an.enabled === true && !vis.absenceNotice) errors['absenceNotice.enabled'] = 'capability_off'
  else if (typeof an.enabled !== 'boolean' || typeof an.releasePlace !== 'boolean') errors['absenceNotice.enabled'] = 'invalid'
  if (!oneOf(CANCEL_OUTCOMES, an.outcome)) errors['absenceNotice.outcome'] = 'invalid'

  if (!oneOf(ORGANISER_OUTCOMES, i.organiserCancelOutcome)) errors.organiserCancelOutcome = 'invalid'

  // Passes.
  if (!oneOf(PASS_SIGN_UP_MODES, i.passSignUp)) errors.passSignUp = 'invalid'
  else if (i.passSignUp === 'opt_in' && !vis.passes) errors.passSignUp = 'capability_off'
  const opens = i.signUpOpensDaysBefore
  if (opens !== null && !isInt(opens, LIMITS.signUpOpensDays.min, LIMITS.signUpOpensDays.max)) errors.signUpOpensDaysBefore = typeof opens === 'number' ? 'out_of_range' : 'invalid'
  if (!isInt(i.answerChangeUntilHoursBefore, LIMITS.answerChangeHours.min, LIMITS.answerChangeHours.max)) errors.answerChangeUntilHoursBefore = typeof i.answerChangeUntilHoursBefore === 'number' ? 'out_of_range' : 'invalid'

  // Reference prefix.
  let prefix: string | null = null
  if (i.referencePrefix !== null && i.referencePrefix !== undefined) {
    if (typeof i.referencePrefix !== 'string') errors.referencePrefix = 'invalid'
    else {
      const p = i.referencePrefix.trim().toUpperCase()
      if (p) {
        if (REFERENCE_PREFIX_PATTERN.test(p)) prefix = p
        else errors.referencePrefix = 'bad_prefix'
      }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      acceptBankTransfer,
      holdDays: i.holdDays as number,
      cutoffHoursBeforeFirstSession: i.cutoffHoursBeforeFirstSession as number,
      bankDetails: bank.ok ? bank.value : null,
      paymentInstructions: instr.ok ? instr.value : null,
      selfCancel: { enabled: sc.enabled as boolean, deadlineHours: sc.deadlineHours as number, outcome: sc.outcome as CancelOutcome },
      absenceNotice: { enabled: an.enabled as boolean, releasePlace: an.releasePlace as boolean, outcome: an.outcome as CancelOutcome },
      organiserCancelOutcome: i.organiserCancelOutcome as OrganiserCancelOutcome,
      passSignUp: i.passSignUp as PassSignUpMode,
      signUpOpensDaysBefore: opens as number | null,
      answerChangeUntilHoursBefore: i.answerChangeUntilHoursBefore as number,
      referencePrefix: prefix,
    },
  }
}

/**
 * The new `rules` jsonb: the effective rules (stored + defaults) with the
 * values of every control the capabilities allow. Hidden controls keep what is
 * stored; unknown stored keys survive.
 */
export function applyRulesInput(stored: unknown, v: RulesValues, vis: RulesVisibility): Record<string, unknown> {
  const base = effectiveRules(stored)
  const keep = isObj(stored) ? stored : {}
  const next: BookingRules = {
    ...base,
    selfCancel: { enabled: v.selfCancel.enabled, deadlineHours: v.selfCancel.deadlineHours, outcome: v.selfCancel.outcome },
    organiserCancelOutcome: v.organiserCancelOutcome,
    absenceNotice: vis.absenceNotice ? { enabled: v.absenceNotice.enabled, releasePlace: v.absenceNotice.releasePlace, outcome: v.absenceNotice.outcome } : base.absenceNotice,
    acceptBankTransfer: vis.payments ? v.acceptBankTransfer : base.acceptBankTransfer,
    holdDays: vis.payments ? v.holdDays : base.holdDays,
    cutoffHoursBeforeFirstSession: vis.payments ? v.cutoffHoursBeforeFirstSession : base.cutoffHoursBeforeFirstSession,
    passSignUp: vis.passes ? v.passSignUp : base.passSignUp,
    signUpOpensDaysBefore: vis.passes ? v.signUpOpensDaysBefore : base.signUpOpensDaysBefore,
    answerChangeUntilHoursBefore: vis.passes ? v.answerChangeUntilHoursBefore : base.answerChangeUntilHoursBefore,
  }
  return { ...keep, ...next }
}

/**
 * Hidden controls (capability off) carry neutral values: what the screen sends
 * for a section it does not show, and what "unchanged" compares. The server
 * ignores hidden controls anyway; this keeps a stored value that was valid when
 * its capability was on (e.g. bank transfer) from blocking an unrelated save.
 */
export function neutralize(v: RulesValues, vis: RulesVisibility): RulesValues {
  const d = DEFAULT_BOOKING_RULES
  return {
    ...v,
    ...(vis.payments ? {} : { acceptBankTransfer: false, holdDays: d.holdDays, cutoffHoursBeforeFirstSession: d.cutoffHoursBeforeFirstSession }),
    ...(vis.absenceNotice ? {} : { absenceNotice: { ...d.absenceNotice } }),
    ...(vis.passes ? {} : { passSignUp: 'off' as const, signUpOpensDaysBefore: d.signUpOpensDaysBefore, answerChangeUntilHoursBefore: d.answerChangeUntilHoursBefore }),
  }
}

/** Two value sets are the same (field by field, text languages in any order). */
export function sameValues(a: RulesValues, b: RulesValues): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

function canon(v: RulesValues): unknown {
  const sorted = (t: LocalizedText | null) => (t ? Object.fromEntries(Object.entries(t).filter(([, x]) => x.trim()).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, x.trim()])) : {})
  return { ...v, bankDetails: sorted(v.bankDetails), paymentInstructions: sorted(v.paymentInstructions), referencePrefix: v.referencePrefix ?? null }
}
