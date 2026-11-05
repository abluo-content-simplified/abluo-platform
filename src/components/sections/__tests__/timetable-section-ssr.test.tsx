import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionRenderer } from '@/components/sections/SectionRenderer'
import type { PageSection, TimetableSection } from '@/lib/sanity/types'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, PEOPLE, ROOM, ROOMS, SERIES, WINDOW } from '@/lib/modules/courses/__tests__/timetable-fixtures'

const data = (online: boolean) =>
  shapeTimetable({ window: { from: '2026-11-30', to: '2026-12-31' }, locale: 'fr', defaultLocale: 'en', timeZone: 'Europe/Brussels', courses: COURSES, occurrences: OCCURRENCES, series: SERIES, closures: CLOSURES, people: PEOPLE, siteLocations: LOCATIONS, rooms: ROOMS, includeOnlineDetails: online })

const section = (over: Partial<TimetableSection> = {}): TimetableSection => ({
  _type: 'timetableSection',
  _key: 'tt1',
  title: 'Horaires',
  defaultView: 'week',
  allowViewSwitch: true,
  showPrintButton: true,
  timetable: { month: '2026-12', today: '2026-12-10', data: data(false), onlineDetails: false, pageId: 'page-1' },
  ...over,
})

const render = (s: TimetableSection, locale = 'fr', enabledModuleIds: string[] | null = ['courses']) =>
  renderToStaticMarkup(
    <SectionRenderer
      section={s as unknown as PageSection}
      siteConfig={null}
      designSystem={null}
      backgroundPattern={undefined}
      sectionIndex={1}
      locale={locale}
      tenantSlug={'cyce' as never}
      enabledModuleIds={enabledModuleIds}
      moduleConfig={[{ moduleId: 'people', enabled: true, config: { profileSegment: { fr: 'equipe' } } }] as never}
    />,
  ).replace(/[  ]/g, ' ')

describe('timetableSection — through SectionRenderer', () => {
  it('week view of the week of 10 Dec: day columns, course titles, 24-hour times, labels in French', () => {
    const out = render(section())
    expect(out).toContain('Horaires</h2>')
    expect(out).toContain('Méditation')
    expect(out).toContain('18:00–19:00')
    expect(out).not.toContain('6:00 PM')
    expect(out).toContain('Semaine') // view switch
    expect(out).toContain('Mois')
    expect(out).toContain('Imprimer le mois')
    expect(out).toContain('Aujourd’hui')
  })

  it('shows a cancelled session struck through with its note, and the substitute', () => {
    const out = render(section())
    expect(out).toMatch(/line-through[^>]*>18:00–19:00/)
    expect(out).toContain('Annulé')
    expect(out).toContain('Annulé · Professeure malade')
    // 10 Dec is the week shown; 7 Dec's sub (Sabrina) is in the same week (Mon 7 – Sun 13)
    expect(out).toContain('remplacement <span>Sabrina</span>')
  })

  it('links a teacher to the People page only when the person has one', () => {
    const out = render(section({ timetable: { ...section().timetable!, today: '2026-12-14' } }))
    expect(out).toContain('href="/fr/cyce/equipe/anna-rossi"')
    expect(out).not.toContain('href="/fr/cyce/equipe/sabrina"')
  })

  it('shows language codes and hybrid / online badges', () => {
    const out = render(section({ timetable: { ...section().timetable!, today: '2026-12-14' } }))
    expect(out).toContain('FR/EN')
    expect(out).toContain('Hybride')
    expect(out).toContain('En ligne')
  })

  it('month view opens as the month grid and honours the switch / print settings', () => {
    const month = render(section({ defaultView: 'month', allowViewSwitch: false, showPrintButton: false }))
    expect(month).toContain('décembre 2026')
    expect(month).not.toContain('Imprimer le mois')
    expect(month).not.toContain('aria-pressed')
  })

  it('the page text comes from the page’s content locale, not a fixed language', () => {
    const out = render(section(), 'en')
    expect(out).toContain('Print month')
    expect(out).toContain('Cancelled')
  })

  it('meeting details: absent from the markup unless the hydrated data holds them', () => {
    const out = render(section())
    for (const secret of ['SECRET-PASS', 'zoom.example', '123 456 789']) expect(out).not.toContain(secret)
    const allowed = render(section({ timetable: { ...section().timetable!, today: '2026-12-14', data: data(true), onlineDetails: true } }))
    expect(allowed).toContain('SECRET-PASS')
    expect(allowed).toContain('href="https://zoom.example/j/123"')
    expect(allowed).toContain('rel="noopener noreferrer"')
    expect(ROOM).toBeTruthy()
  })

  it('renders nothing when the courses module is off, or the section was not hydrated', () => {
    expect(render(section(), 'fr', [])).toBe('')
    expect(render(section({ timetable: undefined }))).toBe('')
  })

  it('an empty timetable says so', () => {
    const empty = shapeTimetable({ window: WINDOW, locale: 'fr', defaultLocale: 'en', courses: [], occurrences: [], series: [], closures: [], people: [], includeOnlineDetails: false })
    expect(render(section({ timetable: { ...section().timetable!, data: empty } }))).toContain('Aucun cours à afficher')
  })
})
