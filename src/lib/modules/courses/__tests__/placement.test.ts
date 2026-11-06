import { describe, expect, it } from 'vitest'
import { coursePlacement, normalizePlacementPages, pagesShowingCourse, sectionShowsCourse, type PlacementInfo, type PlacementPage } from '../placement'

const page = (over: Partial<PlacementPage> = {}): PlacementPage => ({
  id: 'p1',
  pageType: 'services',
  slugs: { en: 'timetable', fr: 'horaires' },
  open: true,
  timetables: [{ courseScope: 'all', courseIds: [] }],
  ...over,
})
const info = (pages: PlacementPage[], over: Partial<PlacementInfo> = {}): PlacementInfo => ({ origin: 'https://www.cyce.info', defaultLocale: 'fr', pages, ...over })

describe('sectionShowsCourse — the website rule', () => {
  it('"all" (or anything but "pick") shows every course; "pick" only the picked', () => {
    expect(sectionShowsCourse({ courseScope: 'all', courseIds: [] }, 'c1')).toBe(true)
    expect(sectionShowsCourse({ courseScope: null, courseIds: [] }, 'c1')).toBe(true)
    expect(sectionShowsCourse({ courseScope: 'pick', courseIds: ['c1'] }, 'c1')).toBe(true)
    expect(sectionShowsCourse({ courseScope: 'pick', courseIds: ['c2'] }, 'c1')).toBe(false)
    expect(sectionShowsCourse({ courseScope: 'pick', courseIds: [] }, 'c1')).toBe(false)
  })
})

describe('coursePlacement', () => {
  it('no page with a timetable = not on the website', () => {
    expect(coursePlacement(info([]), 'c1')).toEqual({ onWebsite: false, url: null })
  })

  it('a page whose sections pick other courses does not show it; one more section that does, does', () => {
    const only = page({ timetables: [{ courseScope: 'pick', courseIds: ['c2'] }] })
    expect(coursePlacement(info([only]), 'c1').onWebsite).toBe(false)
    const both = page({ timetables: [{ courseScope: 'pick', courseIds: ['c2'] }, { courseScope: 'pick', courseIds: ['c1'] }] })
    expect(coursePlacement(info([both]), 'c1').onWebsite).toBe(true)
  })

  it('the address is the page in the default language on the canonical origin', () => {
    expect(coursePlacement(info([page()]), 'c1')).toEqual({ onWebsite: true, url: 'https://www.cyce.info/fr/horaires' })
    expect(coursePlacement(info([page()], { defaultLocale: 'en' }), 'c1').url).toBe('https://www.cyce.info/en/timetable')
  })

  it('a page without a slug in the default language falls back to a language it has', () => {
    expect(coursePlacement(info([page({ slugs: { en: 'timetable' } })]), 'c1').url).toBe('https://www.cyce.info/en/timetable')
  })

  it('the home page is the language root; a page with no slug at all cannot be visited', () => {
    expect(coursePlacement(info([page({ pageType: 'home', slugs: {} })]), 'c1')).toEqual({ onWebsite: true, url: 'https://www.cyce.info/fr' })
    expect(coursePlacement(info([page({ slugs: {} })]), 'c1')).toEqual({ onWebsite: false, url: null })
  })

  it('prefers a public page over a protected one', () => {
    const protectedPage = page({ id: 'p0', open: false, slugs: { fr: 'membres' } })
    const open = page({ id: 'p2', slugs: { fr: 'public' } })
    expect(pagesShowingCourse([protectedPage, open], 'c1').map((p) => p.id)).toEqual(['p2', 'p0'])
    expect(coursePlacement(info([protectedPage, open]), 'c1').url).toBe('https://www.cyce.info/fr/public')
    expect(coursePlacement(info([protectedPage]), 'c1')).toEqual({ onWebsite: true, url: 'https://www.cyce.info/fr/membres' })
  })

  it('without a domain it is online but has no address to show', () => {
    expect(coursePlacement(info([page()], { origin: null }), 'c1')).toEqual({ onWebsite: true, url: null })
  })
})

describe('normalizePlacementPages', () => {
  it('reads the query rows, drops malformed ones, strips slashes', () => {
    const pages = normalizePlacementPages([
      { _id: 'a', pageType: 'home', slugs: { _type: 'localizedSlug', en: { current: '/x/' } }, open: true, timetables: [{ courseScope: 'pick', courseIds: ['c1', null, 5] }, null] },
      { _id: 'b', slugs: null, open: false, timetables: [] },
      { nope: true },
      null,
    ])
    expect(pages).toEqual([
      { id: 'a', pageType: 'home', slugs: { en: 'x' }, open: true, timetables: [{ courseScope: 'pick', courseIds: ['c1'] }, { courseScope: null, courseIds: [] }] },
      { id: 'b', pageType: null, slugs: {}, open: false, timetables: [] },
    ])
    expect(normalizePlacementPages(undefined)).toEqual([])
  })
})
