/**
 * C5a — rule/schedule reading, profiles, validation, and the "available now"
 * cache contract proven at the resolver level (boundary fixtures B-1…B-7,
 * C5a-4): an injected clock and a cache adapter whose page TTL is 1 hour.
 */
import { describe, expect, it } from 'vitest'
import {
  AvailabilityTimeZoneError,
  availableSometime,
  evaluateRule,
  nextAvailabilityTransition,
  readChannelRule,
  readSchedule,
  scheduleIssues,
  weekProfile,
  type AvailableNow,
} from '../availability-schedule'
import { availableNow, type AvailabilityInputs } from '../channel-availability'
import { channelSetOf } from '../channels'
import { ZONE, at, channel, ck, inputs, item, rule, weekly } from './fixtures'

describe('readChannelRule / readSchedule (C5a-2 stored shape)', () => {
  it('reads baseline + weekly overrides; absent schedule = baseline all week', () => {
    const row = { _key: 'dine-in', _type: 'catalogueChannelRule', channel: 'dine-in', state: 'unavailable', schedule: [{ _key: 's1', _type: 'catalogueWeeklyOverride', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '18:00', to: '23:00', state: 'available' }] }
    expect(readChannelRule(row)).toEqual({ rule: { state: 'unavailable', overrides: [{ kind: 'weekly', key: 's1', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '18:00', to: '23:00', state: 'available' }] }, issues: [] })
    expect(readChannelRule({ _key: 'x', channel: 'x', state: 'available' }).rule).toEqual({ state: 'available', overrides: [] })
  })
  it('never stores or reads "inherit"; an invalid state is no rule', () => {
    expect(readChannelRule({ channel: 'x', state: 'inherit' })).toEqual({ rule: null, issues: ['availability.stateInvalid'] })
  })
  it('an unknown member type is reported and never evaluated (D-6.4 extensible shape)', () => {
    const r = readSchedule([{ _type: 'catalogueDatedOverride', state: 'available' }, { _type: 'catalogueWeeklyOverride', _key: 'w', state: 'available', from: '07:00', to: '11:00' }])
    expect(r.issues).toEqual(['availability.scheduleUnknownKind'])
    expect(r.overrides.map((o) => o.key)).toEqual(['w'])
  })
  it('an override with an unknown day is dropped, not widened to every day', () => {
    expect(readSchedule([{ _type: 'catalogueWeeklyOverride', days: ['funday'], state: 'available' }])).toEqual({ overrides: [], issues: ['availability.scheduleUnknownDay'] })
  })
})

