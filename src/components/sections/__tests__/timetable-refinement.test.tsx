// @vitest-environment jsdom
/**
 * Timetable refinement: one shared class card (variants + status badges), the
 * phone agenda (pure active-day logic + the rendered strip), the filters and
 * the schedule-updates list.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassCard, EventCard } from '@/components/sections/timetable/ClassCard'
import { TimetableView } from '@/components/sections/timetable/TimetableView'
import { datesBetween, nextStripMonday, pickActiveDay } from '@/components/sections/timetable/agenda'
import { PAST_WEEKS } from '@/components/sections/timetable/MobileAgenda'
import { activeFilterCount, applyFilters, filterOptions, NO_FILTERS } from '@/components/sections/timetable/filters'
import { ScheduleUpdates } from '@/components/sections/timetable/ScheduleUpdates'
import { scheduleChangesIn } from '@/components/sections/timetable/status'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import { shapeTimetable, type TimetableData, type TimetableEvent, type TimetableOccurrence } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, LOCATIONS, OCCURRENCES, P1, P2, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const shape = (occurrences = OCCURRENCES, volunteer = false): TimetableData =>
  shapeTimetable({
    window: { from: '2026-11-30', to: '2026-12-31' },
    locale: 'en',
    defaultLocale: 'en',
    timeZone: 'Europe/Brussels',
    courses: COURSES,
    occurrences,
    series: SERIES,
    closures: CLOSURES,
    people: PEOPLE.map((p) => (p.publicId === P1 ? { ...p, volunteer } : p)),
    siteLocations: LOCATIONS,
    rooms: ROOMS,
    includeOnlineDetails: true,
    events: [],
  })

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function unmountAll() {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
}

function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

const view = (data = shape(), defaultView: 'week' | 'month' = 'week') => (
  <TimetableView locale="en" initial={{ month: '2026-12', today: '2026-12-07', data, onlineDetails: true }} defaultView={defaultView} allowViewSwitch showPrintButton={false} title="Timetable" endpoint={null} pageId={null} sectionKey="s" profile={null} eventsBase="/en/cyce/events" />
)

const msg = getTimetableMessages('en')
const o = (id: string) => shape().occurrences.find((x) => x.id === id)!

// ── Card ──────────────────────────────────────────────────────────────────────

describe('class card', () => {
  const card = (occ: TimetableOccurrence, variant: 'comfortable' | 'compact' | 'mobile' = 'comfortable', data = shape()) =>
    mount(<ClassCard occ={occ} data={data} series={data.series.find((s) => s.id === occ.seriesId)} variant={variant} locale="en" msg={msg} profile={null} onOpen={() => {}} />)

  it('puts time, course, teacher, location and tags in that order, in every variant', () => {
    for (const variant of ['comfortable', 'compact', 'mobile'] as const) {
      const h = card(o('o4'), variant, shape(OCCURRENCES, true))
      const article = h.querySelector('article')!
      expect(article.getAttribute('data-card')).toBe(variant)
      const text = article.textContent!
      const order = ['12:30–13:30', 'Iyengar Yoga', 'Anna Rossi*', 'BREY', 'FR/EN', 'Hybrid'].map((t) => text.indexOf(t))
      expect(order.every((i) => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      act(() => root?.unmount())
      host?.remove()
    }
  })

  it('the whole card opens the details through one stretched button; teacher names are plain text', () => {
    const opened: string[] = []
    const data = shape()
    const h = mount(<ClassCard occ={o('o4')} data={data} series={data.series.find((s) => s.id === o('o4').seriesId)} variant="comfortable" locale="en" msg={msg} profile={{ siteBase: '/en/cyce', segment: 'team' }} onOpen={(id) => opened.push(id)} />)
    const button = h.querySelector<HTMLButtonElement>('article[data-card] > button[aria-haspopup="dialog"]')!
    expect(button.getAttribute('aria-label')).toContain('Iyengar Yoga')
    act(() => button.click())
    expect(opened).toEqual(['o4'])
    // Even with People profile links configured, a card has no links at all.
    expect(h.querySelector('a')).toBeNull()
    expect(h.querySelector('[data-teachers]')?.textContent).toBe('Anna Rossi')
  })

  it('never shows Zoom ids, passcodes, join links or the full address', () => {
    const h = card(o('o4'))
    const text = h.textContent!
    for (const secret of ['SECRET-PASS', 'zoom.example', '123 456 789', 'Avenue', 'Room 04']) expect(text).not.toContain(secret)
  })

  it('a cancelled class is struck through with a Cancelled badge and no teacher or place', () => {
    const h = card(o('o3'))
    expect(h.querySelector('[data-status="cancelled"]')?.textContent).toBe('Cancelled')
    expect(h.querySelector('span[style*="line-through"]')?.textContent).toBe('18:00–19:00')
    expect(h.querySelector('p[style*="line-through"]')?.textContent).toContain('Méditation')
    expect(h.querySelector('[data-teachers]')).toBeNull()
    expect(h.querySelector('[data-place]')).toBeNull()
  })

  it('a substitute shows the actual substitute and a Substitute badge', () => {
    const h = card(o('o2'))
    expect(h.querySelector('[data-status="substitute"]')?.textContent).toBe('Substitute')
    expect(h.querySelector('[data-teachers]')?.textContent).toBe('Sabrina')
  })

  it('shows Time changed and Moved from the data layer’s change info, and the short place name', () => {
    const data = shape()
    data.places.l51 = { key: 'l51', name: 'Rue de la Loi 51', lines: [], mapsUrl: null, short: 'L51' } as never
    const changed = { ...o('o4'), placeKey: 'l51', start: '18:30', end: '19:30', change: { cancelled: false, substitute: false, timeChanged: true, moved: true, originalStart: '12:30', originalEnd: '13:30', originalDate: null, originalTeacherIds: [], originalPlaceKey: 'brey' } } as TimetableOccurrence
    const h = card(changed, 'compact', data)
    expect(h.querySelector('[data-status="timeChanged"]')?.textContent).toBe('Time changed')
    expect(h.querySelector('[data-status="moved"]')?.textContent).toBe('Moved')
    expect(h.querySelector('[data-place]')?.textContent).toBe('L51')
  })

  it('an event uses the same card with its Workshop tag', () => {
    const e: TimetableEvent = { id: 'e', eventId: 'e', title: 'Spring Workshop', slug: 'spring', date: '2026-12-09', start: '10:00', end: '12:00', placeName: 'BREY' }
    const h = mount(<EventCard event={e} variant="compact" msg={msg} eventsBase="/en/events" />)
    expect(h.querySelector('article[data-event]')?.getAttribute('data-card')).toBe('compact')
    expect(h.querySelector('[data-tag="workshop"]')?.textContent).toBe('Workshop')
    // The whole card is the link: one stretched <a> named by the title.
    const link = h.querySelector('a')!
    expect(link.getAttribute('href')).toBe('/en/events/spring')
    expect(link.getAttribute('aria-label')).toBe('Spring Workshop')
  })
})

// ── Phone agenda: pure logic ─────────────────────────────────────────────────

describe('agenda logic', () => {
  const days = [
    { date: '2026-12-07', top: -300 },
    { date: '2026-12-08', top: -120 },
    { date: '2026-12-09', top: 40 },
    { date: '2026-12-10', top: 400 },
  ]
  it('the active day is the last one whose top is at or above the line', () => {
    expect(pickActiveDay(days, 100)).toBe('2026-12-09')
    expect(pickActiveDay(days, 40)).toBe('2026-12-09')
    expect(pickActiveDay(days, 39)).toBe('2026-12-08')
    expect(pickActiveDay(days, 1000)).toBe('2026-12-10')
  })
  it('before the first day, or with no days', () => {
    expect(pickActiveDay(days, -1000)).toBe('2026-12-07')
    expect(pickActiveDay([], 10)).toBeNull()
  })
  it('the strip keeps its week while the active day is inside it, and advances or goes back when it leaves', () => {
    expect(nextStripMonday('2026-12-13', '2026-12-07')).toBe('2026-12-07')
    expect(nextStripMonday('2026-12-14', '2026-12-07')).toBe('2026-12-14')
    expect(nextStripMonday('2026-12-06', '2026-12-07')).toBe('2026-11-30')
  })
  it('lists every date of a range', () => {
    expect(datesBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
})

// ── Phone agenda: rendered ───────────────────────────────────────────────────

describe('phone agenda', () => {
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as never
    window.scrollTo = vi.fn() as never
  })
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('replaces the week and month views with one agenda: every day listed, empty days say so', () => {
    const h = mount(view())
    expect(h.querySelector('[data-agenda]')).toBeTruthy()
    expect(h.querySelector('[role="columnheader"]')).toBeNull()
    // The desktop toolbar is gone; the sticky strip has its own week buttons.
    expect(h.querySelector('[data-agenda-strip] button[aria-label="Previous week"]')).toBeTruthy()
    expect(h.querySelector('[data-agenda-strip] button[aria-label="Next week"]')).toBeTruthy()
    expect(h.querySelectorAll('[data-agenda-strip] [data-strip-day]')).toHaveLength(7)
    const days = [...h.querySelectorAll('[data-agenda] section[data-date]')]
    expect(days.map((d) => d.getAttribute('data-date'))).toEqual(Array.from({ length: 25 }, (_, i) => `2026-12-${String(i + 7).padStart(2, '0')}`))
    const day = (d: string) => days.find((x) => x.getAttribute('data-date') === d)!
    // Day heading "Wednesday, December 9" with the count on the right.
    expect(day('2026-12-09').querySelector('h3')?.textContent).toBe('Wednesday, December 9')
    expect(day('2026-12-09').textContent).toContain('No classes')
    expect(day('2026-12-09').querySelector('[data-card]')).toBeNull()
    expect(day('2026-12-07').querySelector('h3 + p')?.textContent).toBe('1 class')
    expect(day('2026-12-10').textContent).toContain('Cancelled')
    expect(day('2026-12-10').querySelector('[data-card="mobile"]')).toBeTruthy()
  })

  it('never goes further back than two weeks before the current week', () => {
    expect(PAST_WEEKS).toBe(2)
    // Today is Monday 7 Dec: the earliest day is Monday 23 Nov, even though the loaded data starts on 30 Nov.
    const h = mount(view())
    for (let i = 0; i < 3; i++) act(() => h.querySelector<HTMLButtonElement>('[data-agenda-strip] button[aria-label="Previous week"]')!.click())
    const first = h.querySelector<HTMLButtonElement>('[data-agenda-strip] [data-strip-day]')!
    expect((first.dataset.stripDay ?? '') >= '2026-11-23').toBe(true)
    expect((h.querySelector('[data-agenda] section[data-date]')!.getAttribute('data-date') ?? '') >= '2026-11-23').toBe(true)
    const input = h.querySelector<HTMLInputElement>('input[type="date"]')!
    expect(input.min).toBe('2026-11-23')
  })

  it('the Filters button is a compact icon button in the sticky strip', () => {
    const h = mount(view())
    const b = h.querySelector<HTMLButtonElement>('[data-agenda-strip] [data-filters-button]')!
    expect(b).toBeTruthy()
    expect(b.querySelector('svg')).toBeTruthy()
    expect(b.querySelector('.sr-only')?.textContent).toBe('Filters')
  })

  it('the sticky strip shows the month and year and the seven days; the active day carries aria-current', () => {
    const h = mount(view())
    expect(h.querySelector('[data-agenda-month]')?.textContent).toBe('December 2026')
    const strip = [...h.querySelectorAll<HTMLElement>('[data-strip-day]')]
    expect(strip.map((b) => b.dataset.stripDay)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'])
    expect(strip.filter((b) => b.getAttribute('aria-current') === 'date').map((b) => b.dataset.stripDay)).toEqual(['2026-12-07'])
  })

  it('tapping a day scrolls to it and makes it active', () => {
    const h = mount(view())
    act(() => h.querySelector<HTMLButtonElement>('[data-strip-day="2026-12-10"]')!.click())
    expect(window.scrollTo).toHaveBeenCalled()
    expect(h.querySelector('[data-strip-day="2026-12-10"]')?.getAttribute('aria-current')).toBe('date')
    expect(h.querySelector('[data-strip-day="2026-12-07"]')?.getAttribute('aria-current')).toBeNull()
  })

  it('jumping to a date in the next week moves the strip to that week', () => {
    const h = mount(view())
    const input = h.querySelector<HTMLInputElement>('input[type="date"]')!
    expect(input.getAttribute('aria-label')).toBe('Go to date')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-12-17')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const strip = [...h.querySelectorAll<HTMLElement>('[data-strip-day]')].map((b) => b.dataset.stripDay)
    expect(strip[0]).toBe('2026-12-14')
    expect(h.querySelector('[data-strip-day="2026-12-17"]')?.getAttribute('aria-current')).toBe('date')
  })

  it('without reduced motion the scroll is smooth, with it the scroll is instant', () => {
    const h = mount(view())
    act(() => h.querySelector<HTMLButtonElement>('[data-strip-day="2026-12-08"]')!.click())
    expect((window.scrollTo as unknown as { mock: { calls: [ScrollToOptions][] } }).mock.calls.at(-1)![0].behavior).toBe('smooth')
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never
    act(() => h.querySelector<HTMLButtonElement>('[data-strip-day="2026-12-09"]')!.click())
    expect((window.scrollTo as unknown as { mock: { calls: [ScrollToOptions][] } }).mock.calls.at(-1)![0].behavior).toBe('auto')
  })
})

// ── Filters ──────────────────────────────────────────────────────────────────

describe('filters', () => {
  const cards = (h: HTMLElement) => [...h.querySelectorAll('[data-card="comfortable"]')]
  /** Opens the Filters dialog (once) and returns the chip group of one filter. */
  const group = (h: HTMLElement, label: string) => {
    if (!document.querySelector('[role="dialog"] [data-filters="sheet"]')) act(() => h.querySelector<HTMLButtonElement>('[data-filters-button]')!.click())
    return document.querySelector<HTMLElement>(`[role="dialog"] [role="radiogroup"][aria-label="${label}"]`)!
  }
  const choose = (g: HTMLElement, name: string) => act(() => [...g.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((c) => c.textContent === name)!.click())

  it('options come from the loaded data', () => {
    const o = filterOptions(shape(), NO_FILTERS)
    expect(o.teachers.map((t) => t.label)).toEqual(['Anna Rossi', 'Sabrina'])
    expect(o.places.map((p) => p.label)).toEqual(['BREY'])
    expect(o.courses.map((c) => c.label)).toEqual(['Iyengar Yoga', 'Méditation'])
  })

  it('applyFilters narrows by teacher, place and class together', () => {
    const data = shape()
    expect(applyFilters(data, { ...NO_FILTERS, teacher: P2 }).occurrences.every((x) => x.teacherIds.includes(P2))).toBe(true)
    expect(applyFilters(data, { ...NO_FILTERS, place: 'brey' }).occurrences.every((x) => x.placeKey === 'brey')).toBe(true)
    const both = applyFilters(data, { ...NO_FILTERS, teacher: P2, course: data.occurrences.find((x) => x.id === 'o2')!.courseId })
    expect(both.occurrences.map((x) => x.id)).toEqual(['o2'])
    expect(activeFilterCount({ ...NO_FILTERS, teacher: P2, course: 'x' })).toBe(2)
  })

  it('the desktop toolbar filters the week and the filter keeps the selected week', () => {
    const h = mount(view())
    act(() => (h.querySelector('button[aria-label="Next week"]') as HTMLButtonElement).click())
    const label = h.querySelector('[aria-live="polite"]')!.textContent
    const before = cards(h).length
    expect(before).toBeGreaterThan(0)
    choose(group(h, 'Teacher'), 'Sabrina')
    expect(h.querySelector('[aria-live="polite"]')!.textContent).toBe(label)
    const after = cards(h)
    expect(after.length).toBeGreaterThan(0)
    expect(after.length).toBeLessThan(before)
    expect(after.every((c) => (c.querySelector('[data-teachers]')?.textContent ?? 'Sabrina').includes('Sabrina'))).toBe(true)
    // On computers the filter shows as a removable chip; removing it restores every class.
    const chip = h.querySelector<HTMLElement>('[data-filters="active"] button')!
    expect(chip.textContent).toContain('Teacher: Sabrina')
    act(() => chip.click())
    expect(cards(h).length).toBe(before)
    expect(h.querySelector('[data-filters="active"]')).toBeNull()
  })

  it('a filter with fewer than two options is not offered', () => {
    const only = OCCURRENCES.filter((x) => x.id === 'o1' || x.id === 'o3' || x.id === 'o5')
    const h = mount(view(shape(only)))
    expect(h.querySelector('[data-filters]')).toBeNull()
    expect(h.querySelector('[data-filters-button]')).toBeNull()
  })

  it('the filters live behind one Filters button that opens a dialog of chip groups', () => {
    const h = mount(view())
    const button = h.querySelector<HTMLButtonElement>('[data-filters-button]')!
    expect(button.textContent).toBe('Filters')
    expect(h.querySelector('select')).toBeNull()
    act(() => button.click())
    const sheet = document.querySelector('[role="dialog"] [data-filters="sheet"]')!
    const groups = [...sheet.querySelectorAll<HTMLElement>('[role="radiogroup"]')]
    expect(groups.length).toBeGreaterThanOrEqual(2)
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Language', 'Teacher']))
    // Each group starts with "All …", selected.
    for (const g of groups) {
      const first = g.querySelector('button[role="radio"]')!
      expect(first.textContent).toMatch(/^All /)
      expect(first.getAttribute('aria-checked')).toBe('true')
    }
    choose(group(h, 'Teacher'), 'Anna Rossi')
    expect(group(h, 'Teacher').querySelector('button[aria-checked="true"]')?.textContent).toBe('Anna Rossi')
    // The button shows how many filters are on.
    expect(h.querySelector<HTMLButtonElement>('[data-filters-button]')!.textContent).toBe('Filters1')
    // Reset clears them all.
    act(() => [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'Reset filters' || b.textContent === msg.resetFilters)!.click())
    expect(h.querySelector<HTMLButtonElement>('[data-filters-button]')!.textContent).toBe('Filters')
  })
})

