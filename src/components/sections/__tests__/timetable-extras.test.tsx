// @vitest-environment jsdom
/**
 * Timetable additions: always seven weekdays with shaded weekends, the Online tag, the Online block / title /
 * holidays / notes / volunteer footnote on the printed sheet, the language filter, and events (workshops).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { TimetableView } from '@/components/sections/timetable/TimetableView'
import { PrintSheet } from '@/components/sections/timetable/PrintSheet'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import { buildPrintMonth, filterByLanguage, languagesIn, shapeTimetable, type TimetableEvent } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, P1, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EVENT: TimetableEvent = { id: 'ev1', eventId: 'e1', title: 'Spring Workshop', slug: 'spring-workshop', date: '2026-12-09', start: '10:00', end: '12:00', placeName: 'BREY' }

const shape = (over: { online?: boolean; volunteer?: boolean; events?: TimetableEvent[]; occurrences?: typeof OCCURRENCES } = {}) =>
  shapeTimetable({
    window: { from: '2026-11-30', to: '2026-12-31' },
    locale: 'en',
    defaultLocale: 'en',
    timeZone: 'Europe/Brussels',
    courses: COURSES,
    occurrences: over.occurrences ?? OCCURRENCES,
    series: SERIES,
    closures: CLOSURES,
    people: PEOPLE.map((p) => (p.publicId === P1 ? { ...p, volunteer: over.volunteer === true } : p)),
    siteLocations: LOCATIONS,
    rooms: ROOMS,
    includeOnlineDetails: over.online === true,
    events: over.events ?? [],
  })

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

function mount(view: 'week' | 'month', data = shape(), extra: Record<string, unknown> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <TimetableView
        locale="en"
        initial={{ month: '2026-12', today: '2026-12-07', data, onlineDetails: false }}
        defaultView={view}
        allowViewSwitch
        showPrintButton={false}
        title="Timetable"
        endpoint={null}
        pageId={null}
        sectionKey="s"
        profile={null}
        eventsBase="/en/cyce/events"
        {...extra}
      />,
    )
  })
  return host
}

describe('seven-day weeks, shaded weekends', () => {
  it('the week view has all seven days and shades Saturday and Sunday', () => {
    const h = mount('week')
    const days = h.querySelectorAll('section[aria-label]')
    expect(days).toHaveLength(7)
    expect([...days].filter((d) => d.getAttribute('data-weekend') === 'true')).toHaveLength(2)
  })

  it('the month grid has seven columns and shades the weekend cells', () => {
    const h = mount('month')
    expect(h.querySelectorAll('[role="columnheader"]')).toHaveLength(7)
    expect(h.querySelectorAll('[role="cell"][data-weekend="true"]').length).toBeGreaterThanOrEqual(8)
  })

  it('the printed sheet always has seven weekday columns, weekends marked', () => {
    const data = shape()
    const html = renderToStaticMarkup(<PrintSheet print={buildPrintMonth(data, '2026-12')} data={data} title="Yoga" locale="en" msg={getTimetableMessages('en')} profile={null} />)
    expect((html.match(/<th scope="col"/g) ?? []).length).toBe(7)
    expect((html.match(/ab-tt-weekend/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Online tag', () => {
  it('online-only classes carry an Online tag in the week view, with a colour of its own', () => {
    const h = mount('week', shape({ occurrences: OCCURRENCES.filter((o) => o.id !== 'o3') }))
    // Week of 7 Dec has no online-only session except the cancelled one; open the week of 14 Dec -> 17 Dec (time change).
    act(() => (h.querySelector('button[aria-label="Next week"]') as HTMLButtonElement).click())
    const tag = h.querySelector('[data-tag="online"]')
    expect(tag?.textContent).toBe('Online')
    expect(h.querySelector('[data-tag="hybrid"]')?.textContent).toBe('Hybrid')
    expect((tag as HTMLElement).style.color).not.toBe((h.querySelector('[data-tag="hybrid"]') as HTMLElement).style.color)
  })

  it('the month cell and the class panel show it too', () => {
    const h = mount('month')
    expect(h.querySelector('[data-tag="online"]')).toBeTruthy()
    const opener = [...h.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')].find((b) => b.getAttribute('aria-label')?.includes('Méditation'))!
    act(() => opener.click())
    expect(document.querySelector('[role="dialog"] [data-tag="online"]')).toBeTruthy()
  })
})

describe('printed sheet: title, holidays, Online block, workshops, notes', () => {
  const print = (data = shape(), props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(<PrintSheet print={buildPrintMonth(data, '2026-12')} data={data} title="YOGA" siteHost="cyce.info" locale="en" msg={getTimetableMessages('en')} profile={null} {...props} />).replace(/[  ]/g, ' ')

  it('title is "<title> · <Month Year> · <host>" and a holidays line follows', () => {
    const out = print()
    expect(out).toMatch(/<h2>YOGA · <span class="ab-tt-month">December 2026<\/span> · cyce\.info<\/h2>/)
    expect(out).toContain('Holidays: December 18 – December 31 (Winter break)')
  })

  it('the host is left out when unknown', () => {
    expect(print(shape(), { siteHost: null })).toMatch(/December 2026<\/span><\/h2>/)
  })

  it('Online block: online-only and hybrid classes by weekday; rooms in the first column only when allowed', () => {
    const closed = print()
    expect(closed).toContain('data-online-block')
    expect(closed).not.toContain('SECRET-PASS')
    const open = print(shape({ online: true }))
    expect(open).toContain('Room 1')
    expect(open).toContain('Meeting ID: 123 456 789')
    expect(open).toContain('Passcode: SECRET-PASS')
    expect(open).toContain('https://zoom.example/j/123')
    // The hybrid Monday class is in BREY's row and in the block (twice in total); online-only Thursday only in the block.
    expect((open.match(/Iyengar Yoga/g) ?? []).length).toBe(2)
    expect((open.match(/Méditation/g) ?? []).length).toBe(1)
  })

  it('no Online block when nothing is online or hybrid', () => {
    const data = shape()
    const inPerson = { ...data, series: data.series.map((s) => ({ ...s, mode: 'inPerson' as const })) }
    expect(print(inPerson)).not.toContain('data-online-block')
  })

  it('lists the month’s workshops with their tag and link, and prints notes at the bottom', () => {
    const out = print(shape({ events: [EVENT] }), { eventsBase: '/en/cyce/events', notes: <p>Bring a mat</p>, membersNotes: <p>Door code 1234</p> })
    expect(out).toContain('Workshops')
    expect(out).toContain('ab-tt-tag ab-tt-tag-workshop">Workshop')
    expect(out).toContain('href="/en/cyce/events/spring-workshop"')
    expect(out).toContain('Bring a mat')
    expect(out.indexOf('Bring a mat')).toBeGreaterThan(out.indexOf('</table>'))
    expect(print(shape())).not.toContain('Door code')
  })

  it('is localized (French holidays word)', () => {
    const data = shape()
    const out = renderToStaticMarkup(<PrintSheet print={buildPrintMonth(data, '2026-12')} data={data} title="YOGA" locale="fr" msg={getTimetableMessages('fr')} profile={null} />)
    expect(out).toContain('Jours fériés')
  })
})

describe('volunteer teachers', () => {
  it('shows name* in the grid and the footnote; nothing when no shown teacher volunteers', () => {
    const h = mount('week', shape({ volunteer: true }))
    expect(h.textContent).toContain('Anna Rossi*')
    expect(h.querySelector('[data-volunteer-note]')?.textContent).toBe('* volunteer teacher')
    act(() => root?.unmount())
    host?.remove()
    const h2 = mount('week', shape({ volunteer: false }))
    expect(h2.textContent).not.toContain('Anna Rossi*')
    expect(h2.querySelector('[data-volunteer-note]')).toBeNull()
  })

  it('marks the teacher in the class panel and the printed sheet', () => {
    const h = mount('week', shape({ volunteer: true }))
    const opener = [...h.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')].find((b) => b.getAttribute('aria-label')?.includes('Tuesday, December 8'))!
    act(() => opener.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Anna Rossi*')
    const data = shape({ volunteer: true })
    const out = renderToStaticMarkup(<PrintSheet print={buildPrintMonth(data, '2026-12')} data={data} title="YOGA" locale="en" msg={getTimetableMessages('en')} profile={null} />)
    expect(out).toContain('Anna Rossi')
    expect(out).toContain('data-volunteer-note')
  })
})

describe('language filter', () => {
  const select = (h: HTMLElement) => h.querySelector<HTMLSelectElement>('select')

  it('lists only the languages in the shown data, and narrows the classes', () => {
    const h = mount('month')
    const s = select(h)!
    expect([...s.options].map((o) => o.value)).toEqual(['', 'en', 'fr'])
    expect(h.textContent).toContain('Méditation')
    act(() => {
      s.value = 'fr'
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // Méditation is English only; Iyengar Yoga lists French and English.
    expect(h.textContent).not.toContain('Méditation')
    expect(h.textContent).toContain('Iyengar Yoga')
  })

  it('a session without its own languages inherits its class languages', () => {
    const data = shape()
    const bare = { ...data, occurrences: data.occurrences.map((o) => ({ ...o, languages: [] })) }
    expect(languagesIn(bare)).toEqual(['en', 'fr'])
    expect(filterByLanguage(bare, 'fr').occurrences.length).toBeGreaterThan(0)
    expect(filterByLanguage(bare, 'fr').occurrences.every((o) => o.seriesId === SERIES[0].id)).toBe(true)
  })

  it('the printed month ignores the on-screen filter', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(<TimetableView locale="en" initial={{ month: '2026-12', today: '2026-12-07', data: shape({ volunteer: true }), onlineDetails: false }} defaultView="month" allowViewSwitch showPrintButton title="Timetable" endpoint={null} pageId={null} sectionKey="s" profile={null} />)
    })
    const s = host.querySelector<HTMLSelectElement>('select')!
    act(() => {
      s.value = 'fr'
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const sheet = document.querySelector('.ab-tt-print-root')!
    expect(sheet.textContent).toContain('Méditation')
    expect(host.textContent).not.toContain('Méditation')
  })

  it('is hidden with fewer than two languages', () => {
    const only = OCCURRENCES.filter((o) => o.languages.length === 1 && o.languages[0] === 'en')
    const h = mount('month', shape({ occurrences: only }))
    expect(select(h)).toBeNull()
  })

  it('has an accessible name', () => {
    const h = mount('month')
    expect(h.querySelector('label')?.textContent).toContain('Language')
  })
})

describe('events (workshops)', () => {
  it('appear in the week and month views with a Workshop tag and a link to the event page', () => {
    for (const view of ['week', 'month'] as const) {
      const h = mount(view, shape({ events: [EVENT] }))
      const link = h.querySelector('a[href="/en/cyce/events/spring-workshop"]')
      expect(link?.textContent).toBe('Spring Workshop')
      expect(h.querySelector('[data-tag="workshop"]')?.textContent).toBe('Workshop')
      act(() => root?.unmount())
      host?.remove()
    }
  })

  it('are absent when the data has none', () => {
    expect(mount('week').querySelector('[data-tag="workshop"]')).toBeNull()
  })
})

describe('notes', () => {
  it('shows notes to everyone and members’ notes only when the server sent them', () => {
    const h = mount('week', shape(), { notes: <p>Bring a mat</p> })
    expect(h.textContent).toContain('Bring a mat')
    expect(h.querySelector('[data-members-notes]')).toBeNull()
    act(() => root?.unmount())
    host?.remove()
    const h2 = mount('week', shape(), { notes: <p>Bring a mat</p>, membersNotes: <p>Door code 1234</p> })
    expect(h2.querySelector('[data-members-notes]')?.textContent).toContain('Door code 1234')
  })
})
