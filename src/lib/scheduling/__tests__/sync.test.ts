import { describe, expect, it } from 'vitest'
import { factsOfPublishedEvent, planEventScheduleSync, syncEventSchedule, type PublishedEventFacts } from '../sync.server'
import { removeScheduleForRemovedEvent } from '../removal.server'
import type { EventSchedule } from '../types'

const PID = '11111111-2222-4333-8444-555555555555'
const VENUE = '99999999-2222-4333-8444-555555555555'
const facts = (over: Partial<PublishedEventFacts> = {}): PublishedEventFacts => ({
  publicId: PID,
  startDate: '2026-10-09T15:30:00.000Z',
  endDate: '2026-10-09T18:00:00.000Z',
  attendanceMode: 'inPerson',
  place: { kind: 'location', key: 'brey' },
  timeZone: 'Europe/Brussels',
  cancelled: false,
  ...over,
})
const schedule = (over: { startLocal?: string; endLocal?: string | null; status?: 'scheduled' | 'cancelled'; place?: EventSchedule['series']['place'] } = {}): EventSchedule => ({
  series: { id: 's1', eventPublicId: PID, timeZone: 'Europe/Brussels', startLocal: '2026-10-09T17:30', endLocal: '2026-10-09T20:00', place: over.place === undefined ? { kind: 'location', key: 'brey' } : over.place, attendanceMode: 'inPerson', instructorPublicIds: ['p1'], rule: null, origin: 'migrated', version: 3 } as never,
  occurrences: [{ id: 'o1', seriesId: 's1', eventPublicId: PID, startLocal: over.startLocal ?? '2026-10-09T17:30', endLocal: over.endLocal === undefined ? '2026-10-09T20:00' : over.endLocal, timeZone: 'Europe/Brussels', startsAt: '', endsAt: null, status: over.status ?? 'scheduled', place: null, attendanceMode: 'inPerson', instructorPublicIds: [], note: null, version: 2 } as never],
})

describe('planEventScheduleSync', () => {
  it('creates a schedule from the UTC dates in the event zone', () => {
    const p = planEventScheduleSync(facts(), null)
    expect(p).toMatchObject({ kind: 'save', expectedVersion: null, status: 'scheduled', times: { timeZone: 'Europe/Brussels', startLocal: '2026-10-09T17:30', endLocal: '2026-10-09T20:00' } })
  })
  it('does nothing when the schedule already matches', () => {
    expect(planEventScheduleSync(facts(), schedule())).toEqual({ kind: 'none' })
  })
  it('updates with the stored version and keeps the series instructors', () => {
    const p = planEventScheduleSync(facts({ startDate: '2026-10-09T16:00:00.000Z' }), schedule())
    expect(p).toMatchObject({ kind: 'save', expectedVersion: 3, instructorPublicIds: ['p1'], times: { startLocal: '2026-10-09T18:00' } })
  })
  it('a place or status change is a change', () => {
    expect(planEventScheduleSync(facts({ cancelled: true }), schedule()).kind).toBe('save')
    expect(planEventScheduleSync(facts({ place: null }), schedule()).kind).toBe('save')
  })
  it('keeps the wall clock across DST (winter date)', () => {
    const p = planEventScheduleSync(facts({ startDate: '2026-11-07T09:00:00.000Z', endDate: null }), null)
    expect(p).toMatchObject({ times: { startLocal: '2026-11-07T10:00', endLocal: null } })
  })
})

