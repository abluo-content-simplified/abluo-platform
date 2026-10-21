import { describe, expect, it } from 'vitest'
import { localOf, resolveSessionTimes } from '../time'
import { ScheduleError } from '../types'

// 2026 European DST: clocks go forward Sun 29 March (01:00 UTC), back Sun 25 October (01:00 UTC).
describe('resolveSessionTimes — local time + zone is the truth (ADR-038 D3)', () => {
  it('converts an ordinary session in each site zone', () => {
    expect(resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', endLocal: '2026-10-24T12:30' }))
      .toMatchObject({ startsAt: '2026-10-24T08:00:00.000Z', endsAt: '2026-10-24T10:30:00.000Z', startResolution: 'exact' })
    expect(resolveSessionTimes({ timeZone: 'Europe/London', startLocal: '2026-06-24T14:00' }))
      .toMatchObject({ startsAt: '2026-06-24T13:00:00.000Z', endsAt: null, endLocal: null })
    expect(resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-12-01T18:00' }).startsAt).toBe('2026-12-01T17:00:00.000Z')
  })

  it('the same wall-clock time keeps its local hour across the DST change (weekly 18:00)', () => {
    const before = resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-10-19T18:00' })
    const after = resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-10-26T18:00' })
    expect(before.startsAt).toBe('2026-10-19T16:00:00.000Z') // CEST, UTC+2
    expect(after.startsAt).toBe('2026-10-26T17:00:00.000Z') // CET, UTC+1
    expect([before.startLocal, after.startLocal]).toEqual(['2026-10-19T18:00', '2026-10-26T18:00'])
  })

  it('spring-forward gap: a time that never happens moves to the first valid minute, and the stored local time says so', () => {
    const r = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-03-29T02:30' })
    expect(r).toMatchObject({ startResolution: 'gap', startLocal: '2026-03-29T03:00', startsAt: '2026-03-29T01:00:00.000Z' })
    const london = resolveSessionTimes({ timeZone: 'Europe/London', startLocal: '2026-03-29T01:30' })
    expect(london).toMatchObject({ startResolution: 'gap', startLocal: '2026-03-29T02:00', startsAt: '2026-03-29T01:00:00.000Z' })
  })

  it('autumn overlap: a time that happens twice takes the first occurrence', () => {
    const r = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-25T02:30' })
    expect(r).toMatchObject({ startResolution: 'overlap', startLocal: '2026-10-25T02:30', startsAt: '2026-10-25T00:30:00.000Z' })
  })

  it('a session across the DST night keeps its wall-clock end (01:00–04:00 lasts four real hours)', () => {
    const r = resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-10-25T01:00', endLocal: '2026-10-25T04:00' })
    expect(r.startsAt).toBe('2026-10-24T23:00:00.000Z')
    expect(r.endsAt).toBe('2026-10-25T03:00:00.000Z')
    expect((Date.parse(r.endsAt!) - Date.parse(r.startsAt)) / 3_600_000).toBe(4)
  })

  it('sessions across midnight and multi-day events', () => {
    expect(resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-11-07T22:00', endLocal: '2026-11-08T01:00' }).endsAt).toBe('2026-11-08T00:00:00.000Z')
    expect(resolveSessionTimes({ timeZone: 'Europe/London', startLocal: '2026-04-12T08:00', endLocal: '2026-04-14T19:00' }).endsAt).toBe('2026-04-14T18:00:00.000Z')
  })

  it('a venue in another zone uses its own zone', () => {
    const london = resolveSessionTimes({ timeZone: 'Europe/London', startLocal: '2026-11-03T19:00' })
    const rome = resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-11-03T19:00' })
    expect(Date.parse(london.startsAt) - Date.parse(rome.startsAt)).toBe(3_600_000)
  })

  it('accepts the database spelling of a local time', () => {
    expect(resolveSessionTimes({ timeZone: 'Europe/Rome', startLocal: '2026-12-01 18:00:00' }).startLocal).toBe('2026-12-01T18:00')
  })

  it('refuses an unknown zone, a malformed or impossible date, and an end before the start', () => {
    const bad = (i: Parameters<typeof resolveSessionTimes>[0]) => expect(() => resolveSessionTimes(i)).toThrow(ScheduleError)
    bad({ timeZone: 'Mars/Olympus', startLocal: '2026-12-01T18:00' })
    bad({ timeZone: 'Europe/Rome', startLocal: 'tomorrow' })
    bad({ timeZone: 'Europe/Rome', startLocal: '2026-02-30T18:00' })
    bad({ timeZone: 'Europe/Rome', startLocal: '2026-12-01T18:00', endLocal: '2026-12-01T17:00' })
    bad({ timeZone: 'Europe/Rome', startLocal: '2026-12-01T18:00', endLocal: 'later' })
  })

  it('localOf gives the wall-clock time of a stored instant (legacy migration)', () => {
    expect(localOf('2026-10-24T08:00:00.000Z', 'Europe/Brussels')).toBe('2026-10-24T10:00')
    expect(localOf('2026-06-24T13:00:00.000Z', 'Europe/London')).toBe('2026-06-24T14:00')
  })
})
