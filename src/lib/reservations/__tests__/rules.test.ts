import { describe, expect, it } from 'vitest'
import { DEFAULT_BOOKING_RULES, assertAttendanceConfig, resolveRules, validateAttendanceConfig } from '../rules'
import { ReservationError } from '../types'

const base = { ...DEFAULT_BOOKING_RULES, holdDays: 7, selfCancel: { enabled: true, deadlineHours: 72, outcome: 'refund' as const } }

describe('resolveRules', () => {
  it('returns the project defaults without overrides', () => {
    expect(resolveRules(base)).toEqual(base)
    expect(resolveRules(base, null, null)).toEqual(base)
  })
  it('defaults match the ADR', () => {
    expect(DEFAULT_BOOKING_RULES.holdDays).toBe(5)
    expect(DEFAULT_BOOKING_RULES.organiserCancelOutcome).toBe('notify_only')
  })
  it('target overrides project, session overrides target', () => {
    const r = resolveRules(base, { holdDays: 3, passSignUp: 'opt_in' }, { holdDays: 1 })
    expect(r.holdDays).toBe(1)
    expect(r.passSignUp).toBe('opt_in')
  })
  it('null and undefined mean "use the level above"', () => {
    const r = resolveRules(base, { holdDays: 3 }, { holdDays: null, passSignUp: undefined })
    expect(r.holdDays).toBe(3)
    expect(r.passSignUp).toBe('off')
  })
  it('falsy-but-real overrides win (0, false)', () => {
    const r = resolveRules(base, { holdDays: 0, acceptBankTransfer: false }, { selfCancel: { enabled: false } })
    expect(r.holdDays).toBe(0)
    expect(r.selfCancel.enabled).toBe(false)
  })
  it('merges nested groups field by field', () => {
    const r = resolveRules(base, { selfCancel: { deadlineHours: 0 } }, { selfCancel: { outcome: null } })
    expect(r.selfCancel).toEqual({ enabled: true, deadlineHours: 0, outcome: 'refund' })
  })
  it('a null nested group is ignored', () => {
    expect(resolveRules(base, { selfCancel: null }).selfCancel).toEqual(base.selfCancel)
  })
  it('does not mutate inputs', () => {
    const copy = JSON.parse(JSON.stringify(base))
    resolveRules(base, { selfCancel: { enabled: false } })
    expect(base).toEqual(copy)
  })
  it('ignores unknown override keys', () => {
    const r = resolveRules(base, { bogus: 1 } as never)
    expect(r).toEqual(base)
  })
})

describe('validateAttendanceConfig', () => {
  it('limited places need pass sign-up', () => {
    expect(validateAttendanceConfig(10, 'off')).toBe('sign_up_required_when_limited')
    expect(validateAttendanceConfig(0, 'off')).toBe('sign_up_required_when_limited')
    expect(validateAttendanceConfig(10, 'opt_in')).toBeNull()
  })
  it('unlimited places are fine either way', () => {
    expect(validateAttendanceConfig(null, 'off')).toBeNull()
    expect(validateAttendanceConfig(undefined, 'off')).toBeNull()
    expect(validateAttendanceConfig(null, 'opt_in')).toBeNull()
  })
  it('assert throws a coded error', () => {
    expect(() => assertAttendanceConfig(5, 'off')).toThrowError(ReservationError)
    try { assertAttendanceConfig(5, 'off') } catch (e) { expect((e as ReservationError).code).toBe('sign_up_required_when_limited') }
    expect(() => assertAttendanceConfig(5, 'opt_in')).not.toThrow()
  })
})