describe('weekProfile / availableSometime / scheduleIssues', () => {
  it('constant rules collapse to one range', () => {
    expect(weekProfile(rule('available'))).toEqual([{ start: 0, end: 10080, state: 'available' }])
  })
  it('breakfast every day → 14 ranges alternating; available sometime', () => {
    const p = weekProfile(rule('unavailable', [weekly('b', 'available', '07:00', '11:00')]))
    expect(p[0]).toEqual({ start: 0, end: 420, state: 'unavailable' })
    expect(p[1]).toEqual({ start: 420, end: 660, state: 'available' })
    expect(availableSometime(rule('unavailable', [weekly('b', 'available', '07:00', '11:00')]))).toBe(true)
    expect(availableSometime(rule('unavailable'))).toBe(false)
  })
  it('codes: invalid time, incomplete, zero length, redundant (warning), limit', () => {
    const codes = (r: ReturnType<typeof rule>) => scheduleIssues(r).map((i) => i.code)
    expect(codes(rule('unavailable', [weekly('a', 'available', '25:00', '11:00')]))).toContain('availability.scheduleInvalidTime')
    expect(codes(rule('unavailable', [weekly('a', 'available', '07:00', null)]))).toContain('availability.scheduleIncomplete')
    expect(codes(rule('unavailable', [weekly('a', 'available', '07:00', '07:00')]))).toContain('availability.scheduleZeroLength')
    expect(scheduleIssues(rule('available', [weekly('a', 'available', '07:00', '08:00')]))).toEqual([{ code: 'availability.scheduleRedundant', level: 'warning', keys: ['a'] }])
    const many = Array.from({ length: 15 }, (_, i) => weekly(`k${i}`, 'available', null, null, [(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[i % 7]]))
    expect(codes(rule('unavailable', many))).toContain('availability.scheduleLimitExceeded')
  })
})

describe('evaluateRule / nextAvailabilityTransition', () => {
  it('the zone is required: a malformed zone throws a typed error, never guesses', () => {
    expect(() => evaluateRule(rule('available'), at('2026-11-02T10:00:00Z'), 'Not/AZone')).toThrow(AvailabilityTimeZoneError)
  })
  it('a constant rule never changes', () => {
    expect(nextAvailabilityTransition(rule('unavailable'), at('2026-11-02T10:00:00Z'), ZONE)).toBeNull()
  })
  it('an override equal to the baseline is no transition', () => {
    expect(nextAvailabilityTransition(rule('available', [weekly('a', 'available', '07:00', '08:00')]), at('2026-11-02T10:00:00Z'), ZONE)).toBeNull()
  })
  it('Sunday overnight wraps into Monday', () => {
    const r = rule('unavailable', [weekly('w', 'available', '23:00', '01:00', ['sun'])])
    expect(evaluateRule(r, at('2026-11-08T23:30:00Z'), ZONE).state).toBe('available') // Mon 00:30 local
    expect(nextAvailabilityTransition(r, at('2026-11-08T23:30:00Z'), ZONE)).toEqual(at('2026-11-09T00:00:00Z'))
  })
})

// ── Boundary test at the resolver level (C5a-4, B-1…B-7) ──────────────────────

/** A listing cache honouring the contract: expiry = min(page TTL, validUntil); scheduleOnly is never cached as "now". */
function makeListing(inp: AvailabilityInputs, items: ReturnType<typeof item>[], ctx: Parameters<typeof availableNow>[3], timeZone: string | null) {
  const TTL = 60 * 60 * 1000
  let cache: { members: string[] | 'schedule'; expires: number } | null = null
  const fresh = (t: Date) => {
    const results: AvailableNow[] = items.map((i) => availableNow(inp, i, null, ctx, t, timeZone))
    if (results.some((r) => r.kind === 'scheduleOnly')) return { members: 'schedule' as const, validUntil: null }
    const validUntil = results.reduce<number | null>((min, r) => (r.kind === 'known' && r.validUntil && (min === null || r.validUntil.getTime() < min) ? r.validUntil.getTime() : min), null)
    return { members: items.filter((_, k) => results[k].kind === 'known' && (results[k] as { state: string }).state === 'available').map((i) => i.itemId), validUntil }
  }
  return {
    request(t: Date) {
      if (cache && t.getTime() < cache.expires) return { served: cache.members, expires: cache.expires }
      const f = fresh(t)
      cache = { members: f.members, expires: Math.min(t.getTime() + TTL, f.validUntil ?? Infinity) }
      return { served: f.members, expires: cache.expires }
    },
    fresh: (t: Date) => fresh(t).members,
  }
}

const DINE = { kind: 'channel' as const, channel: ck('dine-in') }
const EVENING = rule('unavailable', [weekly('e', 'available', '18:00', '23:00')])

describe('C5a-4 boundary test (listing "available now", page TTL 1 h)', () => {
  const chs = channelSetOf([channel('dine-in', 'unavailable')])
  const evening = item({ id: 'dish', rules: { 'dine-in': EVENING } })

  it('B-1 … B-3 — membership flips exactly at 18:00 and 23:00 local without waiting for the TTL', () => {
    const listing = makeListing(inputs(chs), [evening], DINE, ZONE)
    const r1 = listing.request(at('2026-11-02T16:59:00Z'))
    expect(r1.served).toEqual([])
    expect(r1.expires).toBe(at('2026-11-02T17:00:00Z').getTime()) // B-1: cached only until the transition
    expect(listing.request(at('2026-11-02T17:00:00Z')).served).toEqual(['dish']) // B-2
    expect(listing.request(at('2026-11-02T21:59:59Z')).served).toEqual(['dish']) // B-3
    expect(listing.request(at('2026-11-02T22:00:00Z')).served).toEqual([])
  })
  it('B-4 — overnight Fri 22:00–02:00: present Sat 01:00, absent Sat 02:00', () => {
    const night = item({ id: 'n', rules: { 'dine-in': rule('unavailable', [weekly('n', 'available', '22:00', '02:00', ['fri'])]) } })
    const listing = makeListing(inputs(chs), [night], DINE, ZONE)
    expect(listing.request(at('2026-11-07T00:00:00Z')).served).toEqual(['n'])
    expect(listing.request(at('2026-11-07T01:00:00Z')).served).toEqual([])
  })
  it('B-5 — DST fall-back and spring-forward: the listing flips exactly at the instants nextAvailabilityTransition returns', () => {
    const r = rule('unavailable', [weekly('x', 'available', '01:00', '02:30')])
    const i = item({ id: 'x', rules: { 'dine-in': r } })
    for (const start of [at('2026-10-24T22:00:00Z'), at('2027-03-27T23:00:00Z')]) {
      const listing = makeListing(inputs(chs), [i], DINE, ZONE)
      let t = start
      for (let step = 0; step < 4; step++) {
        const next = nextAvailabilityTransition(r, t, ZONE)!
        const before = new Date(next.getTime() - 1000)
        expect(listing.request(before).served).toEqual(listing.fresh(before))
        expect(listing.request(next).served).toEqual(listing.fresh(next))
        expect(listing.fresh(before)).not.toEqual(listing.fresh(next))
        t = next
      }
    }
  })
  it('B-6 — zone missing: the listing shows the schedule form, never "available now"', () => {
    const listing = makeListing(inputs(chs), [evening], DINE, null)
    expect(listing.request(at('2026-11-02T17:30:00Z')).served).toBe('schedule')
  })
  it('B-7 — general, two channels: one member flips, the other keeps the item → membership unchanged, a new validUntil is issued', () => {
    const two = channelSetOf([channel('dine-in', 'unavailable'), channel('takeaway', 'unavailable')])
    const i = item({ id: 'g', rules: { 'dine-in': EVENING, takeaway: rule('unavailable', [weekly('t', 'available', '12:00', '22:00')]) } })
    const listing = makeListing(inputs(two), [i], { kind: 'general' }, ZONE)
    const r1 = listing.request(at('2026-11-02T20:00:00Z')) // 21:00 local: both available
    expect(r1.served).toEqual(['g'])
    expect(r1.expires).toBe(at('2026-11-02T21:00:00Z').getTime()) // takeaway's transition: early, never late
    const r2 = listing.request(at('2026-11-02T21:00:00Z')) // 22:00 local: takeaway closed, dine-in open
    expect(r2.served).toEqual(['g'])
    expect(r2.expires).toBe(at('2026-11-02T22:00:00Z').getTime())
  })
  it('pass criterion — for every request across a day, served membership equals a fresh availableNow', () => {
    const listing = makeListing(inputs(chs), [evening], DINE, ZONE)
    for (let m = 0; m < 24 * 60; m += 7) {
      const t = new Date(at('2026-11-02T00:00:00Z').getTime() + m * 60000)
      expect(listing.request(t).served).toEqual(listing.fresh(t))
    }
  })
})
