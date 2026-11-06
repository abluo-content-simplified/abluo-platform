import { describe, expect, it } from 'vitest'
import { createCourseScheduleStore, type SaveClassInput } from '../course-store'
import { ScheduleError } from '../types'

const P = '11111111-1111-4111-8111-111111111111'
const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const S1 = '33333333-3333-4333-8333-333333333333'
const O1 = '44444444-4444-4444-8444-444444444444'
const ED = '55555555-5555-4555-8555-555555555555'
const ROOM = '66666666-6666-4666-8666-666666666666'
const PERSON = '77777777-7777-4777-8777-777777777777'

type Op = [string, ...unknown[]]
type Call = { table: string; ops: Op[] }
type Result = { data?: unknown; error?: unknown }

function fakeDb(results: Record<string, Result | Result[]> = {}, rpcResults: Record<string, Result> = {}) {
  const calls: Call[] = []
  const rpcCalls: [string, Record<string, unknown>][] = []
  const counters: Record<string, number> = {}
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => (call.ops.push([m, ...args]), b)
      }
      b.then = (resolve: (v: unknown) => void) => {
        const r = results[table]
        const i = (counters[table] = (counters[table] ?? -1) + 1)
        resolve((Array.isArray(r) ? r[Math.min(i, r.length - 1)] : r) ?? { data: [] })
      }
      return b
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args])
      return Promise.resolve(rpcResults[fn] ?? { data: null })
    },
  }
  return { db, calls, rpcCalls }
}

const seriesRow = {
  id: S1, owner_type: 'course', owner_public_id: COURSE, edition_id: ED, time_zone: 'Europe/Brussels',
  start_local: '2026-12-07T18:00:00', end_local: '2026-12-07T19:30:00', rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', rule_weekday: 1,
  starts_on: '2026-12-07', ends_on: '2026-12-28', place: { kind: 'location', key: 'brey' }, attendance_mode: 'mixed',
  instructor_public_ids: [PERSON], languages: ['fr', 'en'], meeting_room_id: ROOM, status: 'active', version: 4,
}
const editionRow = { id: ED, owner_type: null, owner_public_id: null, label: { en: 'Winter' }, starts_on: '2026-12-01', ends_on: '2026-12-31', time_zone: 'Europe/Brussels', version: 1 }

const classInput: SaveClassInput = {
  projectId: P, seriesId: null, ownerPublicId: COURSE, editionId: ED, timeZone: 'Europe/Brussels', weekday: 1, startTime: '18:00', endTime: '19:30',
  startsOn: '2026-12-02', endsOn: '2026-12-28', place: { kind: 'location', key: 'brey' }, attendanceMode: 'inPerson',
  instructorPublicIds: [PERSON], languages: ['fr'], meetingRoomId: ROOM, expectedVersion: null,
}

const invalid = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(ScheduleError)
  expect((e as ScheduleError).code).toBe('invalid')
}

