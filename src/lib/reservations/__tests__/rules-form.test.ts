import { describe, expect, it } from 'vitest'
import { DEFAULT_BOOKING_RULES } from '../rules'
import { applyRulesInput, effectiveRules, neutralize, sameValues, validateRulesInput, valuesFromSettings, visibilityOf, type RulesValues, type RulesVisibility } from '../rules-form'
import { DEFAULT_RESERVATION_CAPABILITIES, resolveReservationCapabilities } from '@/lib/modules/reservations/capabilities'

const ALL_ON: RulesVisibility = { payments: true, absenceNotice: true, passes: true }
const NOTHING: RulesVisibility = { payments: false, absenceNotice: false, passes: false }
const LANGS = ['it', 'en']
const empty = { rules: {}, bankDetails: null, paymentInstructions: null, referencePrefix: null }

const base = (): RulesValues => valuesFromSettings(empty)

describe('visibilityOf (capabilities decide which sections exist)', () => {
  it('shows only payments with the default capabilities', () => {
    expect(visibilityOf(DEFAULT_RESERVATION_CAPABILITIES)).toEqual({ payments: true, absenceNotice: false, passes: false })
  })
  it('shows Passes only when passes AND the opt-in sign-up capability are on', () => {
    expect(visibilityOf(resolveReservationCapabilities({ capPasses: true })).passes).toBe(false)
    expect(visibilityOf(resolveReservationCapabilities({ capPasses: true, capPassSignUp: 'opt_in' })).passes).toBe(true)
    expect(visibilityOf(resolveReservationCapabilities({ capPasses: false, capPassSignUp: 'opt_in' })).passes).toBe(false)
  })
  it('hides payments when offline payments are off', () => {
    expect(visibilityOf(resolveReservationCapabilities({ capOfflinePayments: false })).payments).toBe(false)
  })
})

describe('valuesFromSettings / effectiveRules', () => {
  it('shows the defaults for a project with nothing saved', () => {
    const v = base()
    expect(v.acceptBankTransfer).toBe(false)
    expect(v.holdDays).toBe(DEFAULT_BOOKING_RULES.holdDays)
    expect(v.selfCancel).toEqual(DEFAULT_BOOKING_RULES.selfCancel)
    expect(v.organiserCancelOutcome).toBe('notify_only')
    expect(v.passSignUp).toBe('off')
    expect(v.signUpOpensDaysBefore).toBeNull()
    expect(v.referencePrefix).toBeNull()
  })
  it('merges a partial stored object over the defaults', () => {
    const r = effectiveRules({ holdDays: 9, selfCancel: { enabled: true } })
    expect(r.holdDays).toBe(9)
    expect(r.selfCancel).toEqual({ enabled: true, deadlineHours: 48, outcome: 'none' })
  })
  it('ignores a stored value that is not an object', () => {
    expect(effectiveRules('nope')).toEqual(DEFAULT_BOOKING_RULES)
    expect(effectiveRules([1])).toEqual(DEFAULT_BOOKING_RULES)
  })
  it('drops empty texts', () => {
    expect(valuesFromSettings({ ...empty, bankDetails: { en: '  ', it: 'IBAN' } }).bankDetails).toEqual({ it: 'IBAN' })
  })
})

describe('validateRulesInput', () => {
  it('accepts the defaults', () => {
    const r = validateRulesInput(base(), ALL_ON, LANGS)
    expect(r.ok).toBe(true)
  })
  it('rejects numbers out of range, with the field named', () => {
    const r = validateRulesInput({ ...base(), holdDays: 0, cutoffHoursBeforeFirstSession: 9999, answerChangeUntilHoursBefore: -1, signUpOpensDaysBefore: 61 }, ALL_ON, LANGS)
    expect(r).toEqual({ ok: false, errors: { holdDays: 'out_of_range', cutoffHoursBeforeFirstSession: 'out_of_range', answerChangeUntilHoursBefore: 'out_of_range', signUpOpensDaysBefore: 'out_of_range' } })
  })
  it('rejects fractions and strings as invalid', () => {
    const r = validateRulesInput({ ...base(), holdDays: '5', selfCancel: { enabled: true, deadlineHours: '48', outcome: 'refund' } }, ALL_ON, LANGS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toMatchObject({ holdDays: 'invalid', 'selfCancel.deadlineHours': 'invalid' })
  })
  it('rejects unknown outcomes and sign-up modes', () => {
    const r = validateRulesInput({ ...base(), organiserCancelOutcome: 'burn', passSignUp: 'always', selfCancel: { enabled: false, deadlineHours: 1, outcome: 'cash' } }, ALL_ON, LANGS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['organiserCancelOutcome', 'passSignUp', 'selfCancel.outcome'])
  })
  it('refuses switching ON a control whose capability is off, but allows it staying off', () => {
    const on = { ...base(), acceptBankTransfer: true, absenceNotice: { enabled: true, releasePlace: false, outcome: 'none' }, passSignUp: 'opt_in' }
    const r = validateRulesInput(on, NOTHING, LANGS)
    expect(r).toEqual({ ok: false, errors: { acceptBankTransfer: 'capability_off', 'absenceNotice.enabled': 'capability_off', passSignUp: 'capability_off' } })
    expect(validateRulesInput(base(), NOTHING, LANGS).ok).toBe(true)
  })
  it('checks the booking reference prefix (A-Z0-9, up to 6), uppercases it, and treats blank as none', () => {
    const ok = validateRulesInput({ ...base(), referencePrefix: ' cyce ' }, ALL_ON, LANGS)
    expect(ok.ok && ok.value.referencePrefix).toBe('CYCE')
    for (const bad of ['TOOLONG7', 'AB-C', 'à', 'A B']) {
      const r = validateRulesInput({ ...base(), referencePrefix: bad }, ALL_ON, LANGS)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.errors.referencePrefix).toBe('bad_prefix')
    }
    const blank = validateRulesInput({ ...base(), referencePrefix: '  ' }, ALL_ON, LANGS)
    expect(blank.ok && blank.value.referencePrefix).toBeNull()
  })
  it('accepts texts only in the site languages, trims them, and drops empty ones', () => {
    const ok = validateRulesInput({ ...base(), bankDetails: { en: ' IBAN IT00 ', it: '   ' } }, ALL_ON, LANGS)
    expect(ok.ok && ok.value.bankDetails).toEqual({ en: 'IBAN IT00' })
    const bad = validateRulesInput({ ...base(), paymentInstructions: { fr: 'x' } }, ALL_ON, LANGS)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.paymentInstructions).toBe('bad_language')
  })
  it('limits text length', () => {
    const r = validateRulesInput({ ...base(), bankDetails: { en: 'x'.repeat(601) } }, ALL_ON, LANGS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.bankDetails).toBe('too_long')
  })
  it('sign-up opens may be null (always open)', () => {
    const r = validateRulesInput({ ...base(), signUpOpensDaysBefore: null }, ALL_ON, LANGS)
    expect(r.ok).toBe(true)
  })
  it('does not trust a non-object', () => {
    expect(validateRulesInput(null, ALL_ON, LANGS).ok).toBe(false)
    expect(validateRulesInput('x', ALL_ON, LANGS).ok).toBe(false)
  })
})

