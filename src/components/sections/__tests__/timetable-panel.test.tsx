// @vitest-environment jsdom
/**
 * The class details panel: opens from a class in the week and month views,
 * shows the course description, image, date and time, teachers, place with a
 * maps link, languages and the note; closes with Escape; never shows meeting
 * details the server did not send.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TimetableView } from '@/components/sections/timetable/TimetableView'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, COURSE_A, LOCATIONS, OCCURRENCES, PEOPLE, ROOMS, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data = (online: boolean) =>
  shapeTimetable({
    window: { from: '2026-11-30', to: '2026-12-31' },
    locale: 'en',
    defaultLocale: 'en',
    timeZone: 'Europe/Brussels',
    courses: COURSES.map((c) => (c.publicId === COURSE_A ? { ...c, shortDescription: 'A calm lunchtime class.\nBring a mat.', image: { asset: { _ref: 'image-abc123-800x600-jpg' } as never, hotspot: { x: 0.25, y: 0.75 } as never } } : c)),
    occurrences: OCCURRENCES,
    series: SERIES,
    closures: CLOSURES,
    people: PEOPLE,
    siteLocations: LOCATIONS,
    rooms: ROOMS,
    includeOnlineDetails: online,
  })

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function mount(view: 'week' | 'month', online = false) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <TimetableView
        locale="en"
        initial={{ month: '2026-12', today: '2026-12-07', data: data(online), onlineDetails: online }}
        defaultView={view}
        allowViewSwitch
        showPrintButton={false}
        title="Timetable"
        endpoint={null}
        pageId={null}
        sectionKey="s"
        profile={null}
      />,
    )
  })
}
const openers = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
const dialog = () => document.querySelector('[role="dialog"]')

describe('class details panel', () => {
  it('opens from the week view with description, image, when, place link and languages', () => {
    mount('week')
    const first = openers().find((b) => b.getAttribute('aria-label')?.includes('Monday'))!
    expect(first).toBeTruthy()
    act(() => first.click())
    const d = dialog()!
    expect(d).toBeTruthy()
    expect(d.getAttribute('aria-modal')).toBe('true')
    const text = d.textContent ?? ''
    expect(text).toContain('A calm lunchtime class.')
    expect(text).toContain('Monday, December 7, 2026')
    expect(text).toContain('12:30–13:30')
    expect(text).toContain('BREY')
    expect(text).toContain('Open in maps')
    expect(text).toContain('French, English')
    expect(d.querySelector('img')?.getAttribute('src')).toContain('abc123')
    expect(d.querySelector('a[href^="https://maps.google.com"]')).toBeTruthy()
  })

  it('closes with Escape', async () => {
    mount('week')
    act(() => openers()[0].click())
    expect(dialog()).toBeTruthy()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    await act(async () => void (await new Promise((r) => setTimeout(r, 600))))
    expect(dialog()).toBeNull()
  })

  it('opens from the month grid too', () => {
    mount('month')
    expect(openers().length).toBeGreaterThan(0)
    act(() => openers()[0].click())
    expect(dialog()).toBeTruthy()
  })

  it('never shows join links or passcodes when the server sent no meeting details', () => {
    mount('week')
    for (const b of openers()) {
      act(() => b.click())
      const text = dialog()?.textContent ?? ''
      expect(text).not.toContain('SECRET-PASS')
      expect(text).not.toContain('zoom.example')
    }
  })

  it('shows join details in the panel only when the server allowed them', () => {
    mount('week', true)
    const online = openers().filter((b) => {
      act(() => b.click())
      return (dialog()?.textContent ?? '').includes('SECRET-PASS')
    })
    expect(online.length).toBeGreaterThan(0)
  })
})
