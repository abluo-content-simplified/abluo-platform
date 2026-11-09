/**
 * Course schedules in the client dashboard (ADR-045): permission refusals happen
 * BEFORE any I/O, identity comes from the grant, only the grant's project is
 * reachable, meeting details reach only courses.meeting.manage, and the views
 * are mapped for the screens. Fake store, fake Sanity client — no network.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  courseScheduleDeps,
  endClass,
  listClasses,
  listMeetingRooms,
  listOccurrences,
  removeClosure,
  removeEdition,
  removeMeetingRoom,
  saveClass,
  saveClosure,
  saveEdition,
  saveMeetingRoom,
  searchTeachers,
  timetable,
  updateOccurrence,
} from '../course-schedule'
import { CourseError } from '../course-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { CourseScheduleStore } from '@/lib/scheduling/course-store'
import type { ClassOccurrence, ClassSeries, MeetingRoom } from '@/lib/scheduling/types'

const PID = '11111111-1111-4111-8111-111111111111'
const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_COURSE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SERIES = '55555555-5555-4555-8555-555555555555'
const FOREIGN_SERIES = '66666666-6666-4666-8666-666666666666'
const OCC = '99999999-9999-4999-8999-999999999999'
const PERSON = '77777777-7777-4777-8777-777777777777'
const PERSON2 = '78787878-7878-4878-8878-787878787878'
const EDITION = '44444444-4444-4444-8444-444444444444'
const ROOM = '33333333-3333-4333-8333-333333333333'
const VENUE = '88888888-8888-4888-8888-888888888888'

const ALL = ['courses.course.read', 'courses.course.write', 'courses.course.delete', 'courses.schedule.write', 'courses.meeting.manage']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['courses'],
  ...o,
})
const owner = () => grant()
const editor = () => grant({ role: 'editor', permissions: ['courses.course.read', 'courses.course.write', 'courses.schedule.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['courses.course.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

const series = (o: Partial<ClassSeries> = {}): ClassSeries => ({
  id: SERIES,
  ownerType: 'course',
  ownerPublicId: COURSE,
  editionId: EDITION,
  timeZone: 'Europe/Brussels',
  startLocal: '2026-12-08T18:00',
  endLocal: '2026-12-08T19:15',
  rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
  weekday: 2,
  interval: 1,
  startsOn: '2026-12-08',
  endsOn: null,
  place: { kind: 'location', key: 'brey' },
  attendanceMode: 'mixed',
  instructorPublicIds: [PERSON],
  languages: ['fr', 'en'],
  meetingRoomId: ROOM,
  status: 'active',
  version: 3,
  ...o,
})

const occurrence = (o: Partial<ClassOccurrence> = {}): ClassOccurrence => ({
  id: OCC,
  seriesId: SERIES,
  ownerType: 'course',
  ownerPublicId: COURSE,
  originalStartLocal: '2026-12-15T18:00',
  isModified: false,
  startLocal: '2026-12-15T18:00',
  endLocal: '2026-12-15T19:15',
  timeZone: 'Europe/Brussels',
  startsAt: '2026-12-15T17:00:00.000Z',
  endsAt: '2026-12-15T18:15:00.000Z',
  status: 'scheduled',
  place: { kind: 'location', key: 'brey' },
  attendanceMode: 'mixed',
  instructorPublicIds: [PERSON],
  note: null,
  version: 1,
  languages: ['fr', 'en'],
  meetingRoomId: ROOM,
  ...o,
})

const room: MeetingRoom = { id: ROOM, label: 'Zoom A', joinUrl: 'https://zoom.example/j/1', meetingId: '123 456', passcode: 'secret', note: null, version: 2 }

function fakeStore(over: Partial<Record<keyof CourseScheduleStore, unknown>> = {}) {
  const store = {
    listSeries: vi.fn(async (_p: string, opts?: { ownerPublicIds?: string[]; editionId?: string | null }) => {
      const all = [series(), series({ id: FOREIGN_SERIES, ownerPublicId: OTHER_COURSE, editionId: null, meetingRoomId: null })]
      return all.filter((s) => (!opts?.ownerPublicIds || opts.ownerPublicIds.includes(s.ownerPublicId)) && (opts?.editionId === undefined || s.editionId === opts.editionId))
    }),
    saveSeries: vi.fn(async () => ({ seriesId: SERIES, version: 4 })),
    endSeries: vi.fn(async () => 7),
    syncSeries: vi.fn(async () => ({ inserted: 5, updated: 0, removed: 0, truncated: false, modifiedOutsideRule: [] as string[] })),
    updateOccurrence: vi.fn(async () => 2),
    occurrencesInWindow: vi.fn(async () => [occurrence()]),
    listEditions: vi.fn(async () => [{ id: EDITION, ownerType: null, ownerPublicId: null, label: { fr: 'Automne', en: 'Autumn' }, startsOn: '2026-09-01', endsOn: '2026-12-17', timeZone: 'Europe/Brussels', version: 1 }]),
    saveEdition: vi.fn(async () => ({ id: EDITION, version: 2 })),
    removeEdition: vi.fn(async () => undefined),
    listClosures: vi.fn(async () => [{ id: 'cl1', editionId: null, startsOn: '2026-12-18', endsOn: '2027-01-06', label: { fr: 'Noël' } }]),
    saveClosure: vi.fn(async () => ({ id: 'cl1', resynced: 2 })),
    removeClosure: vi.fn(async () => ({ resynced: 2 })),
    listMeetingRooms: vi.fn(async () => [room]),
    saveMeetingRoom: vi.fn(async () => ({ id: ROOM, version: 3 })),
    removeMeetingRoom: vi.fn(async () => undefined),
    meetingRoomsById: vi.fn(async () => new Map()),
    ...over,
  }
  return store as unknown as CourseScheduleStore & typeof store
}

const SITE = { defaultLocale: 'fr', supportedLocales: ['fr', 'en'], timeZone: 'Europe/Brussels' }
function fakeClient(opts: { courseExists?: boolean; site?: unknown } = {}) {
  const fetch = vi.fn(async (query: string) => {
    if (query.includes('count(*[_type == "course"')) return opts.courseExists === false ? 0 : 1
    if (query.includes('.locations[].key')) return ['brey', 'l51']
    if (query.includes('count(*[_type == "eventVenue"')) return 1
    if (query.includes('"locations": *[_type == "siteConfig"')) {
      return { locations: [{ key: 'brey', name: { fr: 'Brey', _type: 'localizedString' } }], venues: [{ publicId: VENUE, name: { en: 'Hall' } }] }
    }
    if (query.includes('_type == "siteConfig"')) return opts.site === undefined ? SITE : opts.site
    if (query.includes('_type == "person"') && query.includes('publicId in $ids')) return [{ _id: 'p1', publicId: PERSON, firstName: 'Sabrina', lastName: 'Rossi' }]
    if (query.includes('_type == "course"') && query.includes('publicId in $ids')) {
      return [{ _id: 'iyengar', publicId: COURSE, title: { fr: 'Yoga Iyengar' } }]
    }
    if (query.includes('_type == "person"')) {
      return [
        { _id: 'p1', publicId: PERSON, firstName: 'Sabrina', lastName: 'Rossi', jobTitle: { fr: 'Prof' }, photoUrl: null },
        { _id: 'p2', publicId: PERSON2, firstName: 'Marc', lastName: 'Dupont', archivedAt: '2026-01-01' },
        { _id: 'drafts.p3', publicId: '79797979-7979-4979-8979-797979797979', displayName: 'Anna Blanc' },
      ]
    }
    return null
  })
  return { fetch }
}

const deps = (store = fakeStore(), client = fakeClient()) => ({ store, client, assertPeople: vi.fn(async () => undefined) })
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as CourseError | null)?.code

const NEW_CLASS = {
  seriesId: null,
  courseId: COURSE,
  editionId: EDITION,
  weekday: 2,
  startTime: '18:00',
  endTime: '19:15',
  startsOn: '2026-12-08',
  placeToken: 'location:brey',
  attendanceMode: 'mixed' as const,
  instructorPublicIds: [PERSON],
  languages: ['fr', 'en'],
  meetingRoomId: ROOM,
  expectedVersion: null,
}

describe('permissions are checked before any I/O', () => {
  it('a viewer reads but never writes', async () => {
    const d = deps()
    const c = ctx(viewer())
    const refusals = [
      saveClass(c, PID, NEW_CLASS, d),
      endClass(c, PID, { seriesId: SERIES, expectedVersion: 3 }, d),
      updateOccurrence(c, PID, { seriesId: SERIES, occurrenceId: OCC, expectedVersion: 1, cancelled: true }, d),
      saveEdition(c, PID, { label: { fr: 'x' }, startsOn: '2026-09-01', endsOn: '2026-12-17' }, d),
      removeEdition(c, PID, { id: EDITION, expectedVersion: 1 }, d),
      saveClosure(c, PID, { startsOn: '2026-12-18', endsOn: '2027-01-06', label: { fr: 'Noël' } }, d),
      removeClosure(c, PID, { id: ROOM }, d),
      searchTeachers(c, PID, {}, d),
    ]
    for (const p of refusals) await expect(p).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(d.store.saveSeries).not.toHaveBeenCalled()
    expect(d.store.listSeries).not.toHaveBeenCalled()
    expect(d.client.fetch).not.toHaveBeenCalled()
    await expect(listClasses(c, PID, { courseId: COURSE }, d)).resolves.toBeTruthy()
  })

  it('an editor (schedule.write) cannot manage meeting rooms', async () => {
    const d = deps()
    const c = ctx(editor())
    await expect(saveMeetingRoom(c, PID, { label: 'Zoom' }, d)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(removeMeetingRoom(c, PID, { id: ROOM, expectedVersion: 1 }, d)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(d.store.saveMeetingRoom).not.toHaveBeenCalled()
    expect(d.store.removeMeetingRoom).not.toHaveBeenCalled()
  })

  it('a project the caller has no grant for, or without the module, is refused', async () => {
    const d = deps()
    await expect(listClasses(ctx(owner()), '22222222-2222-4222-8222-222222222222', { courseId: COURSE }, d)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(timetable(ctx(grant({ enabledModuleIds: [] })), PID, {}, d)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(d.store.listSeries).not.toHaveBeenCalled()
  })
})

describe('the Classes panel', () => {
  it('maps a course\'s classes for the screen (times, place token, people, room label)', async () => {
    const d = deps()
    const r = await listClasses(ctx(editor()), PID, { courseId: COURSE.toUpperCase() }, d)
    expect(d.store.listSeries).toHaveBeenCalledWith(PID, { ownerPublicIds: [COURSE] })
    expect(r.classes).toHaveLength(1)
    expect(r.classes[0]).toMatchObject({
      id: SERIES,
      courseId: COURSE,
      weekday: 2,
      startTime: '18:00',
      endTime: '19:15',
      placeToken: 'location:brey',
      attendanceMode: 'mixed',
      languages: ['fr', 'en'],
      meetingRoomLabel: 'Zoom A',
      instructors: [{ publicId: PERSON, name: 'Sabrina Rossi' }],
      version: 3,
    })
    expect(r.site).toEqual({ defaultLocale: 'fr', languages: ['fr', 'en'], timeZone: 'Europe/Brussels' })
    expect(r.places).toEqual([
      { token: 'location:brey', name: 'Brey', kind: 'location', short: null },
      { token: `venue:${VENUE}`, name: 'Hall', kind: 'venue' },
    ])
    expect(r.editions[0].label.en).toBe('Autumn')
  })

  it('meeting details are not part of the panel for an editor, but are for the owner', async () => {
    const forEditor = await listClasses(ctx(editor()), PID, { courseId: COURSE }, deps())
    expect(forEditor.canManageRooms).toBe(false)
    expect(forEditor.rooms).toEqual([{ id: ROOM, label: 'Zoom A' }])
    expect(JSON.stringify(forEditor)).not.toMatch(/secret|zoom\.example|123 456/)
    const forOwner = await listClasses(ctx(owner()), PID, { courseId: COURSE }, deps())
    expect(forOwner.rooms[0]).toMatchObject({ joinUrl: 'https://zoom.example/j/1', passcode: 'secret', version: 2 })
  })

  it('saving a class: identity from the grant, the course/place/people are guarded, the zone is the site\'s', async () => {
    const d = deps()
    const r = await saveClass(ctx(editor()), PID, { ...NEW_CLASS, timeZone: 'Asia/Tokyo' }, d)
    expect(r).toEqual({ seriesId: SERIES, version: 4, truncated: false, keptEdited: 0 })
    expect(d.store.saveSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PID,
        seriesId: null,
        ownerType: 'course',
        ownerPublicId: COURSE,
        editionId: EDITION,
        timeZone: 'Europe/Brussels',
        weekday: 2,
        startTime: '18:00',
        endTime: '19:15',
        place: { kind: 'location', key: 'brey' },
        attendanceMode: 'mixed',
        instructorPublicIds: [PERSON],
        languages: ['fr', 'en'],
        meetingRoomId: ROOM,
        expectedVersion: null,
        actorId: 'u1',
      })
    )
    expect(d.store.syncSeries).toHaveBeenCalledWith(PID, SERIES)
    expect(d.assertPeople).toHaveBeenCalledWith('cyce', [PERSON])
    // the course check ran against the grant's slug
    expect(d.client.fetch).toHaveBeenCalledWith(expect.stringContaining('count(*[_type == "course"'), { projectSlug: 'cyce', id: COURSE }, { perspective: 'raw' })
  })

  it('reports edited dates kept outside the rule and a truncated expansion', async () => {
    const store = fakeStore({ syncSeries: vi.fn(async () => ({ inserted: 0, updated: 0, removed: 0, truncated: true, modifiedOutsideRule: ['a', 'b'] })) })
    const r = await saveClass(ctx(editor()), PID, NEW_CLASS, deps(store))
    expect(r).toMatchObject({ truncated: true, keptEdited: 2 })
  })

  it('passes the repeat preset on, and refuses one that is not a preset', async () => {
    const store = fakeStore()
    await saveClass(ctx(editor()), PID, { ...NEW_CLASS, repeat: { kind: 'weekly', weekdays: [1, 3], interval: 2 } }, deps(store))
    expect(store.saveSeries).toHaveBeenCalledWith(expect.objectContaining({ repeat: { kind: 'weekly', weekdays: [1, 3], interval: 2 } }))
    const junk = { kind: 'weekly', weekdays: 'MO', interval: 1 } as never
    const other = fakeStore()
    expect(await code(saveClass(ctx(editor()), PID, { ...NEW_CLASS, repeat: junk }, deps(other)))).toBe('invalid_value')
    expect(other.saveSeries).not.toHaveBeenCalled()
  })

  it('reports a class outside its term with its own code', async () => {
    const { ScheduleError } = await import('@/lib/scheduling/types')
    const store = fakeStore({ saveSeries: vi.fn(async () => { throw new ScheduleError('outside_term', 'x') }) })
    expect(await code(saveClass(ctx(editor()), PID, NEW_CLASS, deps(store)))).toBe('outside_term')
  })

  it('refuses a course, place or person that is not this website\'s, before saving', async () => {
    const foreignCourse = deps(fakeStore(), fakeClient({ courseExists: false }))
    expect(await code(saveClass(ctx(editor()), PID, NEW_CLASS, foreignCourse))).toBe('invalid_value')
    expect(foreignCourse.store.saveSeries).not.toHaveBeenCalled()

    const badPlace = deps()
    expect(await code(saveClass(ctx(editor()), PID, { ...NEW_CLASS, placeToken: 'location:elsewhere' }, badPlace))).toBe('invalid_value')
    expect(await code(saveClass(ctx(editor()), PID, { ...NEW_CLASS, placeToken: 'nonsense' }, badPlace))).toBe('invalid_value')
    expect(badPlace.store.saveSeries).not.toHaveBeenCalled()

    const { PersonError } = await import('../persons-lifecycle')
    const badPerson = { ...deps(), assertPeople: vi.fn(async () => { throw new PersonError('invalid_value', 'no') }) }
    expect(await code(saveClass(ctx(editor()), PID, NEW_CLASS, badPerson))).toBe('invalid_value')
    expect(badPerson.store.saveSeries).not.toHaveBeenCalled()
  })

  it('editing needs the class to be THIS course\'s in this project', async () => {
    const d = deps()
    const edit = { ...NEW_CLASS, seriesId: FOREIGN_SERIES, expectedVersion: 3 }
    expect(await code(saveClass(ctx(editor()), PID, edit, d))).toBe('not_found')
    expect(await code(saveClass(ctx(editor()), PID, { ...NEW_CLASS, seriesId: '12345678-1234-4234-8234-123456789012', expectedVersion: 1 }, d))).toBe('not_found')
    expect(d.store.saveSeries).not.toHaveBeenCalled()
    await expect(saveClass(ctx(editor()), PID, { ...NEW_CLASS, seriesId: SERIES, expectedVersion: 3 }, d)).resolves.toBeTruthy()
    // an existing class keeps its own zone
    expect(d.store.saveSeries).toHaveBeenCalledWith(expect.objectContaining({ seriesId: SERIES, timeZone: 'Europe/Brussels' }))
  })

  it('rejects malformed input as invalid_value, scheduling errors map to opaque codes', async () => {
    const d = deps()
    for (const bad of [{ startTime: '25:00' }, { endTime: 'x' }, { startsOn: '2026-13-40' }, { courseId: 'nope' }, { editionId: 'nope' }]) {
      expect(await code(saveClass(ctx(editor()), PID, { ...NEW_CLASS, ...bad }, d))).toBe('invalid_value')
    }
    const { ScheduleError } = await import('@/lib/scheduling/types')
    const conflict = deps(fakeStore({ saveSeries: vi.fn(async () => { throw new ScheduleError('conflict', 'x') }) }))
    expect(await code(saveClass(ctx(editor()), PID, NEW_CLASS, conflict))).toBe('conflict')
    const down = deps(fakeStore({ saveSeries: vi.fn(async () => { throw new ScheduleError('unavailable', 'x') }) }))
    expect(await code(saveClass(ctx(editor()), PID, NEW_CLASS, down))).toBe('failed')
  })

  it('ending a class needs it to exist in this project', async () => {
    const d = deps()
    expect(await code(endClass(ctx(editor()), PID, { seriesId: '12345678-1234-4234-8234-123456789012', expectedVersion: 1 }, d))).toBe('not_found')
    expect(d.store.endSeries).not.toHaveBeenCalled()
    await expect(endClass(ctx(editor()), PID, { seriesId: SERIES, expectedVersion: 3 }, d)).resolves.toEqual({ removed: 7 })
    expect(d.store.endSeries).toHaveBeenCalledWith(PID, SERIES, 3)
  })
})

describe('the Timetable', () => {
  it('lists the site\'s classes with course titles, closures and a count of changed dates', async () => {
    const store = fakeStore({
      occurrencesInWindow: vi.fn(async () => [
        occurrence({ status: 'cancelled' }),
        occurrence({ id: 'o2', isModified: true }),
        occurrence({ id: 'o3' }),
        occurrence({ id: 'o4', seriesId: 'gone', status: 'cancelled' }),
      ]),
    })
    const d = deps(store)
    const r = await timetable(ctx(editor()), PID, { window: { from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' } }, d)
    expect(store.listSeries).toHaveBeenCalledWith(PID, {})
    expect(store.occurrencesInWindow).toHaveBeenCalledWith(PID, { from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' })
    expect(r.classes.map((c) => c.id).sort()).toEqual([FOREIGN_SERIES, SERIES].sort())
    expect(r.courses[COURSE]).toBe('Yoga Iyengar')
    expect(r.exceptions).toEqual({ [SERIES]: 2 })
    expect(r.closures[0]).toMatchObject({ startsOn: '2026-12-18', endsOn: '2027-01-06' })
    expect(r.canManageRooms).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(/secret|zoom\.example/)
  })

  it('defaults the window to the next 8 weeks and rejects a bad one', async () => {
    const store = fakeStore()
    const now = () => new Date('2026-11-04T10:00:00Z')
    await timetable(ctx(viewer()), PID, {}, { ...deps(store), now })
    expect(store.occurrencesInWindow).toHaveBeenCalledWith(PID, { from: '2026-11-04T10:00:00.000Z', to: '2026-12-30T10:00:00.000Z' })
    expect(await code(timetable(ctx(viewer()), PID, { window: { from: '2026-12-01', to: '2026-11-01' } }, deps()))).toBe('invalid_value')
    expect(await code(timetable(ctx(viewer()), PID, { editionId: 'nope' }, deps()))).toBe('invalid_value')
  })

  it('shows the owner the room details and everyone else the label', async () => {
    const o = await timetable(ctx(owner()), PID, {}, deps())
    expect(o.canManageRooms).toBe(true)
    expect(o.rooms[0].passcode).toBe('secret')
    const e = await listMeetingRooms(ctx(editor()), PID, deps())
    expect(e).toEqual({ rooms: [{ id: ROOM, label: 'Zoom A' }], canManage: false })
  })

  it('lists a class\'s upcoming dates, flags substitutes, and pages', async () => {
    const store = fakeStore({
      occurrencesInWindow: vi.fn(async () => [
        occurrence({ instructorPublicIds: [PERSON2] }),
        occurrence({ id: 'o2', status: 'cancelled' }),
        occurrence({ id: 'o3', seriesId: FOREIGN_SERIES }),
        occurrence({ id: 'o4' }),
      ]),
    })
    const d = deps(store)
    const r = await listOccurrences(ctx(viewer()), PID, { seriesId: SERIES, from: '2026-12-01', count: 2 }, d)
    expect(store.occurrencesInWindow).toHaveBeenCalledWith(PID, expect.objectContaining({ ownerPublicIds: [COURSE] }))
    expect(r.occurrences.map((o) => o.id)).toEqual([OCC, 'o2'])
    expect(r.hasMore).toBe(true)
    expect(r.occurrences[0]).toMatchObject({ date: '2026-12-15', startTime: '18:00', endTime: '19:15', substituted: true, cancelled: false })
    expect(r.occurrences[1]).toMatchObject({ cancelled: true, substituted: false })
    expect(await code(listOccurrences(ctx(viewer()), PID, { seriesId: 'nope' }, d))).toBe('not_found')
    expect(await code(listOccurrences(ctx(viewer()), PID, { seriesId: SERIES, from: 'garbage' }, d))).toBe('invalid_value')
  })

  it('searches teachers for a writer: no archived people, drafts included', async () => {
    const found = await searchTeachers(ctx(editor()), PID, { query: 'a' }, deps())
    expect(found.map((p) => p.name).sort()).toEqual(['Anna Blanc', 'Sabrina Rossi'])
    expect((await searchTeachers(ctx(editor()), PID, { query: 'anna' }, deps())).map((p) => p.name)).toEqual(['Anna Blanc'])
  })
})

describe('one date', () => {
  const base = { seriesId: SERIES, occurrenceId: OCC, expectedVersion: 1 }

  it('cancels and restores', async () => {
    const d = deps()
    await expect(updateOccurrence(ctx(editor()), PID, { ...base, cancelled: true }, d)).resolves.toEqual({ version: 2 })
    expect(d.store.updateOccurrence).toHaveBeenCalledWith({ projectId: PID, occurrenceId: OCC, expectedVersion: 1, status: 'cancelled' })
    await updateOccurrence(ctx(editor()), PID, { ...base, cancelled: false }, d)
    expect(d.store.updateOccurrence).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'scheduled' }))
  })

  it('substitutes teachers (checked), or goes back to the class\'s', async () => {
    const d = deps()
    await updateOccurrence(ctx(editor()), PID, { ...base, instructorPublicIds: [PERSON2] }, d)
    expect(d.assertPeople).toHaveBeenCalledWith('cyce', [PERSON2])
    expect(d.store.updateOccurrence).toHaveBeenCalledWith(expect.objectContaining({ instructorPublicIds: [PERSON2] }))
    await updateOccurrence(ctx(editor()), PID, { ...base, clearInstructors: true }, d)
    expect(d.store.updateOccurrence).toHaveBeenLastCalledWith(expect.objectContaining({ clearInstructors: true }))
    const { PersonError } = await import('../persons-lifecycle')
    const bad = { ...deps(), assertPeople: vi.fn(async () => { throw new PersonError('invalid_value', 'no') }) }
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, instructorPublicIds: [PERSON2] }, bad))).toBe('invalid_value')
    expect(bad.store.updateOccurrence).not.toHaveBeenCalled()
  })

  it('changes the time in the class\'s zone, and a note only in the site\'s languages', async () => {
    const d = deps()
    await updateOccurrence(ctx(editor()), PID, { ...base, time: { date: '2026-12-15', startTime: '19:00', endTime: null } }, d)
    expect(d.store.updateOccurrence).toHaveBeenCalledWith(expect.objectContaining({ times: { timeZone: 'Europe/Brussels', startLocal: '2026-12-15T19:00', endLocal: null } }))
    await updateOccurrence(ctx(editor()), PID, { ...base, note: { fr: '  Apportez un tapis ', en: '' } }, d)
    expect(d.store.updateOccurrence).toHaveBeenLastCalledWith(expect.objectContaining({ note: { fr: 'Apportez un tapis' } }))
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, note: { de: 'x' } }, d))).toBe('invalid_value')
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, time: { date: 'x', startTime: '19:00', endTime: null } }, d))).toBe('invalid_value')
  })

  it('needs a class of this project and a version', async () => {
    const d = deps()
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, seriesId: '12345678-1234-4234-8234-123456789012', cancelled: true }, d))).toBe('not_found')
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, expectedVersion: Number.NaN, cancelled: true }, d))).toBe('invalid_value')
    expect(await code(updateOccurrence(ctx(editor()), PID, { ...base, occurrenceId: 'x', cancelled: true }, d))).toBe('invalid_value')
    expect(d.store.updateOccurrence).not.toHaveBeenCalled()
  })
})

describe('terms, holidays and rooms', () => {
  it('saves a term with the site\'s zone and a main-language name', async () => {
    const d = deps()
    await expect(saveEdition(ctx(editor()), PID, { label: { fr: 'Automne', en: 'Autumn' }, startsOn: '2026-09-01', endsOn: '2026-12-17' }, d)).resolves.toEqual({ id: EDITION, version: 2 })
    expect(d.store.saveEdition).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PID, ownerType: null, ownerPublicId: null, timeZone: 'Europe/Brussels', label: { fr: 'Automne', en: 'Autumn' } })
    )
    expect(await code(saveEdition(ctx(editor()), PID, { label: { en: 'Autumn' }, startsOn: '2026-09-01', endsOn: '2026-12-17' }, d))).toBe('missing_title')
    expect(await code(saveEdition(ctx(editor()), PID, { label: { fr: 'x' }, startsOn: 'bad', endsOn: '2026-12-17' }, d))).toBe('invalid_value')
  })

  it('a term with classes cannot be removed (in_use), an empty one can', async () => {
    const d = deps()
    expect(await code(removeEdition(ctx(editor()), PID, { id: EDITION, expectedVersion: 1 }, d))).toBe('in_use')
    expect(d.store.removeEdition).not.toHaveBeenCalled()
    const empty = deps(fakeStore({ listSeries: vi.fn(async () => []) }))
    await removeEdition(ctx(editor()), PID, { id: EDITION, expectedVersion: 1 }, empty)
    expect(empty.store.removeEdition).toHaveBeenCalledWith(PID, EDITION, 1)
  })

  it('holidays: a name in the main language, a term of this project, regenerated classes', async () => {
    const d = deps()
    await expect(saveClosure(ctx(editor()), PID, { startsOn: '2026-12-18', endsOn: '2027-01-06', label: { fr: 'Noël' } }, d)).resolves.toEqual({ id: 'cl1', resynced: 2 })
    expect(d.store.saveClosure).toHaveBeenCalledWith({ projectId: PID, id: null, editionId: null, startsOn: '2026-12-18', endsOn: '2027-01-06', label: { fr: 'Noël' } })
    expect(await code(saveClosure(ctx(editor()), PID, { startsOn: '2026-12-18', endsOn: '2027-01-06', label: { en: 'Xmas' } }, d))).toBe('missing_title')
    expect(await code(saveClosure(ctx(editor()), PID, { editionId: '12345678-1234-4234-8234-123456789012', startsOn: '2026-12-18', endsOn: '2027-01-06', label: { fr: 'x' } }, d))).toBe('invalid_value')
    await expect(removeClosure(ctx(editor()), PID, { id: 'cl1' }, d)).rejects.toBeInstanceOf(CourseError)
    await expect(removeClosure(ctx(editor()), PID, { id: ROOM }, d)).resolves.toEqual({ resynced: 2 })
  })

  it('rooms: only the owner writes; a room used by classes cannot be removed', async () => {
    const d = deps()
    await expect(saveMeetingRoom(ctx(owner()), PID, { label: 'Zoom B', joinUrl: 'https://zoom.example/j/2', passcode: 'p' }, d)).resolves.toEqual({ id: ROOM, version: 3 })
    expect(d.store.saveMeetingRoom).toHaveBeenCalledWith(expect.objectContaining({ projectId: PID, label: 'Zoom B', expectedVersion: null }))
    expect(await code(removeMeetingRoom(ctx(owner()), PID, { id: ROOM, expectedVersion: 2 }, d))).toBe('in_use')
    expect(d.store.removeMeetingRoom).not.toHaveBeenCalled()
    const free = deps(fakeStore({ listSeries: vi.fn(async () => [series({ meetingRoomId: null })]) }))
    await removeMeetingRoom(ctx(owner()), PID, { id: ROOM, expectedVersion: 2 }, free)
    expect(free.store.removeMeetingRoom).toHaveBeenCalledWith(PID, ROOM, 2)
  })
})

describe('hooks for the Courses list and delete', () => {
  it('hasSchedule: a live class means yes; scoped to the project', async () => {
    const store = fakeStore()
    const h = courseScheduleDeps('cyce', { store, client: fakeClient() })
    await expect(h.hasSchedule(COURSE, PID)).resolves.toBe(true)
    expect(store.listSeries).toHaveBeenCalledWith(PID, { ownerPublicIds: [COURSE] })
    await expect(h.hasSchedule('21212121-2121-4121-8121-212121212121', PID)).resolves.toBe(false)
    await expect(h.hasSchedule('not-a-uuid', PID)).resolves.toBe(false)
  })

  it('scheduleSummary: classes, teachers and the next scheduled class per course', async () => {
    const store = fakeStore({
      occurrencesInWindow: vi.fn(async () => [occurrence({ status: 'cancelled', startsAt: '2026-12-08T17:00:00.000Z' }), occurrence({ id: 'o2', startsAt: '2026-12-15T17:00:00.000Z' })]),
    })
    const h = courseScheduleDeps('cyce', { store, client: fakeClient(), now: () => new Date('2026-12-01T00:00:00Z') })
    const m = (await h.scheduleSummary(PID, [COURSE, OTHER_COURSE, 'x']))!
    expect(m.get(COURSE)).toMatchObject({ classes: 1, teachers: ['Sabrina Rossi'], nextClassAt: '2026-12-15T17:00:00.000Z' })
    expect(m.get(OTHER_COURSE)).toMatchObject({ classes: 1, teachers: ['Sabrina Rossi'], nextClassAt: null })
    expect((await h.scheduleSummary(PID, []))!.size).toBe(0)
  })

  it('scheduleSummary for the list: weekly lines, the dates that differ, the last class date and the next class', async () => {
    const store = fakeStore({
      occurrencesInWindow: vi.fn(async () => [
        occurrence({ id: 'o1', status: 'cancelled', startLocal: '2026-12-08T18:00', originalStartLocal: '2026-12-08T18:00', startsAt: '2026-12-08T17:00:00.000Z', endsAt: '2026-12-08T18:15:00.000Z' }),
        occurrence({ id: 'o2', startLocal: '2026-12-15T18:00', instructorPublicIds: [PERSON2], version: 4 }),
        occurrence({ id: 'o3', startLocal: '2026-12-22T18:00', originalStartLocal: '2026-12-22T18:00', startsAt: '2026-12-22T17:00:00.000Z', place: { kind: 'location', key: 'l51' } }),
      ]),
    })
    const h = courseScheduleDeps('cyce', { store, client: fakeClient(), now: () => new Date('2026-12-10T00:00:00Z') })
    const m = (await h.scheduleSummary(PID, [COURSE]))!.get(COURSE)!
    // Tuesdays 18:00 at Brey; the class's term ends 17 Dec → the last Tuesday on or before it.
    expect(m.slots).toEqual([{ seriesId: SERIES, weekday: 2, startTime: '18:00', placeToken: 'location:brey', mode: 'mixed' }])
    expect(m.lastDate).toBe('2026-12-15')
    expect(m.openEnded).toBe(false)
    expect(m.termIds).toEqual([EDITION])
    expect(m.languages).toEqual(['fr', 'en'])
    expect(m.teacherRefs).toEqual([{ publicId: PERSON, name: 'Sabrina Rossi' }])
    expect(m.exceptions).toEqual([
      { date: '2026-12-08', startTime: '18:00', kind: 'cancelled', placeToken: 'location:brey' },
      { date: '2026-12-15', startTime: '18:00', kind: 'substitute', placeToken: 'location:brey' },
      { date: '2026-12-22', startTime: '18:00', kind: 'moved', placeToken: 'location:l51' },
    ])
    expect(m.next).toMatchObject({ seriesId: SERIES, occurrenceId: 'o2', version: 4, date: '2026-12-15', startTime: '18:00', substituted: true, seriesPlaceToken: 'location:brey' })
    expect(m.next!.seriesInstructors).toEqual([{ publicId: PERSON, name: 'Sabrina Rossi' }])
    // From about a week back (this week's changes), project-scoped.
    expect(store.occurrencesInWindow).toHaveBeenCalledWith(PID, expect.objectContaining({ from: '2026-12-02T00:00:00.000Z', ownerPublicIds: [COURSE] }))
  })

  it('scheduleOverview: the site’s places with short names, and its site-wide terms', async () => {
    const h = courseScheduleDeps('cyce', { store: fakeStore(), client: fakeClient() })
    const o = await h.scheduleOverview(PID)
    expect(o.terms).toEqual([{ id: EDITION, label: 'Automne', startsOn: '2026-09-01', endsOn: '2026-12-17' }])
    expect(o.places[0]).toMatchObject({ token: 'location:brey', name: 'Brey' })
  })
})
