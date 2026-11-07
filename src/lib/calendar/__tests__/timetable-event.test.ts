import { describe, expect, it } from 'vitest'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
import { getAddToCalendarMessages } from '@/lib/i18n/add-to-calendar-messages'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'
import { buildIcs } from '../ics'
import { eventLocation, icsFileName, repeatingRule, timetableEvent, timetableSeriesEvent } from '../timetable-event'

// Online details ON in the data: the calendar must still never use them.
const data = shapeTimetable({
  window: { from: '2026-12-01', to: '2026-12-31' }, locale: 'fr', defaultLocale: 'en', timeZone: 'Europe/Brussels',
  courses: COURSES, occurrences: OCCURRENCES, series: SERIES, closures: CLOSURES, people: PEOPLE, siteLocations: LOCATIONS, venues: [], rooms: ROOMS, includeOnlineDetails: true,
})
const msg = getAddToCalendarMessages('fr')
const pick = (id: string) => data.occurrences.find((o) => o.id === id)!
const seriesOf = (id: string) => data.series.find((s) => s.id === pick(id).seriesId)!
const input = (id: string) => ({ occurrence: pick(id), series: seriesOf(id), data, locale: 'fr', host: 'cyce.info', pageUrl: 'https://cyce.info/fr/horaires', msg })

describe('timetableEvent', () => {
  it('names the course; place + address lines; teachers and languages; page URL', () => {
    const e = timetableEvent(input('o4'))!
    expect(e.title).toBe('Iyengar Yoga')
    expect(e.uid).toBe('o4')
    expect(e.startLocal).toBe('2026-12-14T12:30')
    expect(e.timeZone).toBe('Europe/Brussels')
    expect(e.location).toContain('BREY')
    expect(e.location).toContain('Avenue d’Auderghem 45')
    expect(e.location).toContain(msg.alsoOnline) // mixed = hybrid
    expect(e.description).toContain('Anna Rossi')
    expect(e.description).toMatch(/Langues: .*français/i)
    expect(e.description).toContain('https://cyce.info/fr/horaires')
    expect(e.url).toBe('https://cyce.info/fr/horaires')
  })
  it('an online class is just "Online"', () => {
    expect(eventLocation(pick('o1'), data, msg)).toBe('En ligne')
  })
  it('NEVER carries the join link, meeting id or passcode', () => {
    for (const id of ['o1', 'o4', 'o6']) {
      for (const e of [timetableEvent(input(id)), timetableSeriesEvent(input(id))]) {
        if (!e) continue
        const file = buildIcs(e)!
        for (const secret of ['zoom.example', '123 456 789', 'SECRET-PASS', 'Room 1']) expect(file).not.toContain(secret)
      }
    }
  })
  it('unknown course = no event', () => {
    expect(timetableEvent({ ...input('o4'), data: { ...data, courses: {} } })).toBeNull()
  })
})

describe('timetableSeriesEvent', () => {
  it('RRULE from the preset, EXDATE for cancelled sessions and holidays', () => {
    const e = timetableSeriesEvent(input('o1'))! // Thursdays, 3 Dec; 10 Dec cancelled; winter break 18 Dec – 6 Jan
    expect(e.recurrence!.rule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=TH')
    expect(e.recurrence!.excludeDates).toEqual(['2026-12-10', '2026-12-24', '2026-12-31'])
    expect(e.startLocal).toBe('2026-12-03T18:00')
    expect(e.recurrence!.lastStartLocal).toBeNull()
    expect(e.uid).toContain('from-2026-12-03')
  })
  it('is built from the series, not from an overridden session: first rule date on/after the pick, series time and teachers, no note', () => {
    // o5 is a moved session (19:00, 17 Dec, a Thursday); o2 has a substitute teacher.
    const moved = timetableSeriesEvent(input('o5'))!
    expect(moved.startLocal).toBe('2026-12-17T18:00')
    expect(moved.endLocal).toBe('2026-12-17T19:00')
    const sub = timetableSeriesEvent(input('o2'))!
    expect(sub.description).toContain('Anna Rossi')
    expect(sub.description).not.toContain('Sabrina')
    // picked on a day the rule does not hit -> next rule date
    const off = timetableSeriesEvent({ ...input('o1'), occurrence: { ...pick('o1'), date: '2026-12-04' } })!
    expect(off.startLocal).toBe('2026-12-10T18:00')
  })
  it('holidays are excluded far beyond the 100-day window (closures are known in full)', () => {
    const wide = { ...data, closures: [...data.closures, { startsOn: '2027-07-15', endsOn: '2027-08-31', label: null, lastClass: null, firstClass: null }] }
    const e = timetableSeriesEvent({ ...input('o1'), data: wide })!
    expect(e.recurrence!.excludeDates).toContain('2027-07-15')
    expect(e.recurrence!.excludeDates).toContain('2027-08-26')
    expect(e.recurrence!.excludeDates).not.toContain('2027-09-02')
  })
  it('stops at the class end date', () => {
    const e = timetableSeriesEvent({ ...input('o1'), series: { ...seriesOf('o1'), endsOn: '2027-03-31' } })!
    expect(e.recurrence!.lastStartLocal).toBe('2027-03-25T18:00')
  })
  it('a class that does not repeat has no series event; repeatingRule ignores once / null', () => {
    const once = { ...seriesOf('o1'), rule: 'FREQ=DAILY;COUNT=1' }
    expect(timetableSeriesEvent({ ...input('o1'), series: once })).toBeNull()
    expect(repeatingRule(once)).toBeNull()
    expect(repeatingRule(null)).toBeNull()
    expect(repeatingRule(seriesOf('o1'))?.kind).toBe('weekly')
  })
  it('monthly presets become RRULEs too', () => {
    const e = timetableSeriesEvent({ ...input('o4'), series: { ...seriesOf('o4'), rule: 'FREQ=MONTHLY;BYDAY=1MO' } })!
    expect(e.recurrence!.rule).toBe('FREQ=MONTHLY;BYDAY=1MO')
  })
})

describe('icsFileName', () => {
  it('is ASCII, lower-case, dated', () => {
    expect(icsFileName('Méditation du soir!', '2026-12-03')).toBe('meditation-du-soir-2026-12-03.ics')
    expect(icsFileName('???', '2026-12-03')).toBe('class-2026-12-03.ics')
  })
})
