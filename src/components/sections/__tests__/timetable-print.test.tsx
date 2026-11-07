import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrintDocument } from '@/components/sections/timetable/PrintSheet'
import { buildPrintDoc, filtersLine, monthsForPrint, paginate, updateText, type PrintBlock } from '@/components/sections/timetable/print-model'
import { applyFilters, NO_FILTERS, type Filters } from '@/components/sections/timetable/filters'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
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
const msg = getTimetableMessages('en')
const doc = (filters: Filters = NO_FILTERS, kind: 'week' | 'month' = 'month') =>
  buildPrintDoc(applyFilters(data, filters), { kind, anchor: '2026-12-07', title: 'Timetable', locale: 'en', msg, filters, allData: data, siteHost: null, eventsBase: '', now: new Date('2026-12-07T09:00:00Z'), teacherHref: () => null })
const render = (showCourseDescriptions?: boolean) => renderToStaticMarkup(<PrintDocument doc={doc()} msg={msg} showCourseDescriptions={showCourseDescriptions} />).replace(/[  ]/g, ' ')

describe('printed month', () => {
  it('lists every change of the period (none hidden), in date order; the week only its own', () => {
    const d = doc()
    const changed = data.occurrences.filter((o) => o.date.startsWith('2026-12') && updateText(o, data, msg, 'en'))
    expect(d.updates).toHaveLength(changed.length)
    expect(d.updates.length).toBeGreaterThan(0)
    const w = doc(NO_FILTERS, 'week')
    expect(w.updates.length).toBe(data.occurrences.filter((o) => o.date >= '2026-12-07' && o.date <= '2026-12-13' && updateText(o, data, msg, 'en')).length)
  })

  it('needs the neighbouring months a calendar row reaches into', () => {
    expect(monthsForPrint('month', '2026-12-15')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(monthsForPrint('week', '2026-12-30')).toEqual(['2026-12', '2027-01'])
    expect(monthsForPrint('week', '2026-12-09')).toEqual(['2026-12'])
  })

  it('names the active filters; nothing when none', () => {
    expect(filtersLine(NO_FILTERS, data, 'en', msg)).toBeNull()
    const lang = filtersLine({ ...NO_FILTERS, language: 'fr' }, data, 'en', msg)
    expect(lang).toBe('Filtered: Language: French')
    expect(doc({ ...NO_FILTERS, language: 'fr' }).filters).toBe(lang)
  })

  it('the "About the courses" page is off by default; when on it lists only courses with a description', () => {
    expect(render()).not.toContain('About the courses')
    const out = render(true)
    expect(out).toContain('About the courses')
    expect(out).toContain('Alignment and breath.')
    expect(out).not.toContain(`<h4>${COURSES.find((c) => c.publicId === COURSE_B)!.title}</h4>`)
  })
})

describe('paginate', () => {
  const blocks: PrintBlock[] = [
    { key: 'head' },
    { key: 'mon', group: 'mon', heading: true },
    { key: 'a', group: 'mon' },
    { key: 'b', group: 'mon' },
    { key: 'c', group: 'mon' },
    { key: 'tue', group: 'tue', heading: true },
    { key: 'd', group: 'tue' },
    { key: 'about', heading: true, group: 'about', pageBreak: true },
    { key: 'e', group: 'about' },
  ]
  const keys = (pages: ReturnType<typeof paginate>) => pages.map((p) => p.map((x) => `${blocks[x.index].key}${x.continued ? '+' : ''}`))

  it('never splits a block, repeats the heading of a continued day, keeps a heading with its first row', () => {
    const heights = [30, 10, 20, 20, 20, 10, 20, 10, 10]
    expect(keys(paginate(blocks, heights, () => 80))).toEqual([
      ['head', 'mon', 'a', 'b'],
      ['mon+', 'c', 'tue', 'd'],
      ['about', 'e'],
    ])
  })

  it('moves a heading that would be last on the page', () => {
    const heights = [55, 10, 20, 20, 20, 10, 20, 10, 10]
    expect(keys(paginate(blocks, heights, () => 70))[0]).toEqual(['head'])
  })

  it('a block taller than a page gets its own page', () => {
    const pages = paginate([{ key: 'x' }, { key: 'y' }], [10, 500], () => 100)
    expect(pages).toHaveLength(2)
  })
})
