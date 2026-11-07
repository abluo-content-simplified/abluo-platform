// @vitest-environment jsdom
/**
 * The timetable class panel links "About this course" to the course's own page
 * (ADR-045 D5) — only when the course has a slug in this language AND the site
 * has a course segment in this language.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TimetableView } from '@/components/sections/timetable/TimetableView'
import { shapeTimetable } from '@/lib/modules/courses/timetable'
import { CLOSURES, COURSES, COURSE_A, LOCATIONS, OCCURRENCES, PEOPLE, SERIES } from '@/lib/modules/courses/__tests__/timetable-fixtures'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data = () =>
  shapeTimetable({
    window: { from: '2026-11-30', to: '2026-12-31' },
    locale: 'en',
    defaultLocale: 'en',
    timeZone: 'Europe/Brussels',
    courses: COURSES.map((c) => (c.publicId === COURSE_A ? { ...c, slug: 'iyengar-yoga' } : c)),
    occurrences: OCCURRENCES,
    series: SERIES,
    closures: CLOSURES,
    people: PEOPLE,
    siteLocations: LOCATIONS,
    includeOnlineDetails: false,
  })

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function mount(coursePage: { siteBase: string; segment: string | null } | null) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <TimetableView locale="en" initial={{ month: '2026-12', today: '2026-12-07', data: data(), onlineDetails: false }} defaultView="week" allowViewSwitch showPrintButton={false} title="Timetable" endpoint={null} pageId={null} sectionKey="s" profile={null} coursePage={coursePage} />,
    )
  })
}
const openers = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
const courseLinks = () => {
  const out: Array<{ title: string; href: string | null }> = []
  for (const b of openers()) {
    act(() => b.click())
    const d = document.querySelector('[role="dialog"]')!
    const a = d.querySelector('a[data-course-page]')
    out.push({ title: d.textContent ?? '', href: a?.getAttribute('href') ?? null })
  }
  return out
}

describe('class panel → course page', () => {
  it('links the course that has a page in this language, and only that one', () => {
    mount({ siteBase: '/en/cyce', segment: 'courses' })
    const links = courseLinks()
    const iyengar = links.filter((l) => l.title.includes('Iyengar'))
    const other = links.filter((l) => !l.title.includes('Iyengar'))
    expect(iyengar.length).toBeGreaterThan(0)
    expect(iyengar.every((l) => l.href === '/en/cyce/courses/iyengar-yoga')).toBe(true)
    expect(other.length).toBeGreaterThan(0)
    expect(other.every((l) => l.href === null)).toBe(true)
    expect(iyengar.every((l) => l.title.includes('About this course'))).toBe(true)
    expect(other.some((l) => l.title.includes('About this course'))).toBe(false)
  })

  it('no course segment (or no config) → no link', () => {
    mount({ siteBase: '/en/cyce', segment: null })
    expect(courseLinks().every((l) => l.href === null)).toBe(true)
  })
})
