import { describe, expect, it } from 'vitest'
import { parseReservationError, reservationCodeOf } from '../errors'

describe('parseReservationError', () => {
  it('AB409 full carries the full occurrence ids from DETAIL', () => {
    const e = parseReservationError({ code: 'AB409', message: 'reservations: full', details: '["a","b"]' })
    expect(e).toEqual({ kind: 'full', occurrenceIds: ['a', 'b'] })
  })
  it('AB409 full with unreadable detail still maps to full', () => {
    expect(parseReservationError({ code: 'AB409', message: 'reservations: full', details: 'nope' })).toEqual({ kind: 'full', occurrenceIds: [] })
    expect(parseReservationError({ code: 'AB409', message: 'reservations: full' })).toEqual({ kind: 'full', occurrenceIds: [] })
  })
  it('AB409 other codes are conflicts (detail kept)', () => {
    expect(parseReservationError({ code: 'AB409', message: 'reservations: reference_taken' })).toEqual({ kind: 'conflict', code: 'reference_taken' })
    expect(parseReservationError({ code: 'AB409', message: 'reservations: places_below_active', details: '5' })).toEqual({
      kind: 'conflict', code: 'places_below_active', detail: '5',
    })
    expect(parseReservationError({ code: '40001', message: 'serialization' })).toEqual({ kind: 'conflict', code: 'changed' })
  })
  it('AB422 is refused with the code', () => {
    expect(parseReservationError({ code: 'AB422', message: 'reservations: registration_closed' })).toEqual({ kind: 'refused', code: 'registration_closed' })
    expect(parseReservationError({ code: 'AB422', message: 'reservations: session_not_bookable', details: '{"occurrence_id":"x"}' })).toMatchObject({
      kind: 'refused', code: 'session_not_bookable', detail: '{"occurrence_id":"x"}',
    })
  })
  it('P0002 is not_found', () => {
    expect(parseReservationError({ code: 'P0002', message: 'reservations: booking_not_found' })).toEqual({ kind: 'not_found', code: 'booking_not_found' })
  })
  it('missing function / table (066 not applied) is unavailable', () => {
    for (const code of ['PGRST202', 'PGRST205', '42P01', '42883']) {
      expect(parseReservationError({ code, message: 'Could not find the function' })).toEqual({ kind: 'unavailable' })
    }
  })
  it('malformed input is refused; anything unknown is unavailable', () => {
    expect(parseReservationError({ code: '23514', message: 'check' })).toEqual({ kind: 'refused', code: 'invalid' })
    expect(parseReservationError({ code: '08006', message: 'connection' })).toEqual({ kind: 'unavailable' })
    expect(parseReservationError(null)).toEqual({ kind: 'unavailable' })
  })
  it('reservationCodeOf', () => {
    expect(reservationCodeOf('reservations: no_entries_left')).toBe('no_entries_left')
    expect(reservationCodeOf('boom')).toBe('unknown')
    expect(reservationCodeOf(undefined)).toBe('unknown')
  })
})
