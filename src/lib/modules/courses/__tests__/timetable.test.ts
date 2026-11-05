import { describe, expect, it } from 'vitest'
import {
  addMonths,
  buildPrintMonth,
  coveredMonths,
  exceptionsOf,
  mergeTimetables,
  monthRange,
  monthWeeks,
  onlineDetailsAllowed,
  patternOccursOn,
  shapeTimetable,
  todayIn,
  weekStart,
  type ShapeInput,
} from '../timetable'
import { CLOSURES, COURSES, COURSE_A, COURSE_B, LOCATIONS, OCCURRENCES, P1, P2, PEOPLE, P_OFF, ROOM, ROOMS, SERIES, S1, S2, WINDOW, series } from './timetable-fixtures'

const input = (over: Partial<ShapeInput> = {}): ShapeInput => ({
  window: WINDOW,
  locale: 'fr',
  defaultLocale: 'en',
  timeZone: 'Europe/Brussels',
  courses: COURSES,
  occurrences: OCCURRENCES,
  series: SERIES,
  closures: CLOSURES,
  people: PEOPLE,
  siteLocations: LOCATIONS,
  venues: [],
  rooms: ROOMS,
  includeOnlineDetails: false,
  ...over,
})

describe('onlineDetailsAllowed — the one privacy rule', () => {
  it('needs the section setting AND a protected page', () => {
    expect(onlineDetailsAllowed({ showOnlineDetails: true, pageProtected: true })).toBe(true)
    expect(onlineDetailsAllowed({ showOnlineDetails: true, pageProtected: false })).toBe(false)
    expect(onlineDetailsAllowed({ showOnlineDetails: false, pageProtected: true })).toBe(false)
  })
  it('is strict about truthiness: only the boolean true counts', () => {
    for (const bad of [undefined, null, 'true', 1, {}, []]) {
      expect(onlineDetailsAllowed({ showOnlineDetails: bad, pageProtected: true })).toBe(false)
      expect(onlineDetailsAllowed({ showOnlineDetails: true, pageProtected: bad })).toBe(false)
    }
  })
})

describe('shapeTimetable', () => {
  const data = shapeTimetable(input())

  it('keeps dated sessions in the window, in time order, cancelled ones included', () => {
    expect(data.occurrences.map((o) => `${o.date} ${o.start} ${o.status}`)).toEqual([
      '2026-12-03 18:00 scheduled',
      '2026-12-07 12:30 scheduled',
      '2026-12-08 12:30 scheduled',
      '2026-12-10 18:00 cancelled',
      '2026-12-14 12:30 scheduled',
      '2026-12-17 19:00 scheduled',
    ])
  })

  it('uses local dates and 24-hour times as stored (time change shows its own time)', () => {
    const o = data.occurrences.find((x) => x.id === 'o5')!
    expect([o.start, o.end]).toEqual(['19:00', '20:00'])
  })

  it('drops sessions outside the window and of courses that are not shown', () => {
    const d = shapeTimetable(input({ window: { from: '2026-12-08', to: '2026-12-10' }, courses: [COURSES[0]] }))
    expect(d.occurrences.map((o) => o.id)).toEqual(['o6'])
  })

  it('resolves the note for the content locale, then the default, then anything', () => {
    expect(data.occurrences.find((o) => o.id === 'o3')!.note).toBe('Professeure malade')
    const en = shapeTimetable(input({ locale: 'it', defaultLocale: 'en' }))
    expect(en.occurrences.find((o) => o.id === 'o3')!.note).toBe('Teacher ill')
  })

  it('shows the effective teachers (after override) and only teachers People can show', () => {
    expect(data.occurrences.find((o) => o.id === 'o2')!.teacherIds).toEqual([P2])
    const hidden = shapeTimetable(input({ people: [PEOPLE[0]] })) // P2 is off / anonymised: not returned by People
    expect(hidden.occurrences.find((o) => o.id === 'o2')!.teacherIds).toEqual([])
    expect(Object.keys(hidden.teachers)).toEqual([P1])
  })

  it('links a teacher only when the person has a page', () => {
    expect(data.teachers[P1]).toMatchObject({ name: 'Anna Rossi', hasPage: true, slug: 'anna-rossi' })
    expect(data.teachers[P2]).toMatchObject({ name: 'Sabrina', hasPage: false })
  })

  it('resolves places from the site locations, in their order, with address lines', () => {
    expect(data.places.brey).toEqual({ key: 'brey', name: 'BREY', lines: ['Avenue d’Auderghem 45', '1040 Etterbeek', 'Room 04, 4th floor'] })
    expect(data.placeOrder).toEqual(['brey']) // l51 is not used
    expect(data.series.find((s) => s.id === S2)!.placeKey).toBeNull() // online
  })

  it('an unknown place key becomes "no place", not a broken label', () => {
    const d = shapeTimetable(input({ series: [series({ id: S1, ownerPublicId: COURSE_A, place: { kind: 'location', key: 'gone' } })], occurrences: [] }))
    expect(d.series[0].placeKey).toBeNull()
  })

  it('skips ended classes and classes of hidden courses in the weekly pattern', () => {
    const d = shapeTimetable(input({ series: [...SERIES, series({ id: 'x', ownerPublicId: COURSE_A, status: 'ended' }), series({ id: 'y', ownerPublicId: 'other-course' })] }))
    expect(d.series.map((s) => s.id).sort()).toEqual([S1, S2].sort())
  })

  it('computes "last class / first class" around a closure from the weekly patterns', () => {
    expect(data.closures).toEqual([{ startsOn: '2026-12-18', endsOn: '2027-01-06', label: 'Vacances d’hiver', lastClass: '2026-12-17', firstClass: '2027-01-07' }])
  })

  it('only keeps the closures that overlap the window', () => {
    expect(shapeTimetable(input({ window: { from: '2026-11-01', to: '2026-11-30' } })).closures).toEqual([])
    expect(shapeTimetable(input({ window: { from: '2027-01-01', to: '2027-01-31' } })).closures).toHaveLength(1)
  })
})

