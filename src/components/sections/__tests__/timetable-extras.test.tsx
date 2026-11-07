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
import { PrintDocument } from '@/components/sections/timetable/PrintSheet'
import { buildPrintDoc } from '@/components/sections/timetable/print-model'
import { NO_FILTERS } from '@/components/sections/timetable/filters'
import type { TimetableData } from '@/lib/modules/courses/timetable'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import { filterByLanguage, languagesIn, shapeTimetable, type TimetableEvent } from '@/lib/modules/courses/timetable'
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

/** The printed month as static markup (one continuous sheet before measuring). */
const printDoc = (data: TimetableData, opts: { kind?: 'week' | 'month'; anchor?: string; locale?: string; siteHost?: string | null; eventsBase?: string } = {}) => {
  const locale = opts.locale ?? 'en'
  const msg = getTimetableMessages(locale)
  return buildPrintDoc(data, { kind: opts.kind ?? 'month', anchor: opts.anchor ?? '2026-12-07', title: 'YOGA', locale, msg, filters: NO_FILTERS, allData: data, siteHost: opts.siteHost === undefined ? 'cyce.info' : opts.siteHost, eventsBase: opts.eventsBase ?? '', now: new Date('2026-12-07T09:05:00Z'), teacherHref: () => null })
}
const printed = (data: TimetableData, opts: { kind?: 'week' | 'month'; anchor?: string; locale?: string; siteHost?: string | null; eventsBase?: string; notes?: React.ReactNode; membersNotes?: React.ReactNode } = {}) => {
  const locale = opts.locale ?? 'en'
  const msg = getTimetableMessages(locale)
  const doc = printDoc(data, opts)
  const html = renderToStaticMarkup(<PrintDocument doc={doc} msg={msg} notes={opts.notes} membersNotes={opts.membersNotes} />).replace(/[\u00a0\u202f]/g, ' ')
  // The page(s) only — not the hidden copy the document measures its blocks with.
  return html.slice(html.indexOf('class="pv-pages"'))
}

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

  it('the printed month is a calendar: a row of seven days per week, real dates, no week without classes in the month', () => {
    const d = printDoc(shape())
    expect(d.weeks.length).toBeGreaterThan(0)
    for (const w of d.weeks) expect(w.reduce((n, c) => n + (c.kind === 'day' ? 1 : c.days.length), 0)).toBe(7)
    // December 2026 starts on a Tuesday: the first row starts on Monday 30 November (no November classes in the data).
    expect(d.weeks[0][0]).toMatchObject({ kind: 'unavailable', text: 'The November schedule is not available yet.' })
    // With a November class, Monday 30 shows it as a day of its own.
    const withNov = printDoc(shape({ occurrences: [...OCCURRENCES, { ...OCCURRENCES[0], id: 'nov', startLocal: '2026-11-30T12:30', originalStartLocal: '2026-11-30T12:30', endLocal: '2026-11-30T13:30' }] }))
    expect(withNov.weeks[0][0]).toMatchObject({ kind: 'day', day: { date: '2026-11-30', otherMonth: 'Nov' } })
    const html = printed(shape())
    expect((html.match(/data-print-week/g) ?? []).length).toBe(d.weeks.length)
  })

  it('days of a month with no published classes are one "not available yet" note', () => {
    const last = printDoc(shape()).weeks.at(-1)!
    const na = last.find((c) => c.kind === 'unavailable')
    expect(na).toMatchObject({ kind: 'unavailable', text: 'The January schedule is not available yet.' })
    expect(na && na.kind === 'unavailable' && na.days.map((x) => x.date)).toEqual(['2027-01-01', '2027-01-02', '2027-01-03'])
  })

  it('the printed week lists its days with real dates and column labels', () => {
    const html = printed(shape(), { kind: 'week', anchor: '2026-12-07' })
    const days = [...html.matchAll(/data-print-day="[^"]*"><h3>([^<]+)/g)].map((m) => m[1])
    expect(days.length).toBeGreaterThan(0)
    expect(days.every((x) => /December (7|8|9|10|11|12|13)/.test(x))).toBe(true)
    expect(html).toContain('Teacher')
    expect(html).toContain('Location')
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

describe('printed week / month: title, holidays, changes on their date, workshops, updates, notes', () => {
  it('title carries the period; the host and a holidays line follow', () => {
    const out = printed(shape())
    expect(out).toMatch(/YOGA <span class="pv-period">December 2026<\/span>/)
    expect(out).toContain('cyce.info')
    expect(out).toContain('Holidays: December 18 – December 31 (Winter break)')
    expect(printed(shape(), { kind: 'week', anchor: '2026-12-09' })).toMatch(/pv-period">December 7 – December 13, 2026</)
  })

  it('the host is left out when unknown', () => {
    expect(printed(shape(), { siteHost: null })).not.toContain('cyce.info')
  })

  it('a cancelled class stays on its date, crossed out and labelled; a substitute is marked on its date', () => {
    const d = printDoc(shape())
    const day = (date: string) => d.weeks.flat().flatMap((c) => (c.kind === 'day' && c.day.date === date ? [c.day] : []))[0]
    const cancelled = day('2026-12-10').sessions.find((s) => s.cancelled)
    expect(cancelled).toBeTruthy()
    const sub = day('2026-12-07').sessions.find((s) => s.teacherChanged)
    expect(sub?.notes.some((n) => n.startsWith('instead of'))).toBe(true)
    const html = printed(shape())
    expect(html).toContain('data-print-session="cancelled"')
    expect(html).toContain('pv-flag">Cancelled')
  })

  it('tags online and hybrid classes; rooms only when allowed', () => {
    const closed = printed(shape())
    expect(closed).toContain('pv-where">Online<')
    expect(printed(shape(), { kind: 'week', anchor: '2026-12-14' })).toContain('pv-tag pv-tag-solid">Online')
    expect(closed).not.toContain('SECRET-PASS')
    expect(printDoc(shape()).weeks.flat().some((c) => c.kind === 'day' && c.day.sessions.some((s) => s.tags.includes('hybrid') && s.location.endsWith('+ online')))).toBe(true)
    const open = printed(shape({ online: true }))
    expect(open).toContain('Online rooms')
    expect(open).toContain('Meeting ID: 123 456 789')
    expect(open).toContain('Passcode: SECRET-PASS')
    expect(open).toContain('https://zoom.example/j/123')
  })

  it('puts workshops on their date with tag and link, then every schedule update, then the notes', () => {
    const out = printed(shape({ events: [EVENT] }), { eventsBase: '/en/cyce/events', notes: <p>Bring a mat</p> })
    expect(out).toContain('pv-tag">Workshop')
    expect(out).toContain('href="/en/cyce/events/spring-workshop"')
    expect(out.indexOf('spring-workshop')).toBeLessThan(out.indexOf('Schedule updates'))
    expect(out).toContain('Schedule updates')
    expect(out.indexOf('Schedule updates')).toBeGreaterThan(out.lastIndexOf('data-print-week'))
    expect(out).toContain('Bring a mat')
    expect(out.indexOf('Bring a mat')).toBeGreaterThan(out.indexOf('Schedule updates'))
    expect(printed(shape())).not.toContain('Door code')
  })

  it('is localized (French)', () => {
    const out = printed(shape(), { locale: 'fr' })
    expect(out).toContain('Jours fériés')
    expect(out).toContain('Page 1 sur 1')
  })

  it('every page carries its number and the generation date and time (site time zone)', () => {
    const out = printed(shape())
    expect(out).toContain('Page 1 of 1')
    expect(out).toContain('Schedule generated on December 7, 2026 at 10:05')
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
    const out = printed(shape({ volunteer: true }))
    expect(out).toContain('Anna Rossi*')
    expect(out).toContain('* volunteer teacher')
    expect(printed(shape({ volunteer: true }), { kind: 'week', anchor: '2026-12-08' })).toContain('data-volunteer-note')
  })
})

describe('language filter', () => {
  /** The Language chip group inside the Filters dialog (opens the dialog first). */
  const group = (h: HTMLElement) => {
    if (!document.querySelector('[role="dialog"] [role="radiogroup"]')) act(() => h.querySelector<HTMLButtonElement>('[data-filters-button]')!.click())
    return document.querySelector<HTMLElement>('[role="dialog"] [role="radiogroup"][aria-label="Language"]')
  }
  const chips = (g: HTMLElement) => [...g.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
  const choose = (g: HTMLElement, name: string) => act(() => chips(g).find((c) => c.textContent === name)!.click())
  /** The text of the class cards on screen (the filter lists also name every class). */
  const cards = (h: HTMLElement) => [...h.querySelectorAll('[data-card]')].map((c) => c.textContent).join('\n')

  it('lists only the languages in the shown data, and narrows the classes', () => {
    const h = mount('month')
    const g = group(h)!
    expect(chips(g).map((c) => c.textContent)).toEqual(['All languages', 'English', 'French'])
    expect(chips(g)[0].getAttribute('aria-checked')).toBe('true')
    expect(cards(h)).toContain('Méditation')
    choose(g, 'French')
    expect(chips(g).find((c) => c.textContent === 'French')!.getAttribute('aria-checked')).toBe('true')
    // Méditation is English only; Iyengar Yoga lists French and English.
    expect(cards(h)).not.toContain('Méditation')
    expect(cards(h)).toContain('Iyengar Yoga')
    // The active filter shows as a removable chip on computers; removing it brings the classes back.
    const active = h.querySelector<HTMLElement>('[data-filters="active"]')!
    expect(active.textContent).toContain('Language: French')
    act(() => active.querySelector<HTMLButtonElement>('button')!.click())
    expect(cards(h)).toContain('Méditation')
  })

  it('a session without its own languages inherits its class languages', () => {
    const data = shape()
    const bare = { ...data, occurrences: data.occurrences.map((o) => ({ ...o, languages: [] })) }
    expect(languagesIn(bare)).toEqual(['en', 'fr'])
    expect(filterByLanguage(bare, 'fr').occurrences.length).toBeGreaterThan(0)
    expect(filterByLanguage(bare, 'fr').occurrences.every((o) => o.seriesId === SERIES[0].id)).toBe(true)
  })

  it('the printed month follows the on-screen filter and names it', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(<TimetableView locale="en" initial={{ month: '2026-12', today: '2026-12-07', data: shape({ volunteer: true }), onlineDetails: false }} defaultView="month" allowViewSwitch showPrintButton title="Timetable" endpoint={null} pageId={null} sectionKey="s" profile={null} />)
    })
    choose(group(host)!, 'French')
    act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label]')?.click())
    expect(document.querySelector('.ab-tt-pv')).toBeNull()
    const print = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Print month')!
    expect(print).toBeTruthy()
    await act(async () => {
      print.click()
    })
    {
      const view = document.querySelector('.ab-tt-pv')!
      expect(view.getAttribute('role')).toBe('dialog')
      expect(view.querySelector('[data-print-filters]')?.textContent).toBe('Filtered: Language: French')
      expect(view.querySelector('[data-print-week]')).toBeTruthy()
      expect(view.querySelector('.pv-page')?.textContent).not.toContain('Méditation')
      expect(view.querySelector('.pv-page')?.textContent).toContain('Iyengar Yoga')
      act(() => [...view.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Close')!.click())
      expect(document.querySelector('.ab-tt-pv')).toBeNull()
    }
  })

  it('is hidden with fewer than two languages', () => {
    const only = OCCURRENCES.filter((o) => o.languages.length === 1 && o.languages[0] === 'en')
    const h = mount('month', shape({ occurrences: only }))
    // Only one language (and one of everything else): nothing to filter, so no Filters button at all.
    expect(h.querySelector('[data-filters-button]')).toBeNull()
    expect(document.querySelector('[role="radiogroup"][aria-label="Language"]')).toBeNull()
  })

  it('has an accessible name', () => {
    const h = mount('month')
    expect(group(h)?.getAttribute('aria-label')).toBe('Language')
  })
})

describe('events (workshops)', () => {
  it('appear in the week and month views with a Workshop tag and a link to the event page', () => {
    for (const view of ['week', 'month'] as const) {
      const h = mount(view, shape({ events: [EVENT] }))
      // The whole card links to the event page through a stretched <a> (named by the title).
      const link = h.querySelector('article[data-event] a[href="/en/cyce/events/spring-workshop"]')
      expect(link?.getAttribute('aria-label')).toBe('Spring Workshop')
      expect(h.querySelector('article[data-event]')?.textContent).toContain('Spring Workshop')
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
