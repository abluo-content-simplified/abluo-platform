import { describe, expect, it } from 'vitest'
import { createSupabaseScheduleStore } from '../store'
import { resolveSessionTimes } from '../time'
import { ScheduleError } from '../types'

const P = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const EV = 'edccb129-3d15-497d-ad46-c30f0cc41261'
const S1 = '33333333-3333-4333-8333-333333333333'
const O1 = '44444444-4444-4444-8444-444444444444'
const VENUE = '55555555-5555-4555-8555-555555555555'

type Call = { table: string; ops: [string, ...unknown[]][] }

function fakeDb(results: Record<string, { data?: unknown; error?: unknown }>, rpcResult: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = []
  const rpcCalls: [string, Record<string, unknown>][] = []
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => (call.ops.push([m, ...args]), b)
      }
      b.then = (resolve: (v: unknown) => void) => resolve(results[table] ?? { data: [] })
      return b
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args])
      return Promise.resolve(rpcResult)
    },
  }
  return { db, calls, rpcCalls }
}

const seriesRow = { id: S1, event_public_id: EV, time_zone: 'Europe/Brussels', start_local: '2026-10-24T10:00:00', end_local: null, place: { kind: 'location', key: 'brey' }, attendance_mode: 'mixed', instructor_public_ids: [VENUE], rule: null, origin: 'migrated', version: 2 }
const occRow = { id: O1, series_id: S1, start_local: '2026-10-24T10:00:00', end_local: '2026-10-24T12:30:00', time_zone: 'Europe/Brussels', starts_at: '2026-10-24T08:00:00+00:00', ends_at: '2026-10-24T10:30:00+00:00', status: 'scheduled', place_override: null, attendance_override: 'online', instructor_override: null, note: null, version: 3 }

describe('schedule store — every read is scoped by project (isolation)', () => {
  it('schedulesForEvents filters both tables by project and hides tombstones', async () => {
    const f = fakeDb({ event_series: { data: [seriesRow] }, event_occurrences: { data: [occRow] } })
    const map = await createSupabaseScheduleStore(f.db).schedulesForEvents(P, [EV, 'not-a-uuid'])
    for (const c of f.calls) {
      expect(c.ops).toContainEqual(['eq', 'project_id', P])
      expect(c.ops).toContainEqual(['is', 'removed_at', null])
    }
    expect(f.calls[0].ops).toContainEqual(['in', 'event_public_id', [EV]])
    const s = map.get(EV)!
    expect(s.series).toMatchObject({ id: S1, startLocal: '2026-10-24T10:00', origin: 'migrated', version: 2 })
    // The session overrides attendance; place and hosts come from the series.
    expect(s.occurrences[0]).toMatchObject({
      id: O1, startsAt: '2026-10-24T08:00:00.000Z', endLocal: '2026-10-24T12:30', attendanceMode: 'online',
      place: { kind: 'location', key: 'brey' }, instructorPublicIds: [VENUE], version: 3,
    })
  })

  it('occurrencesInWindow: project-scoped, not-yet-over sessions, earliest first, capped', async () => {
    const f = fakeDb({ event_occurrences: { data: [occRow] }, event_series: { data: [seriesRow] } })
    const list = await createSupabaseScheduleStore(f.db).occurrencesInWindow(P, { from: '2026-10-20T00:00:00Z', to: '2026-11-01T00:00:00Z', limit: 9999 })
    const occ = f.calls.find((c) => c.table === 'event_occurrences')!
    expect(occ.ops).toContainEqual(['eq', 'project_id', P])
    expect(occ.ops).toContainEqual(['or', 'ends_at.gte.2026-10-20T00:00:00.000Z,and(ends_at.is.null,starts_at.gte.2026-10-20T00:00:00.000Z)'])
    expect(occ.ops).toContainEqual(['lt', 'starts_at', '2026-11-01T00:00:00.000Z'])
    expect(occ.ops).toContainEqual(['limit', 500])
    expect(f.calls.find((c) => c.table === 'event_series')!.ops).toContainEqual(['eq', 'project_id', P])
    expect(list).toHaveLength(1)
  })

  it('a session whose series is gone (removed / other project) is not returned', async () => {
    const f = fakeDb({ event_occurrences: { data: [occRow] }, event_series: { data: [] } })
    expect(await createSupabaseScheduleStore(f.db).occurrencesInWindow(P, { from: '2026-10-20T00:00:00Z' })).toEqual([])
  })

  it('refuses a malformed project id before any query', async () => {
    const f = fakeDb({})
    await expect(createSupabaseScheduleStore(f.db).schedulesForEvents('livener', [EV])).rejects.toMatchObject({ code: 'invalid' })
    expect(f.calls).toEqual([])
  })
})

describe('schedule store — writes go through the transactional functions', () => {
  const times = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', endLocal: '2026-10-24T12:30' })

  it('saveOneOff passes local time, zone and UTC, and returns ids + version', async () => {
    const f = fakeDb({}, { data: [{ series_id: S1, occurrence_id: O1, version: 1 }] })
    const r = await createSupabaseScheduleStore(f.db).saveOneOff({ projectId: P, eventPublicId: EV, times, place: { kind: 'venue', venuePublicId: VENUE }, attendanceMode: 'inPerson', expectedVersion: null })
    expect(r).toEqual({ seriesId: S1, occurrenceId: O1, version: 1 })
    expect(f.rpcCalls[0][0]).toBe('event_schedule_save_one_off')
    expect(f.rpcCalls[0][1]).toMatchObject({
      p_project_id: P, p_event_public_id: EV, p_time_zone: 'Europe/Brussels',
      p_start_local: '2026-10-24T10:00', p_end_local: '2026-10-24T12:30',
      p_starts_at: '2026-10-24T08:00:00.000Z', p_ends_at: '2026-10-24T10:30:00.000Z',
      p_place: { kind: 'venue', venuePublicId: VENUE }, p_expected_version: null, p_origin: 'dashboard',
    })
  })

  it('maps database errors: stale version → conflict, check violation → invalid, other → unavailable', async () => {
    const run = (error: unknown) =>
      createSupabaseScheduleStore(fakeDb({}, { error }).db).saveOneOff({ projectId: P, eventPublicId: EV, times, place: null, attendanceMode: 'inPerson', expectedVersion: 1 })
    await expect(run({ code: 'AB409' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(run({ code: '40001' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(run({ code: 'P0002' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(run({ code: '23514' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(run({ code: '08006' })).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('refuses a malformed event, venue or host id before calling the database', async () => {
    const f = fakeDb({})
    const store = createSupabaseScheduleStore(f.db)
    await expect(store.saveOneOff({ projectId: P, eventPublicId: 'cyce-event-pranayama', times, place: null, attendanceMode: 'inPerson', expectedVersion: null })).rejects.toBeInstanceOf(ScheduleError)
    await expect(store.saveOneOff({ projectId: P, eventPublicId: EV, times, place: { kind: 'venue', venuePublicId: 'x' }, attendanceMode: 'inPerson', expectedVersion: null })).rejects.toBeInstanceOf(ScheduleError)
    expect(f.rpcCalls).toEqual([])
  })

  it('status and removal are scoped by project', async () => {
    const f = fakeDb({}, { data: 4 })
    const store = createSupabaseScheduleStore(f.db)
    expect(await store.setOccurrenceStatus(OTHER, O1, 'cancelled', 3)).toBe(4)
    await store.removeEventSchedule(OTHER, EV)
    expect(f.rpcCalls.map(([fn, a]) => [fn, a.p_project_id])).toEqual([['event_occurrence_set_status', OTHER], ['event_schedule_remove', OTHER]])
  })
})
