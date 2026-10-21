import { describe, expect, it, vi } from 'vitest'
import { applySchedule, applySchedules, type SchedulableEvent } from '../overlay'
import { withSchedules } from '../read.server'
import type { EventSchedule } from '../types'

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))

const EV = 'edccb129-3d15-497d-ad46-c30f0cc41261'
const schedule = (over: Partial<EventSchedule['occurrences'][0]> = {}): EventSchedule => ({
  series: { id: 's', eventPublicId: EV, timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', endLocal: null, place: null, attendanceMode: 'inPerson', instructorPublicIds: [], rule: null, origin: 'migrated', version: 1 },
  occurrences: [{ id: 'o', seriesId: 's', eventPublicId: EV, startLocal: '2026-10-31T10:00', endLocal: '2026-10-31T12:30', timeZone: 'Europe/Brussels', startsAt: '2026-10-31T09:00:00.000Z', endsAt: '2026-10-31T11:30:00.000Z', status: 'scheduled', place: null, attendanceMode: 'inPerson', instructorPublicIds: [], note: null, version: 1, ...over }],
})
const sanity = { publicId: EV, title: 'Pranayama', startDate: '2026-10-24T08:00:00.000Z', endDate: '2026-10-24T10:30:00.000Z', eventStatus: 'scheduled' }

describe('schedule overlay (ADR-038 C3)', () => {
  it('an event with a schedule shows the schedule\'s dates; the rest of the event is untouched', () => {
    expect(applySchedule(sanity, schedule())).toEqual({ ...sanity, startDate: '2026-10-31T09:00:00.000Z', endDate: '2026-10-31T11:30:00.000Z' })
  })
  it('an event without a schedule keeps its Sanity dates (fallback)', () => {
    expect(applySchedule(sanity, undefined)).toBe(sanity)
    expect(applySchedules([sanity, { title: 'no id', startDate: 'x' }], new Map())).toEqual([sanity, { title: 'no id', startDate: 'x' }])
  })
  it('a cancelled session reads as cancelled; postponed / sold out stay as authored', () => {
    expect(applySchedule(sanity, schedule({ status: 'cancelled' })).eventStatus).toBe('cancelled')
    expect(applySchedule({ ...sanity, eventStatus: 'postponed' }, schedule({ status: 'cancelled' })).eventStatus).toBe('postponed')
  })
})

describe('withSchedules fails soft', () => {
  it('Supabase down → Sanity dates, no throw', async () => {
    const out = await withSchedules('cyce', [sanity], { resolveProject: async () => 'p', store: { schedulesForEvents: async () => { throw new Error('down') } } })
    expect(out).toEqual([sanity])
  })
  it('unknown or ambiguous project → Sanity dates, schedules never read', async () => {
    const read = vi.fn()
    expect(await withSchedules('cyce', [sanity], { resolveProject: async () => null, store: { schedulesForEvents: read } })).toEqual([sanity])
    expect(read).not.toHaveBeenCalled()
  })
  it('reads only for events that have a publicId, and applies what it finds', async () => {
    const read = vi.fn(async () => new Map([[EV, schedule()]]))
    const out = await withSchedules('cyce', [sanity, { title: 'legacy' }] as Array<SchedulableEvent & { title?: string }>, { resolveProject: async () => 'p', store: { schedulesForEvents: read } })
    expect(read).toHaveBeenCalledWith('p', [EV])
    expect(out[0].startDate).toBe('2026-10-31T09:00:00.000Z')
    expect(out[1]).toEqual({ title: 'legacy' })
  })
})