// ── Schedule updates ─────────────────────────────────────────────────────────

describe('schedule updates', () => {
  it('lists the changes of a range with what changed, in time order', () => {
    const data = shape()
    const list = scheduleChangesIn(data, { from: '2026-12-07', to: '2026-12-13' })
    expect(list.map((i) => [i.date, i.kinds])).toEqual([
      ['2026-12-07', ['substitute']],
      ['2026-12-10', ['cancelled']],
    ])
    expect(scheduleChangesIn(data, { from: '2026-12-14', to: '2026-12-20' }).map((i) => i.kinds)).toEqual([['timeChanged']])
  })

  it('uses the data layer’s change info when present', () => {
    const data = shape()
    data.occurrences = data.occurrences.map((x) => (x.id === 'o4' ? ({ ...x, change: { cancelled: false, substitute: false, timeChanged: false, moved: true, originalStart: null, originalEnd: null, originalDate: null, originalTeacherIds: [], originalPlaceKey: 'brey' } } as TimetableOccurrence) : x))
    expect(scheduleChangesIn(data, { from: '2026-12-14', to: '2026-12-14' }).map((i) => i.kinds)).toEqual([['moved']])
  })

  it('shows date, time, course and the change; an item opens that session’s details', () => {
    const h = mount(view())
    const items = [...h.querySelectorAll<HTMLButtonElement>('[data-update-item]')]
    // Each item is a card: status pill, full date, then one sentence about the change.
    expect(items.map((b) => b.textContent)).toEqual(['Teacher changeMonday, December 7Iyengar Yoga at 12:30 — Sabrina replaces Anna Rossi', 'CancelledThursday, December 10Méditation at 18:00 — Cancelled'])
    expect(items[0].querySelector('[data-status="substitute"]')?.textContent).toBe('Teacher change')
    expect(items[1].querySelector('[data-status="cancelled"]')?.textContent).toBe('Cancelled')
    act(() => items[1].click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Méditation')
  })

  it('on computers shows at most 6 changes, with a "Show all N changes" button for the rest', () => {
    const data = shape()
    const items = Array.from({ length: 8 }, () => ({ occurrenceId: 'o3', date: '2026-12-10', start: '18:00', courseId: o('o3').courseId, kinds: ['cancelled' as const] }))
    // The items need distinct keys: point them at distinct copies of the cancelled session.
    data.occurrences = [...data.occurrences, ...items.map((it, i) => ({ ...o('o3'), id: `x${i}` }))]
    const list = items.map((it, i) => ({ ...it, occurrenceId: `x${i}` }))
    const h = mount(<ScheduleUpdates items={list} data={data} locale="en" msg={msg} onOpen={() => {}} />)
    expect(h.querySelectorAll('[data-update-item]')).toHaveLength(6)
    const more = [...h.querySelectorAll('button')].find((b) => b.textContent === 'Show all 8 changes')!
    expect(more.getAttribute('aria-expanded')).toBe('false')
    act(() => more.click())
    expect(h.querySelectorAll('[data-update-item]')).toHaveLength(8)
    expect(more.textContent).toBe(msg.showFewerChanges)
    // Up to 6: no button.
    unmountAll()
    const few = mount(<ScheduleUpdates items={list.slice(0, 6)} data={data} locale="en" msg={msg} onOpen={() => {}} />)
    expect(few.querySelector('[data-update-item]')).toBeTruthy()
    expect([...few.querySelectorAll('button')].some((b) => /Show all/.test(b.textContent ?? ''))).toBe(false)
  })

  it('on a phone it is a fixed-height pill in the sticky header that expands into an overlay list', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as never
    window.scrollTo = vi.fn() as never
    const h = mount(view())
    expect(h.querySelector('[data-schedule-updates]')).toBeNull() // no desktop list above the agenda
    const pill = h.querySelector<HTMLButtonElement>('[data-agenda-strip] [data-updates-summary]')!
    expect(pill.textContent).toContain('2 schedule changes this week')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
    expect(h.querySelector('[data-update-item]')).toBeNull()
    act(() => pill.click())
    expect(pill.getAttribute('aria-expanded')).toBe('true')
    const items = [...h.querySelectorAll<HTMLButtonElement>('[data-agenda-strip] [data-update-item]')]
    expect(items).toHaveLength(2)
    act(() => items[1].click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Méditation')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('on a phone a week without changes keeps the row, saying so', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as never
    window.scrollTo = vi.fn() as never
    const h = mount(view(shape(OCCURRENCES.filter((x) => x.id === 'o1' || x.id === 'o4'))))
    expect(h.querySelector('[data-agenda-strip] [data-updates-summary]')?.textContent).toBe('No changes this week')
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('a hidden agenda (desktop) never reports an active day or scrolls', () => {
    const io = vi.fn()
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor() {
        io()
      }
      observe() {}
      disconnect() {}
    }
    window.scrollTo = vi.fn() as never
    const h = mount(view()) // matchMedia absent: layout unknown, both trees rendered
    expect(io).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(h.querySelector('[data-agenda]')).toBeTruthy()
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  it('is hidden when nothing changed, and follows the filters', () => {
    const plain = OCCURRENCES.filter((x) => x.id === 'o1' || x.id === 'o4')
    expect(mount(view(shape(plain))).querySelector('[data-schedule-updates]')).toBeNull()
  })

  it('follows the filters', () => {
    const h = mount(view())
    expect(h.querySelector('[data-schedule-updates]')).toBeTruthy()
    act(() => h.querySelector<HTMLButtonElement>('[data-filters-button]')!.click())
    const teacher = document.querySelector<HTMLElement>('[role="dialog"] [role="radiogroup"][aria-label="Teacher"]')!
    act(() => [...teacher.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((c) => c.textContent === 'Anna Rossi')!.click())
    expect(h.querySelector('[data-schedule-updates]')).toBeNull()
  })
})
