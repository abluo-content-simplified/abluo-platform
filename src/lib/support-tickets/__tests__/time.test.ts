import { describe, expect, it } from 'vitest'
import { formatLastUpdate } from '../time'

const labels = { today: 'Today', yesterday: 'Yesterday' }
const now = new Date('2026-10-23T12:00:00Z')
const f = (iso: string | null, timeZone = 'Europe/Rome', locale = 'en-GB') => formatLastUpdate(iso, { locale, labels, now, timeZone })

describe('formatLastUpdate', () => {
  it('says Today with the time in the given zone', () => {
    expect(f('2026-10-23T08:42:00Z')).toBe('Today, 10:42')
  })
  it('says Yesterday', () => {
    expect(f('2026-10-22T14:05:00Z')).toBe('Yesterday, 16:05')
  })
  it('uses day, short month and time for older dates', () => {
    expect(f('2026-10-21T14:05:00Z')).toBe('21 Oct, 16:05')
  })
  it('adds the year when it is not this year', () => {
    expect(f('2025-12-31T14:05:00Z')).toBe('31 Dec 2025, 15:05')
  })
  it('judges the day in the viewer zone, not UTC', () => {
    // 23:30 UTC on the 22nd is already the 23rd in Rome (CEST).
    expect(f('2026-10-22T23:30:00Z')).toBe('Today, 01:30')
    expect(f('2026-10-22T23:30:00Z', 'UTC')).toBe('Yesterday, 23:30')
  })
  it('keeps midnight as 00:xx (24-hour)', () => {
    expect(f('2026-10-22T22:05:00Z')).toBe('Today, 00:05')
  })
  it('translates through the locale and the passed labels', () => {
    expect(formatLastUpdate('2026-10-21T14:05:00Z', { locale: 'it', labels: { today: 'Oggi', yesterday: 'Ieri' }, now, timeZone: 'Europe/Rome' })).toBe('21 ott, 16:05')
    expect(formatLastUpdate('2026-10-22T14:05:00Z', { locale: 'de', labels: { today: 'Heute', yesterday: 'Gestern' }, now, timeZone: 'Europe/Rome' })).toBe('Gestern, 16:05')
  })
  it('returns an empty string for nothing or garbage', () => {
    expect(f(null)).toBe('')
    expect(f('nope')).toBe('')
  })
})