describe('privacy — meeting details', () => {
  it('without permission: no rooms, no room ids, nothing secret anywhere in the JSON', () => {
    const d = shapeTimetable(input({ includeOnlineDetails: false }))
    expect(d.rooms).toBeNull()
    expect(d.series.every((s) => s.meetingRoomId === null)).toBe(true)
    expect(d.occurrences.every((o) => o.meetingRoomId === null)).toBe(true)
    const json = JSON.stringify(d)
    for (const secret of ['SECRET-PASS', 'zoom.example', '123 456 789', ROOM]) expect(json).not.toContain(secret)
  })

  it('with permission: only the rooms the shown classes use', () => {
    const d = shapeTimetable(input({ includeOnlineDetails: true, rooms: [...ROOMS, { ...ROOMS[0], id: 'unused-room', passcode: 'OTHER' }] }))
    expect(Object.keys(d.rooms!)).toEqual([ROOM])
    expect(d.rooms![ROOM]).toMatchObject({ label: 'Room 1', passcode: 'SECRET-PASS' })
    expect(d.occurrences.find((o) => o.id === 'o1')!.meetingRoomId).toBe(ROOM)
    expect(JSON.stringify(d)).not.toContain('OTHER')
  })

  it('treats anything but boolean true as "not allowed"', () => {
    const d = shapeTimetable(input({ includeOnlineDetails: 'yes' as unknown as boolean }))
    expect(d.rooms).toBeNull()
  })
})

