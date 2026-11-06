import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrintSheet } from '@/components/sections/timetable/PrintSheet'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import { buildPrintMonth, shapeTimetable } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, COURSE_A, COURSE_B, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

const data = shapeTimetable({
  window: { from: '2026-12-01', to: '2026-12-31' },
  locale: 'en',
  defaultLocale: 'en',
  timeZone: 'Europe/Brussels',
  courses: COURSES.map((c) => (c.publicId === COURSE_A ? { ...c, shortDescription: 'Alignment and breath.' } : c)),
  occurrences: OCCURRENCES,
  series: SERIES,
  closures: CLOSURES,
  people: PEOPLE,
  siteLocations: LOCATIONS,
  rooms: ROOMS,
  includeOnlineDetails: false,
})
const render = (showCourseDescriptions?: boolean) =>
  renderToStaticMarkup(<PrintSheet print={buildPrintMonth(data, '2026-12')} data={data} title="Timetable" locale="en" msg={getTimetableMessages('en')} profile={null} showCourseDescriptions={showCourseDescriptions} />).replace(/[  ]/g, ' ')

describe('printed month sheet', () => {
  it('marks online and hybrid classes, and lists holiday dates a class does not happen', () => {
    const out = render()
    expect(out).toContain('ab-tt-tag">Online')
    expect(out).toContain('ab-tt-tag">Hybrid')
    expect(out).toMatch(/12\/21 no class/)
    expect(out).toMatch(/12\/28 no class/)
  })

  it('the "About the courses" page is off by default and lists each shown course when on', () => {
    expect(render()).not.toContain('ab-tt-about')
    const out = render(true)
    expect(out).toContain('About the courses')
    expect(out).toContain('Alignment and breath.')
    expect(out).toContain(COURSES.find((c) => c.publicId === COURSE_B)!.title)
  })
})