describe('saveSeries — validation and RPC mapping', () => {
  it('maps a new weekly class to schedule_series_save (an unaligned first date rolls to the first Monday)', async () => {
    const f = fakeDb({}, { schedule_series_save: { data: [{ series_id: S1, version: 1 }] } })
    const out = await createCourseScheduleStore(f.db).saveSeries({ ...classInput, actorId: PERSON })
    expect(out).toEqual({ seriesId: S1, version: 1 })
    expect(f.rpcCalls).toHaveLength(1)
    const [fn, args] = f.rpcCalls[0]
    expect(fn).toBe('schedule_series_save')
    expect(args).toMatchObject({
      p_project_id: P, p_series_id: null, p_owner_type: 'course', p_owner_public_id: COURSE, p_edition_id: ED, p_time_zone: 'Europe/Brussels',
      p_start_local: '2026-12-07T18:00', p_end_local: '2026-12-07T19:30', p_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', p_rule_weekday: 1,
      p_starts_on: '2026-12-07', p_ends_on: '2026-12-28', p_place: { kind: 'location', key: 'brey' }, p_attendance_mode: 'inPerson',
      p_instructors: [PERSON], p_languages: ['fr'], p_meeting_room_id: ROOM, p_expected_version: null, p_actor: PERSON,
    })
  })

  it('an update passes the series id and expected version', async () => {
    const f = fakeDb({}, { schedule_series_save: { data: { series_id: S1, version: 5 } } })
    const out = await createCourseScheduleStore(f.db).saveSeries({ ...classInput, seriesId: S1, expectedVersion: 4, interval: 2 })
    expect(out.version).toBe(5)
    expect(f.rpcCalls[0][1]).toMatchObject({ p_series_id: S1, p_expected_version: 4, p_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', p_ends_on: '2026-12-21' }) // 28 Dec is an off week: rolls back
  })

  it('saves several days, monthly and once presets (rule text, first weekday, dates)', async () => {
    const f = fakeDb({}, { schedule_series_save: { data: [{ series_id: S1, version: 1 }] } })
    const store = createCourseScheduleStore(f.db)
    await store.saveSeries({ ...classInput, repeat: { kind: 'weekly', weekdays: [3, 1], interval: 1 }, startsOn: '2026-12-02', endsOn: '2026-12-28' })
    expect(f.rpcCalls[0][1]).toMatchObject({ p_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE', p_rule_weekday: 1, p_start_local: '2026-12-02T18:00' })
    await store.saveSeries({ ...classInput, repeat: { kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, startsOn: '2026-12-27', endsOn: null })
    expect(f.rpcCalls[1][1]).toMatchObject({ p_rule: 'FREQ=MONTHLY;BYDAY=-1SU', p_rule_weekday: 7, p_ends_on: null })
    await store.saveSeries({ ...classInput, repeat: { kind: 'monthlyDay', day: 15 }, startsOn: '2026-12-15', endsOn: '2027-03-15' })
    expect(f.rpcCalls[2][1]).toMatchObject({ p_rule: 'FREQ=MONTHLY;BYMONTHDAY=15', p_rule_weekday: 2 })
    await store.saveSeries({ ...classInput, repeat: { kind: 'once' }, startsOn: '2026-12-12', endsOn: null })
    expect(f.rpcCalls[3][1]).toMatchObject({ p_rule: 'FREQ=DAILY;COUNT=1', p_rule_weekday: 6, p_starts_on: '2026-12-12', p_ends_on: '2026-12-12', p_start_local: '2026-12-12T18:00' })
  })

  it('rolls an unaligned first date forward and last date back; refuses only when nothing fits', async () => {
    const f = fakeDb({}, { schedule_series_save: { data: [{ series_id: S1, version: 1 }] } })
    const store = createCourseScheduleStore(f.db)
    await store.saveSeries({ ...classInput, startsOn: '2026-12-08', endsOn: '2026-12-29' }) // Tuesday → Monday 14th; 29th → Monday 28th
    expect(f.rpcCalls[0][1]).toMatchObject({ p_starts_on: '2026-12-14', p_start_local: '2026-12-14T18:00', p_ends_on: '2026-12-28' })
    await store.saveSeries({ ...classInput, repeat: { kind: 'monthlyDay', day: 15 }, startsOn: '2026-12-16', endsOn: null })
    expect(f.rpcCalls[1][1]).toMatchObject({ p_starts_on: '2027-01-15', p_rule_weekday: 5 })
    await invalid(store.saveSeries({ ...classInput, startsOn: '2026-12-08', endsOn: '2026-12-10' })) // no Monday between
    await invalid(store.saveSeries({ ...classInput, repeat: { kind: 'monthlyDay', day: 40 }, startsOn: '2026-12-15', endsOn: null }))
    expect(f.rpcCalls).toHaveLength(2)
  })

  it('a class (a once class in particular) cannot start outside its term', async () => {
    const term = { data: [{ starts_on: '2026-12-01', ends_on: '2026-12-31' }] }
    const f = fakeDb({ schedule_editions: term }, { schedule_series_save: { data: [{ series_id: S1, version: 1 }] } })
    const store = createCourseScheduleStore(f.db)
    const outside = await store.saveSeries({ ...classInput, repeat: { kind: 'once' }, startsOn: '2027-01-09', endsOn: null }).catch((e) => e)
    expect(outside).toBeInstanceOf(ScheduleError)
    expect(outside.code).toBe('outside_term')
    const before = await store.saveSeries({ ...classInput, startsOn: '2026-11-23', endsOn: null }).catch((e) => e)
    expect(before.code).toBe('outside_term')
    expect(f.rpcCalls).toHaveLength(0)
    await store.saveSeries({ ...classInput, repeat: { kind: 'once' }, startsOn: '2026-12-12', endsOn: null })
    expect(f.rpcCalls).toHaveLength(1)
  })

  it('refuses bad input before any call', async () => {
    const f = fakeDb()
    const store = createCourseScheduleStore(f.db)
    await invalid(store.saveSeries({ ...classInput, projectId: 'nope' }))
    await invalid(store.saveSeries({ ...classInput, ownerPublicId: 'nope' }))
    await invalid(store.saveSeries({ ...classInput, weekday: 8 }))
    await invalid(store.saveSeries({ ...classInput, interval: 0 }))
    await invalid(store.saveSeries({ ...classInput, startTime: '7pm' }))
    await invalid(store.saveSeries({ ...classInput, endTime: '17:00' })) // ends before it starts
    await invalid(store.saveSeries({ ...classInput, timeZone: 'Mars/Base' }))
    await invalid(store.saveSeries({ ...classInput, startsOn: '2026-13-01' }))
    await invalid(store.saveSeries({ ...classInput, repeat: { kind: 'weekly', weekdays: [], interval: 1 } }))
    await invalid(store.saveSeries({ ...classInput, endsOn: '2026-12-01' }))
    await invalid(store.saveSeries({ ...classInput, languages: ['FR'] }))
    await invalid(store.saveSeries({ ...classInput, languages: ['fr', 'fr'] }))
    await invalid(store.saveSeries({ ...classInput, languages: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'] }))
    await invalid(store.saveSeries({ ...classInput, instructorPublicIds: ['x'] }))
    await invalid(store.saveSeries({ ...classInput, place: { kind: 'location', key: 'Has Space' } }))
    await invalid(store.saveSeries({ ...classInput, place: { kind: 'venue', venuePublicId: 'x' } }))
    await invalid(store.saveSeries({ ...classInput, attendanceMode: 'sometimes' as never }))
    await invalid(store.saveSeries({ ...classInput, meetingRoomId: 'x' }))
    await invalid(store.saveSeries({ ...classInput, seriesId: S1, expectedVersion: null })) // update needs a version
    await invalid(store.saveSeries({ ...classInput, seriesId: null, expectedVersion: 1 })) // create has none
    expect(f.rpcCalls).toHaveLength(0)
  })

  it('maps database errors to opaque schedule errors', async () => {
    for (const [code, expected] of [['AB409', 'conflict'], ['P0002', 'not_found'], ['22023', 'invalid'], ['23514', 'invalid'], ['XX000', 'unavailable']] as const) {
      const f = fakeDb({}, { schedule_series_save: { error: { code, message: 'secret detail' } } })
      const e = await createCourseScheduleStore(f.db).saveSeries(classInput).catch((x) => x)
      expect(e).toBeInstanceOf(ScheduleError)
      expect(e.code).toBe(expected)
      expect(e.message).not.toContain('secret')
    }
  })
})

describe('syncSeries — builds the full row set from the expander', () => {
  it('expands from today to the earlier of series/term end, honours closures, and sends rows + closed list', async () => {
    const f = fakeDb(
      {
        event_series: [{ data: [seriesRow] }],
        schedule_editions: { data: [{ ...editionRow, ends_on: '2026-12-21' }] },
        schedule_closures: { data: [{ id: 'c', edition_id: null, starts_on: '2026-12-14', ends_on: '2026-12-14', label: {} }] },
        event_occurrences: { data: [{ original_start_local: '2026-12-21T18:00:00' }, { original_start_local: '2027-03-01T18:00:00' }] },
      },
      { schedule_occurrences_sync: { data: [{ inserted: 2, updated: 0, removed: 1 }] } },
    )
    const out = await createCourseScheduleStore(f.db).syncSeries(P, S1, { now: new Date('2026-12-02T10:00:00Z') })
    const [fn, args] = f.rpcCalls[0]
    expect(fn).toBe('schedule_occurrences_sync')
    expect(args.p_project_id).toBe(P)
    expect(args.p_series_id).toBe(S1)
    expect(args.p_from).toBe('2026-12-06T23:00:00.000Z') // from = latest of today (2 Dec), startsOn / first session (7 Dec), term start = 7 Dec 00:00 Brussels
    expect(args.p_rows).toEqual([
      { original_start_local: '2026-12-07T18:00', start_local: '2026-12-07T18:00', end_local: '2026-12-07T19:30', starts_at: '2026-12-07T17:00:00.000Z', ends_at: '2026-12-07T18:30:00.000Z' },
      { original_start_local: '2026-12-21T18:00', start_local: '2026-12-21T18:00', end_local: '2026-12-21T19:30', starts_at: '2026-12-21T17:00:00.000Z', ends_at: '2026-12-21T18:30:00.000Z' },
    ])
    expect(args.p_closed).toEqual(['2026-12-14T18:00'])
    // 21 Dec is in the rule; 1 Mar 2027 is an edited session the rule no longer produces.
    expect(out).toMatchObject({ inserted: 2, updated: 0, removed: 1, truncated: false, modifiedOutsideRule: ['2027-03-01T18:00'] })
    // Closures are read for the project: site-wide plus this series' term.
    const cl = f.calls.find((c) => c.table === 'schedule_closures')!
    expect(cl.ops).toContainEqual(['eq', 'project_id', P])
    expect(cl.ops).toContainEqual(['or', `edition_id.is.null,edition_id.eq.${ED}`])
  })

  it('expands several days, and a once class, from their stored rules', async () => {
    const run = async (row: Record<string, unknown>) => {
      const f = fakeDb(
        { event_series: [{ data: [{ ...row, edition_id: null }] }], schedule_closures: { data: [] }, event_occurrences: { data: [] } },
        { schedule_occurrences_sync: { data: [{ inserted: 1, updated: 0, removed: 0 }] } },
      )
      await createCourseScheduleStore(f.db).syncSeries(P, S1, { now: new Date('2026-12-02T10:00:00Z') })
      return (f.rpcCalls[0][1].p_rows as Array<{ original_start_local: string }>).map((r) => r.original_start_local.slice(0, 10))
    }
    expect(await run({ ...seriesRow, rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE', ends_on: '2026-12-16' })).toEqual(['2026-12-07', '2026-12-09', '2026-12-14', '2026-12-16'])
    expect(await run({ ...seriesRow, rule: 'FREQ=DAILY;COUNT=1', rule_weekday: 1, ends_on: '2026-12-07' })).toEqual(['2026-12-07'])
    expect(await run({ ...seriesRow, rule: 'FREQ=MONTHLY;BYDAY=1MO', ends_on: '2027-02-28', start_local: '2026-12-07T18:00:00' })).toEqual(['2026-12-07', '2027-01-04', '2027-02-01'])
  })

  it('refuses a series that does not repeat weekly and a missing series', async () => {
    const odd = fakeDb({ event_series: { data: [{ ...seriesRow, rule: null }] } })
    await invalid(createCourseScheduleStore(odd.db).syncSeries(P, S1))
    const none = fakeDb({ event_series: { data: [] } })
    const e = await createCourseScheduleStore(none.db).syncSeries(P, S1).catch((x) => x)
    expect(e.code).toBe('not_found')
    await invalid(createCourseScheduleStore(none.db).syncSeries('nope', S1))
  })
})

describe('updateOccurrence', () => {
  const base = { projectId: P, occurrenceId: O1, expectedVersion: 3 }
  it('maps cancel, substitute, time change and note to schedule_occurrence_update', async () => {
    const f = fakeDb({}, { schedule_occurrence_update: { data: 4 } })
    const v = await createCourseScheduleStore(f.db).updateOccurrence({
      ...base, status: 'cancelled', instructorPublicIds: [PERSON], times: { timeZone: 'Europe/Brussels', startLocal: '2026-12-07T20:00', endLocal: '2026-12-07T21:00' }, note: { en: ' Moved ', fr: '' },
    })
    expect(v).toBe(4)
    expect(f.rpcCalls[0][1]).toEqual({
      p_project_id: P, p_occurrence_id: O1, p_expected_version: 3, p_status: 'cancelled', p_instructor_override: [PERSON], p_clear_instructor: false,
      p_start_local: '2026-12-07T20:00', p_end_local: '2026-12-07T21:00', p_starts_at: '2026-12-07T19:00:00.000Z', p_ends_at: '2026-12-07T20:00:00.000Z',
      p_note: { en: 'Moved' }, p_clear_note: false,
    })
  })
  it('sends nulls for what is left alone and the clear flags when asked', async () => {
    const f = fakeDb({}, { schedule_occurrence_update: { data: 5 } })
    await createCourseScheduleStore(f.db).updateOccurrence({ ...base, clearInstructors: true, clearNote: true })
    expect(f.rpcCalls[0][1]).toMatchObject({ p_status: null, p_instructor_override: null, p_clear_instructor: true, p_start_local: null, p_starts_at: null, p_note: null, p_clear_note: true })
  })
  it('validates input', async () => {
    const f = fakeDb()
    const store = createCourseScheduleStore(f.db)
    await invalid(store.updateOccurrence({ ...base, occurrenceId: 'x' }))
    await invalid(store.updateOccurrence({ ...base, status: 'gone' as never }))
    await invalid(store.updateOccurrence({ ...base, instructorPublicIds: ['x'] }))
    await invalid(store.updateOccurrence({ ...base, instructorPublicIds: [PERSON], clearInstructors: true }))
    await invalid(store.updateOccurrence({ ...base, note: { 'not a locale': 'x' } }))
    await invalid(store.updateOccurrence({ ...base, note: { en: 'x' }, clearNote: true }))
    await invalid(store.updateOccurrence({ ...base, times: { timeZone: 'Europe/Brussels', startLocal: 'soon' } }))
    expect(f.rpcCalls).toHaveLength(0)
  })
  it('a stale version is a conflict', async () => {
    const f = fakeDb({}, { schedule_occurrence_update: { error: { code: 'AB409' } } })
    const e = await createCourseScheduleStore(f.db).updateOccurrence({ ...base, status: 'scheduled' }).catch((x) => x)
    expect(e.code).toBe('conflict')
  })
})

describe('reads are scoped by project', () => {
  it('listSeries / occurrencesInWindow filter by project, owner and tombstones', async () => {
    const occ = { id: O1, series_id: S1, owner_type: 'course', owner_public_id: COURSE, original_start_local: '2026-12-07T18:00:00', start_local: '2026-12-07T18:00:00', end_local: null, time_zone: 'Europe/Brussels', starts_at: '2026-12-07T17:00:00+00:00', ends_at: null, status: 'scheduled', is_modified: true, place_override: null, attendance_override: null, instructor_override: [], note: null, version: 2 }
    const f = fakeDb({ event_series: { data: [seriesRow] }, event_occurrences: { data: [occ] } })
    const store = createCourseScheduleStore(f.db)
    const list = await store.listSeries(P, { ownerPublicIds: [COURSE, 'bad'], editionId: ED })
    expect(list[0]).toMatchObject({ id: S1, ownerType: 'course', weekday: 1, interval: 1, startsOn: '2026-12-07', languages: ['fr', 'en'], meetingRoomId: ROOM, startLocal: '2026-12-07T18:00' })
    const sc = f.calls[0]
    expect(sc.ops).toContainEqual(['eq', 'project_id', P])
    expect(sc.ops).toContainEqual(['eq', 'owner_type', 'course'])
    expect(sc.ops).toContainEqual(['is', 'removed_at', null])
    expect(sc.ops).toContainEqual(['in', 'owner_public_id', [COURSE]])
    expect(sc.ops).toContainEqual(['eq', 'edition_id', ED])

    const win = await store.occurrencesInWindow(P, { from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z', ownerPublicIds: [COURSE], limit: 99999 })
    const oc = f.calls.find((c) => c.table === 'event_occurrences')!
    expect(oc.ops).toContainEqual(['eq', 'project_id', P])
    expect(oc.ops).toContainEqual(['eq', 'owner_type', 'course'])
    expect(oc.ops).toContainEqual(['is', 'removed_at', null])
    expect(oc.ops).toContainEqual(['lt', 'starts_at', '2027-01-01T00:00:00.000Z'])
    expect(oc.ops).toContainEqual(['limit', 1000])
    // [] override = "nobody" (not the class default); series fields are applied; no meeting details leak.
    expect(win[0]).toMatchObject({ ownerPublicId: COURSE, isModified: true, instructorPublicIds: [], languages: ['fr', 'en'], meetingRoomId: ROOM, attendanceMode: 'mixed', place: { kind: 'location', key: 'brey' } })
    expect(JSON.stringify(win)).not.toMatch(/passcode|join_url|joinUrl/)
  })

  it('an empty owner filter or a malformed project makes no query', async () => {
    const f = fakeDb()
    const store = createCourseScheduleStore(f.db)
    expect(await store.listSeries(P, { ownerPublicIds: ['bad'] })).toEqual([])
    expect(await store.occurrencesInWindow(P, { from: '2026-12-01T00:00:00Z', ownerPublicIds: [] })).toEqual([])
    await invalid(store.listSeries('nope'))
    await invalid(store.occurrencesInWindow('nope', { from: '2026-12-01T00:00:00Z' }))
    await invalid(store.occurrencesInWindow(P, { from: 'yesterday' }))
  })
})

describe('editions, closures and meeting rooms', () => {
  it('saveEdition validates and inserts under the project', async () => {
    const f = fakeDb({ schedule_editions: { data: [{ id: ED, version: 1 }] } })
    const store = createCourseScheduleStore(f.db)
    expect(await store.saveEdition({ projectId: P, label: { en: 'Winter' }, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels' })).toEqual({ id: ED, version: 1 })
    expect(f.calls[0].ops[0]).toEqual(['insert', { project_id: P, owner_type: null, owner_public_id: null, label: { en: 'Winter' }, starts_on: '2026-12-01', ends_on: '2026-12-31', time_zone: 'Europe/Brussels' }])
    await invalid(store.saveEdition({ projectId: P, label: { en: 'x' }, startsOn: '2026-12-31', endsOn: '2026-12-01', timeZone: 'Europe/Brussels' }))
    await invalid(store.saveEdition({ projectId: P, label: { en: 'x' }, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Nowhere/Land' }))
    await invalid(store.saveEdition({ projectId: P, label: { 'bad key': 'x' }, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels' }))
    await invalid(store.saveEdition({ projectId: P, ownerType: 'course', label: {}, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels' })) // owner needs both
    await invalid(store.saveEdition({ projectId: P, id: ED, label: {}, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels' })) // update needs version
  })

  it('a stale edition update is a conflict (version in the WHERE clause)', async () => {
    const f = fakeDb({ schedule_editions: { data: [] } })
    const e = await createCourseScheduleStore(f.db)
      .saveEdition({ projectId: P, id: ED, label: {}, startsOn: '2026-12-01', endsOn: '2026-12-31', timeZone: 'Europe/Brussels', expectedVersion: 1 })
      .catch((x) => x)
    expect(e.code).toBe('conflict')
    expect(f.calls[0].ops).toContainEqual(['eq', 'version', 1])
    expect(f.calls[0].ops).toContainEqual(['eq', 'project_id', P])
  })

  it('saveClosure inserts, then re-syncs the live weekly classes of that term', async () => {
    const f = fakeDb(
      {
        schedule_closures: [{ data: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] }, { data: [] }],
        event_series: [{ data: [{ id: S1, edition_id: ED, rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO' }] }, { data: [seriesRow] }],
        schedule_editions: { data: [editionRow] },
      },
      { schedule_occurrences_sync: { data: [{ inserted: 0, updated: 0, removed: 1 }] } },
    )
    const out = await createCourseScheduleStore(f.db).saveClosure({ projectId: P, editionId: ED, startsOn: '2026-12-18', endsOn: '2027-01-06', label: { en: 'Holidays' } })
    expect(out.resynced).toBe(1)
    expect(f.rpcCalls.map((c) => c[0])).toEqual(['schedule_occurrences_sync'])
    const resync = f.calls.find((c) => c.table === 'event_series')!
    expect(resync.ops).toContainEqual(['eq', 'owner_type', 'course'])
    expect(resync.ops).toContainEqual(['in', 'edition_id', [ED]])
  })

  it('removeClosure tombstones (never deletes) and refuses an unknown one', async () => {
    const f = fakeDb({ schedule_closures: { data: [] } })
    const e = await createCourseScheduleStore(f.db).removeClosure(P, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc').catch((x) => x)
    expect(e.code).toBe('not_found')
    expect(f.calls[0].ops[0][0]).toBe('update')
    expect(f.calls[0].ops.some((o) => o[0] === 'delete')).toBe(false)
  })

  it('saveMeetingRoom accepts https links only and trims; rooms stay project-scoped', async () => {
    const f = fakeDb({ schedule_meeting_rooms: { data: [{ id: ROOM, version: 1 }] } })
    const store = createCourseScheduleStore(f.db)
    await store.saveMeetingRoom({ projectId: P, label: ' Room 1 ', joinUrl: 'https://zoom.example/j/1', meetingId: '123 456', passcode: 'abc' })
    expect(f.calls[0].ops[0]).toEqual(['insert', { project_id: P, label: 'Room 1', join_url: 'https://zoom.example/j/1', meeting_id: '123 456', passcode: 'abc', note: null }])
    await invalid(store.saveMeetingRoom({ projectId: P, label: 'x', joinUrl: 'http://zoom.example' }))
    await invalid(store.saveMeetingRoom({ projectId: P, label: 'x', joinUrl: 'javascript:alert(1)' }))
    await invalid(store.saveMeetingRoom({ projectId: P, label: '' }))
    await invalid(store.saveMeetingRoom({ projectId: P, label: 'x'.repeat(81) }))
    await invalid(store.saveMeetingRoom({ projectId: P, label: 'x', passcode: 'p'.repeat(41) }))
  })

  it('meetingRoomsById is scoped by project, ignores bad ids and is keyed by id', async () => {
    const f = fakeDb({ schedule_meeting_rooms: { data: [{ id: ROOM, label: 'Room 1', join_url: 'https://zoom.example/j/1', meeting_id: '1', passcode: 'p', note: null, version: 2 }] } })
    const map = await createCourseScheduleStore(f.db).meetingRoomsById(P, [ROOM, 'nope', ROOM])
    expect(map.get(ROOM)).toMatchObject({ label: 'Room 1', joinUrl: 'https://zoom.example/j/1', passcode: 'p' })
    expect(f.calls[0].ops).toContainEqual(['eq', 'project_id', P])
    expect(f.calls[0].ops).toContainEqual(['in', 'id', [ROOM]])
    expect((await createCourseScheduleStore(f.db).meetingRoomsById(P, ['nope'])).size).toBe(0)
  })
})