describe('exceptions and the print month (CYCE style)', () => {
  const data = shapeTimetable(input({ includeOnlineDetails: true }))
  const s1 = data.series.find((s) => s.id === S1)!
  const s2 = data.series.find((s) => s.id === S2)!
  const byId = (id: string) => data.occurrences.find((o) => o.id === id)!

  it('derives the exceptions of a session from its weekly pattern', () => {
    expect(exceptionsOf(byId('o1'), s2)).toEqual([])
    expect(exceptionsOf(byId('o2'), s1)).toEqual([{ kind: 'substitute', date: '2026-12-07', teacherIds: [P2] }])
    expect(exceptionsOf(byId('o3'), s2)).toEqual([{ kind: 'cancelled', date: '2026-12-10', note: 'Professeure malade' }])
    expect(exceptionsOf(byId('o5'), s2)).toEqual([{ kind: 'time', date: '2026-12-17', start: '19:00', end: '20:00' }])
    expect(exceptionsOf(byId('o6'), s1)).toEqual([{ kind: 'mode', date: '2026-12-08', mode: 'inPerson' }])
  })

  const print = buildPrintMonth(data, '2026-12')

  it('puts places in rows (site order, online last) and weekdays that have classes in columns', () => {
    expect(print.weekdays).toEqual([1, 4])
    expect(print.rows.map((r) => `${r.kind}:${r.key}`)).toEqual(['place:brey', 'online:online'])
  })

  it('lists each weekly class once with the month’s exceptions', () => {
    const monday = print.rows[0].cells[1]
    expect(monday).toHaveLength(1)
    expect(monday[0]).toMatchObject({ courseId: COURSE_A, start: '12:30', end: '13:30', mode: 'mixed', languages: ['fr', 'en'], teacherIds: [P1] })
    expect(monday[0].exceptions.map((e) => `${e.date} ${e.kind}`)).toEqual(['2026-12-07 substitute', '2026-12-08 mode'])
    const thursday = print.rows[1].cells[4]
    expect(thursday[0].courseId).toBe(COURSE_B)
    expect(thursday[0].exceptions.map((e) => `${e.date} ${e.kind}`)).toEqual(['2026-12-10 cancelled', '2026-12-17 time'])
  })

  it('carries the closure sentence data and the rooms block only when online details are allowed', () => {
    expect(print.closures[0]).toMatchObject({ lastClass: '2026-12-17', firstClass: '2027-01-07' })
    expect(print.rooms?.map((r) => r.id)).toEqual([ROOM])
    const closed = buildPrintMonth(shapeTimetable(input({ includeOnlineDetails: false })), '2026-12')
    expect(closed.rooms).toBeNull()
  })

  it('leaves out a class that does not run in the month', () => {
    const only = shapeTimetable(input({ occurrences: OCCURRENCES.filter((o) => o.seriesId === S1) }))
    expect(buildPrintMonth(only, '2026-12').rows.map((r) => r.key)).toEqual(['brey'])
  })
})

describe('weekly patterns', () => {
  it('every-N-weeks counts from the week of the anchor', () => {
    const s = { weekday: 1, interval: 2, startLocal: '2026-09-07T18:00', startsOn: null, endsOn: null }
    expect(patternOccursOn(s, '2026-09-07')).toBe(true)
    expect(patternOccursOn(s, '2026-09-14')).toBe(false)
    expect(patternOccursOn(s, '2026-09-21')).toBe(true)
    expect(patternOccursOn(s, '2026-09-22')).toBe(false) // wrong weekday
    expect(patternOccursOn(s, '2026-08-31')).toBe(false) // before the anchor
    expect(patternOccursOn({ ...s, endsOn: '2026-09-20' }, '2026-09-21')).toBe(false)
  })
})

describe('calendar helpers', () => {
  it('month range, months and weeks (Monday first)', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02').to).toBe('2028-02-29')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(weekStart('2026-12-06')).toBe('2026-11-30') // a Sunday
    const weeks = monthWeeks('2026-12')
    expect(weeks[0][0]).toBe('2026-11-30')
    expect(weeks.at(-1)!.at(-1)).toBe('2027-01-03')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('today is the date in the site zone, not the server zone', () => {
    const now = new Date('2026-12-31T23:30:00Z')
    expect(todayIn('Europe/Brussels', now)).toBe('2027-01-01')
    expect(todayIn('America/New_York', now)).toBe('2026-12-31')
    expect(todayIn(null, now)).toBe('2026-12-31')
    expect(todayIn('Not/AZone', now)).toBe('2026-12-31')
  })

  it('covered months are the ones the window fully contains', () => {
    expect(coveredMonths({ from: '2026-11-30', to: '2027-01-03' })).toEqual(['2026-12'])
    expect(coveredMonths({ from: '2026-12-02', to: '2026-12-31' })).toEqual([])
  })

  it('merges month pieces without duplicating sessions', () => {
    const dec = shapeTimetable(input())
    const jan = shapeTimetable(input({ window: { from: '2027-01-01', to: '2027-01-31' }, occurrences: [] }))
    const merged = mergeTimetables([dec, jan, dec])
    expect(merged.occurrences).toHaveLength(dec.occurrences.length)
    expect(merged.window).toEqual({ from: '2026-12-01', to: '2027-01-31' })
    expect(mergeTimetables([dec]).rooms).toBeNull()
  })
})
