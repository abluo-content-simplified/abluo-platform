// ── Booking rules screen — form state ↔ RulesValues (ADR-044 D7, D9) ──────────
// The inputs hold text; this turns them into the numbers the action takes and
// back. Unreadable numbers become -1 so the shared validator reports them as
// out of range with the same sentence, whatever was typed.
import { LIMITS, neutralize, sameValues, valuesFromSettings, validateRulesInput, type RulesErrors, type RulesValues, type RulesVisibility } from '@/lib/reservations/rules-form'
import type { LocalizedText } from '@/lib/reservations/rules-form'
import type { CancelOutcome, OrganiserCancelOutcome, PassSignUpMode } from '@/lib/reservations/types'

export type RulesForm = {
  acceptBankTransfer: boolean
  holdDays: string
  cutoffHours: string
  bankDetails: LocalizedText
  paymentInstructions: LocalizedText
  selfCancelEnabled: boolean
  selfCancelDeadline: string
  selfCancelOutcome: CancelOutcome
  absenceEnabled: boolean
  absenceReleasePlace: boolean
  absenceOutcome: CancelOutcome
  organiserOutcome: OrganiserCancelOutcome
  passSignUp: PassSignUpMode
  /** '' = open as soon as the session is on sale. */
  signUpOpens: string
  answerChangeHours: string
  referencePrefix: string
}

export function formFromValues(v: RulesValues): RulesForm {
  return {
    acceptBankTransfer: v.acceptBankTransfer,
    holdDays: String(v.holdDays),
    cutoffHours: String(v.cutoffHoursBeforeFirstSession),
    bankDetails: { ...(v.bankDetails ?? {}) },
    paymentInstructions: { ...(v.paymentInstructions ?? {}) },
    selfCancelEnabled: v.selfCancel.enabled,
    selfCancelDeadline: String(v.selfCancel.deadlineHours),
    selfCancelOutcome: v.selfCancel.outcome,
    absenceEnabled: v.absenceNotice.enabled,
    absenceReleasePlace: v.absenceNotice.releasePlace,
    absenceOutcome: v.absenceNotice.outcome,
    organiserOutcome: v.organiserCancelOutcome,
    passSignUp: v.passSignUp,
    signUpOpens: v.signUpOpensDaysBefore === null ? '' : String(v.signUpOpensDaysBefore),
    answerChangeHours: String(v.answerChangeUntilHoursBefore),
    referencePrefix: v.referencePrefix ?? '',
  }
}

const int = (s: string): number => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : -1)

export function valuesFromForm(f: RulesForm, vis: RulesVisibility): RulesValues {
  const opens = f.signUpOpens.trim()
  return neutralize({
    acceptBankTransfer: f.acceptBankTransfer,
    holdDays: int(f.holdDays),
    cutoffHoursBeforeFirstSession: int(f.cutoffHours),
    bankDetails: f.bankDetails,
    paymentInstructions: f.paymentInstructions,
    selfCancel: { enabled: f.selfCancelEnabled, deadlineHours: int(f.selfCancelDeadline), outcome: f.selfCancelOutcome },
    absenceNotice: { enabled: f.absenceEnabled, releasePlace: f.absenceReleasePlace, outcome: f.absenceOutcome },
    organiserCancelOutcome: f.organiserOutcome,
    passSignUp: f.passSignUp,
    signUpOpensDaysBefore: opens === '' ? null : int(opens),
    answerChangeUntilHoursBefore: int(f.answerChangeHours),
    referencePrefix: f.referencePrefix.trim() === '' ? null : f.referencePrefix.trim(),
  }, vis)
}

/** Same shape as the stored values (the "nothing changed" check). */
export function isUnchanged(form: RulesForm, saved: RulesValues, vis: RulesVisibility): boolean {
  const now = valuesFromForm(form, vis)
  return sameValues({ ...now, referencePrefix: now.referencePrefix?.toUpperCase() ?? null }, neutralize(saved, vis))
}

/** Field errors the screen shows before anything is sent (the server runs the same check). */
export function errorsOf(form: RulesForm, vis: RulesVisibility, languages: readonly string[]): RulesErrors {
  const r = validateRulesInput(valuesFromForm(form, vis), vis, languages)
  return r.ok ? {} : r.errors
}

export { LIMITS, valuesFromSettings }
