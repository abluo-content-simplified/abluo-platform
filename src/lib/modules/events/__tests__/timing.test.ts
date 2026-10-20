import { describe, expect, it } from 'vitest'
import { eventTiming } from '../timing'

const NOW = new Date('2026-10-20T12:00:00Z')

describe('eventTiming — from the dates, legacy status ignored except a manual live', () => {
  it('future start → upcoming, whatever a stale legacy status says', () => {
    expect(eventTiming({ startDate: '2026-10-24T08:00:00Z' }, NOW)).toBe('upcoming')
    expect(eventTiming({ status: 'past', startDate: '2026-10-24T08:00:00Z' }, NOW)).toBe('upcoming')
  })
  it('ended → past, even if the legacy status still says upcoming', () => {
    expect(eventTiming({ status: 'upcoming', startDate: '2026-10-09T15:30:00Z', endDate: '2026-10-09T18:00:00Z' }, NOW)).toBe('past')
  })
  it('no end date: past once the start has passed', () => {
    expect(eventTiming({ status: 'upcoming', startDate: '2026-06-24T13:18:00Z' }, NOW)).toBe('past')
  })
  it('ongoing (started, not ended) stays upcoming — "live" is only ever set by Abluo', () => {
    expect(eventTiming({ startDate: '2026-10-20T10:00:00Z', endDate: '2026-10-20T14:00:00Z' }, NOW)).toBe('upcoming')
  })
  it('manual live stays live until the end date, then becomes past', () => {
    expect(eventTiming({ status: 'live', startDate: '2026-10-20T10:00:00Z', endDate: '2026-10-20T14:00:00Z' }, NOW)).toBe('live')
    expect(eventTiming({ status: 'live', startDate: '2026-10-19T10:00:00Z', endDate: '2026-10-19T14:00:00Z' }, NOW)).toBe('past')
    expect(eventTiming({ status: 'live', startDate: '2026-10-19T10:00:00Z' }, NOW)).toBe('live')
  })
  it('no dates at all → upcoming (never hidden as past)', () => {
    expect(eventTiming({}, NOW)).toBe('upcoming')
  })
})
