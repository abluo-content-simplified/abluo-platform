import { describe, expect, it } from 'vitest'
import { holdExpiresAt, isHoldActive } from '../holds'

const booked = new Date('2026-11-10T10:00:00Z')

describe('holdExpiresAt', () => {
  it('is booking + hold days when nothing is earlier', () => {
    expect(holdExpiresAt({ bookedAt: booked, holdDays: 5, cutoffHours: 24 }).toISOString()).toBe('2026-11-15T10:00:00.000Z')
  })
  it('registration close wins when earlier', () => {
    const r = holdExpiresAt({ bookedAt: booked, holdDays: 5, cutoffHours: 24, registrationClosesAt: new Date('2026-11-12T00:00:00Z') })
    expect(r.toISOString()).toBe('2026-11-12T00:00:00.000Z')
  })
  it('first session minus cutoff wins when earlier', () => {
    const r = holdExpiresAt({ bookedAt: booked, holdDays: 5, cutoffHours: 24, firstSessionStartsAt: new Date('2026-11-12T18:00:00Z') })
    expect(r.toISOString()).toBe('2026-11-11T18:00:00.000Z')
  })
  it('null optional dates are ignored', () => {
    const r = holdExpiresAt({ bookedAt: booked, holdDays: 1, cutoffHours: 0, registrationClosesAt: null, firstSessionStartsAt: null })
    expect(r.toISOString()).toBe('2026-11-11T10:00:00.000Z')
  })
  it('can already be in the past (session very soon)', () => {
    const r = holdExpiresAt({ bookedAt: booked, holdDays: 5, cutoffHours: 48, firstSessionStartsAt: new Date('2026-11-11T10:00:00Z') })
    expect(r.getTime()).toBeLessThan(booked.getTime())
  })
  it('zero hold days expires immediately', () => {
    expect(holdExpiresAt({ bookedAt: booked, holdDays: 0, cutoffHours: 0 }).getTime()).toBe(booked.getTime())
  })
  it('does not mutate inputs and rejects bad input', () => {
    const copy = booked.getTime()
    holdExpiresAt({ bookedAt: booked, holdDays: 2, cutoffHours: 1 })
    expect(booked.getTime()).toBe(copy)
    expect(() => holdExpiresAt({ bookedAt: new Date('x'), holdDays: 2, cutoffHours: 1 })).toThrow()
    expect(() => holdExpiresAt({ bookedAt: booked, holdDays: -1, cutoffHours: 1 })).toThrow()
  })
})

describe('isHoldActive', () => {
  it('is active strictly before expiry', () => {
    const e = new Date('2026-11-15T10:00:00Z')
    expect(isHoldActive(e, new Date('2026-11-15T09:59:59.999Z'))).toBe(true)
    expect(isHoldActive(e, e)).toBe(false)
    expect(isHoldActive(null, e)).toBe(true)
  })
})
