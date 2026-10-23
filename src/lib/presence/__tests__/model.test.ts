import { describe, expect, it } from 'vitest'
import { ACTIVE_NOW_MS, isActiveNow, lastActiveAt } from '../model'

const NOW = Date.parse('2026-10-23T12:00:00Z')

describe('presence model (ADR-030 A1)', () => {
  it('last active is the later of heartbeat and sign-in', () => {
    expect(lastActiveAt('2026-10-23T11:00:00Z', '2026-10-20T09:00:00Z')).toBe('2026-10-23T11:00:00Z')
    expect(lastActiveAt('2026-10-20T09:00:00Z', '2026-10-23T11:00:00Z')).toBe('2026-10-23T11:00:00Z')
    expect(lastActiveAt(null, '2026-10-23T11:00:00Z')).toBe('2026-10-23T11:00:00Z')
    expect(lastActiveAt(null, null)).toBeNull()
  })
  it('active now only within the window', () => {
    expect(isActiveNow(new Date(NOW - 60_000).toISOString(), NOW)).toBe(true)
    expect(isActiveNow(new Date(NOW - ACTIVE_NOW_MS - 1000).toISOString(), NOW)).toBe(false)
    expect(isActiveNow(null, NOW)).toBe(false)
  })
})