describe('applyRulesInput (every control maps to the rules jsonb of rules.ts)', () => {
  const values: RulesValues = {
    ...base(),
    acceptBankTransfer: true,
    holdDays: 7,
    cutoffHoursBeforeFirstSession: 12,
    selfCancel: { enabled: true, deadlineHours: 24, outcome: 'credit' },
    absenceNotice: { enabled: true, releasePlace: true, outcome: 'refund' },
    organiserCancelOutcome: 'proportional_refund',
    passSignUp: 'opt_in',
    signUpOpensDaysBefore: 3,
    answerChangeUntilHoursBefore: 4,
  }
  it('writes each control to its key', () => {
    expect(applyRulesInput({}, values, ALL_ON)).toEqual({
      selfCancel: { enabled: true, deadlineHours: 24, outcome: 'credit' },
      absenceNotice: { enabled: true, releasePlace: true, outcome: 'refund' },
      organiserCancelOutcome: 'proportional_refund',
      acceptBankTransfer: true,
      holdDays: 7,
      cutoffHoursBeforeFirstSession: 12,
      passSignUp: 'opt_in',
      signUpOpensDaysBefore: 3,
      answerChangeUntilHoursBefore: 4,
    })
  })
  it('the result has exactly the keys of the default rules and reads back the same', () => {
    const out = applyRulesInput({}, values, ALL_ON)
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_BOOKING_RULES).sort())
    expect(valuesFromSettings({ ...empty, rules: out })).toMatchObject({ holdDays: 7, passSignUp: 'opt_in', signUpOpensDaysBefore: 3 })
  })
  it('keeps the stored value of a hidden control and any unknown stored key', () => {
    const stored = { acceptBankTransfer: true, holdDays: 11, absenceNotice: { enabled: true, releasePlace: true, outcome: 'credit' }, passSignUp: 'opt_in', futureKey: 1 }
    const out = applyRulesInput(stored, values, NOTHING)
    expect(out).toMatchObject({ acceptBankTransfer: true, holdDays: 11, absenceNotice: { enabled: true, releasePlace: true, outcome: 'credit' }, passSignUp: 'opt_in', futureKey: 1 })
    expect(out.selfCancel).toEqual({ enabled: true, deadlineHours: 24, outcome: 'credit' })
  })
  it('null sign-up opens ("always open") is stored as null', () => {
    expect(applyRulesInput({ signUpOpensDaysBefore: 5 }, { ...values, signUpOpensDaysBefore: null }, ALL_ON).signUpOpensDaysBefore).toBeNull()
  })
})

describe('neutralize / sameValues', () => {
  it('replaces hidden controls with neutral values', () => {
    const v = { ...base(), acceptBankTransfer: true, passSignUp: 'opt_in' as const }
    const n = neutralize(v, NOTHING)
    expect(n.acceptBankTransfer).toBe(false)
    expect(n.passSignUp).toBe('off')
  })
  it('compares texts without caring about order or spaces', () => {
    const a = { ...base(), bankDetails: { en: 'a ', it: 'b' } }
    const b = { ...base(), bankDetails: { it: 'b', en: 'a' } }
    expect(sameValues(a, b)).toBe(true)
    expect(sameValues(a, { ...b, holdDays: 3 })).toBe(false)
  })
})