describe('factsOfPublishedEvent', () => {
  const doc = { publicId: PID, startDate: '2026-10-09T15:30:00.000Z', attendanceMode: 'inPerson', place: { kind: 'venue', venue: { _ref: 'v' } }, eventStatus: 'scheduled' }
  it('venue zone wins over site zone; venue place uses its publicId', () => {
    expect(factsOfPublishedEvent(doc, { siteTimeZone: 'Europe/Rome', venue: { publicId: VENUE, timeZone: 'Europe/London' } })).toMatchObject({ timeZone: 'Europe/London', place: { kind: 'venue', venuePublicId: VENUE } })
  })
  it('no zone, no publicId or no start → null (readers keep the Sanity dates)', () => {
    expect(factsOfPublishedEvent(doc, { siteTimeZone: null, venue: null })).toBeNull()
    expect(factsOfPublishedEvent({ ...doc, publicId: 'x' }, { siteTimeZone: 'Europe/Rome', venue: null })).toBeNull()
    expect(factsOfPublishedEvent({ ...doc, startDate: '' }, { siteTimeZone: 'Europe/Rome', venue: null })).toBeNull()
  })
  it('online events have no place', () => {
    expect(factsOfPublishedEvent({ ...doc, attendanceMode: 'online' }, { siteTimeZone: 'Europe/Rome', venue: { publicId: VENUE } })?.place).toBeNull()
  })
})

describe('syncEventSchedule', () => {
  const store = (opts: { existing?: EventSchedule | null; failSave?: boolean; failRemove?: boolean } = {}) => {
    const log: string[] = []
    let current: EventSchedule | null = opts.existing ?? null
    return {
      log,
      store: {
        schedulesForEvents: async () => new Map(current ? [[PID, current]] : []),
        saveOneOff: async () => {
          log.push('save')
          if (opts.failSave) throw new Error('down')
          current = schedule()
          return { seriesId: 's1', occurrenceId: 'o1', version: 4 }
        },
        setOccurrenceStatus: async (_p: string, _o: string, status: string) => { log.push(`status:${status}`); return 3 },
        removeEventSchedule: async () => { log.push('remove'); if (opts.failRemove) throw new Error('down'); return 1 },
      },
    }
  }
  it('saves, then sets the cancelled status', async () => {
    const s = store()
    await expect(syncEventSchedule('proj', facts({ cancelled: true }), 'u1', { store: s.store as never })).resolves.toEqual({ ok: true, changed: true })
    expect(s.log).toEqual(['save', 'status:cancelled'])
  })
  it('unchanged → no write', async () => {
    const s = store({ existing: schedule() })
    await expect(syncEventSchedule('proj', facts(), null, { store: s.store as never })).resolves.toEqual({ ok: true, changed: false })
    expect(s.log).toEqual([])
  })
  it('a failed write tombstones the schedule so readers use the Sanity dates', async () => {
    const s = store({ existing: schedule(), failSave: true })
    await expect(syncEventSchedule('proj', facts({ startDate: '2026-10-10T15:30:00.000Z', endDate: null }), null, { store: s.store as never })).resolves.toEqual({ ok: false, fellBack: true })
    expect(s.log).toEqual(['save', 'remove'])
  })
  it('never throws, even when the fallback fails', async () => {
    const s = store({ failSave: true, failRemove: true })
    await expect(syncEventSchedule('proj', facts(), null, { store: s.store as never })).resolves.toEqual({ ok: false, fellBack: false })
  })
})

describe('removeScheduleForRemovedEvent', () => {
  const deps = (log: string[]) => ({ store: { removeEventSchedule: async (p: string, id: string) => { log.push(`${p}:${id}`); return 1 } }, resolveProject: async (s: string) => (s === 'cyce' ? 'proj-cyce' : null) })
  it('tombstones an event of a known project', async () => {
    const log: string[] = []
    await expect(removeScheduleForRemovedEvent({ type: 'event', publicId: PID, projectSlug: 'cyce' }, deps(log))).resolves.toBe(true)
    expect(log).toEqual([`proj-cyce:${PID}`])
  })
  it('ignores other types, bad ids and unknown projects', async () => {
    const log: string[] = []
    for (const p of [{ type: 'eventVenue', publicId: PID, projectSlug: 'cyce' }, { type: 'event', publicId: 'x', projectSlug: 'cyce' }, { type: 'event', publicId: PID, projectSlug: 'other' }, null]) {
      await expect(removeScheduleForRemovedEvent(p, deps(log))).resolves.toBe(false)
    }
    expect(log).toEqual([])
  })
})
