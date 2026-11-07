/**
 * The course page's "When" list and its timetable link (ADR-045 D5): one entry
 * per weekly class that still runs, with teachers linked only when they have a
 * People page, the place (never for online-only), the next date; and the first
 * OPEN published page whose timetable shows the course in this language.
 */
import { describe, expect, it } from 'vitest'
import { courseClasses, timetablePageHref } from '../course-page'
import { shapeTimetable } from '../timetable'
import { CLOSURES, COURSES, COURSE_A, COURSE_B, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, S1, S2, SERIES, series } from './timetable-fixtures'

const data = (extraSeries = SERIES) =>
  shapeTimetable({
    window: { from: '2026-12-01', to: '2026-12-31' },
    locale: 'en',
    defaultLocale: 'en',
    timeZone: 'Europe/Brussels',
    courses: COURSES,
    occurrences: OCCURRENCES,
    series: extraSeries,
    closures: CLOSURES,
    people: PEOPLE,
    siteLocations: LOCATIONS,
    rooms: ROOMS,
    // The course page never asks for meeting details.
    includeOnlineDetails: false,
  })

const href = (t: { hasPage: boolean; slug: string | null }) => (t.hasPage && t.slug ? `/en/cyce/team/${t.slug}` : null)

describe('courseClasses', () => {
  it('lists the course’s weekly classes with time, teachers (linked when they have a page), place, languages and the next date', () => {
    const [c] = courseClasses(data(), COURSE_A, '2026-12-09', href)
    expect(c).toMatchObject({
      id: S1,
      rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
      start: '12:30',
      end: '13:30',
      mode: 'mixed',
      languages: ['fr', 'en'],
      nextDate: '2026-12-14',
      startsOn: null,
    })
    expect(c.teachers).toEqual([{ id: expect.any(String), name: 'Anna Rossi', href: '/en/cyce/team/anna-rossi', photo: null }])
    expect(c.place?.name).toBe('BREY')
  })

  it('an online-only class has no place; a teacher without a page is plain text', () => {
    const [c] = courseClasses(data(), COURSE_B, '2026-12-01', href)
    expect(c.id).toBe(S2)
    expect(c.place).toBeNull()
    expect(c.mode).toBe('online')
    expect(c.teachers[0]).toMatchObject({ name: 'Sabrina', href: null })
    // The cancelled 10/12 is skipped for "next class".
    expect(courseClasses(data(), COURSE_B, '2026-12-04', href)[0].nextDate).toBe('2026-12-17')
  })

  it('leaves out classes that ended and one-off classes in the past; says when a class starts later', () => {
    const ended = series({ id: 'ended', ownerPublicId: COURSE_A, endsOn: '2026-11-30' })
    const once = series({ id: 'once', ownerPublicId: COURSE_A, rule: 'FREQ=DAILY;COUNT=1', startLocal: '2026-12-02T10:00', endLocal: '2026-12-02T11:00' })
    const later = series({ id: 'later', ownerPublicId: COURSE_A, startsOn: '2027-01-11' })
    const ids = courseClasses(data([...SERIES, ended, once, later]), COURSE_A, '2026-12-08', href).map((c) => c.id)
    expect(ids).toContain(S1)
    expect(ids).toContain('later')
    expect(ids).not.toContain('ended')
    expect(ids).not.toContain('once')
    expect(courseClasses(data([...SERIES, later]), COURSE_A, '2026-12-08', href).find((c) => c.id === 'later')?.startsOn).toBe('2027-01-11')
  })

  it('never carries meeting details', () => {
    expect(JSON.stringify(courseClasses(data(), COURSE_A, '2026-12-01', href))).not.toMatch(/SECRET-PASS|zoom\.example|meetingRoom/)
  })
})

describe('timetablePageHref', () => {
  const page = (o: Record<string, unknown> = {}) => ({ _id: 'p1', pageType: 'services', slugs: { en: { current: 'timetable' }, fr: { current: 'horaires' } }, open: true, timetables: [{ courseScope: 'all', courseIds: null }], ...o })
  it('links the open page that shows the course, in this language', () => {
    expect(timetablePageHref([page()], 'c1', 'fr', '/fr/cyce')).toBe('/fr/cyce/horaires')
    expect(timetablePageHref([page()], 'c1', 'en', '')).toBe('/timetable')
  })
  it('skips pages that pick other courses, members-only pages and pages missing in this language', () => {
    expect(timetablePageHref([page({ timetables: [{ courseScope: 'pick', courseIds: ['other'] }] })], 'c1', 'en', '')).toBeNull()
    expect(timetablePageHref([page({ open: false })], 'c1', 'en', '')).toBeNull()
    expect(timetablePageHref([page()], 'c1', 'de', '')).toBeNull()
    expect(timetablePageHref([page({ open: false }), page({ _id: 'p2', slugs: { de: { current: 'stundenplan' } } })], 'c1', 'de', '/de/x')).toBe('/de/x/stundenplan')
  })
  it('the home page is the site root', () => {
    expect(timetablePageHref([page({ pageType: 'home', slugs: {} })], 'c1', 'en', '/en/cyce')).toBe('/en/cyce')
    expect(timetablePageHref(null, 'c1', 'en', '')).toBeNull()
  })
})
