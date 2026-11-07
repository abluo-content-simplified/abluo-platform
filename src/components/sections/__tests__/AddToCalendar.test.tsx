// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'
import { AddToCalendar } from '../timetable/AddToCalendar'
import { ADD_TO_CALENDAR_MESSAGES_FOR_TEST } from '@/lib/i18n/add-to-calendar-messages'
import { TIMETABLE_MESSAGES_FOR_TEST } from '@/lib/i18n/timetable-messages'

const data = shapeTimetable({
  window: { from: '2026-12-01', to: '2026-12-31' }, locale: 'fr', defaultLocale: 'en', timeZone: 'Europe/Brussels',
  courses: COURSES, occurrences: OCCURRENCES, series: SERIES, closures: CLOSURES, people: PEOPLE, siteLocations: LOCATIONS, venues: [], rooms: ROOMS, includeOnlineDetails: false,
})
const occ = (id: string) => data.occurrences.find((o) => o.id === id)!
const render = (id: string, over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(AddToCalendar, { occurrence: occ(id), series: data.series.find((s) => s.id === occ(id).seriesId), data, locale: 'fr', pageUrl: 'https://x.test/fr', endpoint: '/fr/site-access/timetable-calendar', pageId: 'p1', sectionKey: 's1', ...over }))

describe('AddToCalendar', () => {
  it('renders the closed button for a scheduled class', () => {
    const html = render('o4')
    expect(html).toContain('Ajouter au calendrier')
    expect(html).toContain('aria-expanded="false"')
  })
  it('renders nothing for a cancelled session', () => {
    expect(render('o3')).toBe('')
  })
  it('has the same locales as the timetable messages', () => {
    expect(Object.keys(ADD_TO_CALENDAR_MESSAGES_FOR_TEST).sort()).toEqual(Object.keys(TIMETABLE_MESSAGES_FOR_TEST).sort())
  })
})
