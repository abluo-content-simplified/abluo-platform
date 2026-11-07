/**
 * Course pages (ADR-045 D5) — the pure rules the route, the listing section and
 * the timetable link share: the configurable segment, the dispatch plan, the
 * lookup outcomes (no slug fallback; archived / unpublished = no page), and the
 * three website lookups' scoping.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  cleanCourseSegment,
  cleanCourseSegments,
  courseHref,
  coursePathsByLocale,
  courseSegmentFor,
  isCoursesModuleOn,
  planCourseRoute,
  resolveCourseRoute,
} from '../website'
import { loadCourseRoute, loadTimetablePages } from '../route'
import {
  COURSES_BY_PUBLIC_IDS_QUERY,
  COURSES_LISTING_QUERY,
  COURSE_BY_OLD_SLUG_QUERY,
  COURSE_BY_SLUG_QUERY,
  COURSE_PUBLIC_FIELDS,
  COURSE_TIMETABLE_PAGES_QUERY,
  COURSE_VISIBLE,
  SITEMAP_COURSES_QUERY,
} from '../queries'
import { findTenantScopeViolation } from '@/lib/sanity/client'

describe('course segment (module config courseSegment)', () => {
  it('keeps one lowercase url-safe segment and drops platform words', () => {
    expect(cleanCourseSegment('classes')).toBe('classes')
    expect(cleanCourseSegment(' /Corsi/ ')).toBe('corsi')
    // "courses" is the dashboard's own route word (reserved-slugs.ts), like "people".
    for (const bad of ['', 'a/b', 'our courses', 'x--y', '-x', 'blog', 'studio', 'api', 'courses', 'people', 42, null]) expect(cleanCourseSegment(bad), String(bad)).toBeNull()
  })

  it('reads a localizedString per language, no fallback between languages', () => {
    const cfg = [{ moduleId: 'courses', config: { courseSegment: { _type: 'localizedString', en: 'classes', fr: 'cours', de: 'blog' } } }]
    expect(cleanCourseSegments(cfg[0].config.courseSegment)).toEqual({ en: 'classes', fr: 'cours' })
    expect(courseSegmentFor(cfg, 'fr')).toBe('cours')
    expect(courseSegmentFor(cfg, 'de')).toBeNull()
    expect(courseSegmentFor(cfg, 'it')).toBeNull()
    expect(courseSegmentFor([], 'en')).toBeNull()
    expect(courseSegmentFor(null, 'en')).toBeNull()
    // Another module's config is never read.
    expect(courseSegmentFor([{ moduleId: 'people', config: { courseSegment: { en: 'courses' } } }], 'en')).toBeNull()
  })

  it('gates on the courses installation (unresolved fails open)', () => {
    expect(isCoursesModuleOn(null)).toBe(true)
    expect(isCoursesModuleOn(['courses', 'people'])).toBe(true)
    expect(isCoursesModuleOn(['people'])).toBe(false)
    expect(isCoursesModuleOn([])).toBe(false)
  })

  it('builds links only where a segment and a slug exist', () => {
    expect(courseHref('iyengar-yoga', { siteBase: '/en/cyce', segment: 'courses' })).toBe('/en/cyce/courses/iyengar-yoga')
    expect(courseHref('iyengar-yoga', { siteBase: '', segment: 'cours' })).toBe('/cours/iyengar-yoga')
    expect(courseHref(null, { siteBase: '', segment: 'cours' })).toBeNull()
    expect(courseHref('x', { siteBase: '', segment: null })).toBeNull()
    expect(courseHref('x', null)).toBeNull()
  })

  it('pairs segment + slug per site language (hreflang / language switcher)', () => {
    const slugMap = { fr: { current: 'yoga-iyengar' }, en: { current: 'iyengar-yoga' }, de: { current: 'iyengar' } }
    expect(coursePathsByLocale(slugMap, { fr: 'cours', en: 'courses' }, ['fr', 'en', 'de', 'it'])).toEqual({
      fr: ['cours', 'yoga-iyengar'],
      en: ['courses', 'iyengar-yoga'],
    })
  })
})

describe('planCourseRoute', () => {
  it('dispatches exactly /{segment}/{slug}', () => {
    expect(planCourseRoute(['courses', 'iyengar-yoga'], 'courses')).toEqual({ slug: 'iyengar-yoga' })
    expect(planCourseRoute(['Courses', 'iyengar-yoga'], 'courses')).toEqual({ slug: 'iyengar-yoga' })
    expect(planCourseRoute(['cours', 'm%C3%A9ditation'], 'cours')).toEqual({ slug: 'méditation' })
  })
  it('anything else falls through to the page lookup', () => {
    expect(planCourseRoute(['courses'], 'courses')).toBeNull()
    expect(planCourseRoute(['courses', 'a', 'b'], 'courses')).toBeNull()
    expect(planCourseRoute(['team', 'anna'], 'courses')).toBeNull()
    expect(planCourseRoute(['courses', 'a'], null)).toBeNull()
  })
})

describe('resolveCourseRoute', () => {
  const lookups = (bySlug: unknown, old: unknown) => ({ bySlug: vi.fn(async () => bySlug as never), byOldSlug: vi.fn(async () => old as never) })
  it('found by the current slug; the redirect lookup is not needed', async () => {
    const l = lookups({ title: 'Yoga' }, null)
    expect(await resolveCourseRoute(l, 'yoga')).toEqual({ kind: 'found', course: { title: 'Yoga' } })
    expect(l.byOldSlug).not.toHaveBeenCalled()
  })
  it('a retired slug redirects to the current one', async () => {
    expect(await resolveCourseRoute(lookups(null, { currentSlug: 'yoga-new' }), 'yoga-old')).toEqual({ kind: 'redirect', slug: 'yoga-new' })
  })
  it('nothing (archived, unpublished, other site, no slug in this language) → none = 404', async () => {
    expect(await resolveCourseRoute(lookups(null, null), 'x')).toEqual({ kind: 'none' })
    expect(await resolveCourseRoute(lookups(null, { currentSlug: null }), 'x')).toEqual({ kind: 'none' })
    expect(await resolveCourseRoute(lookups(null, { currentSlug: 'x' }), 'x')).toEqual({ kind: 'none' })
  })
  it('loadCourseRoute sends the two literal queries with the route params', async () => {
    const fetch = vi.fn(async (q: string) => (q === COURSE_BY_SLUG_QUERY ? null : { currentSlug: 'new' })) as never
    const params = { slug: 'old', locale: 'fr', defaultLocale: 'fr' }
    expect(await loadCourseRoute(fetch, params)).toEqual({ kind: 'redirect', slug: 'new' })
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toEqual([
      [COURSE_BY_SLUG_QUERY, params],
      [COURSE_BY_OLD_SLUG_QUERY, params],
    ])
  })
  it('loadTimetablePages fails soft', async () => {
    expect(await loadTimetablePages((async () => { throw new Error('x') }) as never)).toEqual([])
  })
})

describe('website course queries', () => {
  const all = { COURSE_BY_SLUG_QUERY, COURSE_BY_OLD_SLUG_QUERY, SITEMAP_COURSES_QUERY, COURSE_TIMETABLE_PAGES_QUERY, COURSES_BY_PUBLIC_IDS_QUERY, COURSES_LISTING_QUERY }
  it('are tenant-scoped (the runtime detector accepts them)', () => {
    for (const [name, q] of Object.entries(all)) {
      expect(q, name).toContain('projectSlug == $projectSlug')
      expect(findTenantScopeViolation(q, name), name).toBeNull()
    }
  })
  it('publish = online: every course read carries the visibility rule (published, date passed, not archived)', () => {
    expect(COURSE_VISIBLE).toContain('!(_id in path("drafts.**"))')
    expect(COURSE_VISIBLE).toContain('!defined(archivedAt)')
    expect(COURSE_VISIBLE).toContain('publishedAt <= now()')
    for (const q of [COURSE_BY_SLUG_QUERY, COURSE_BY_OLD_SLUG_QUERY, SITEMAP_COURSES_QUERY, COURSES_BY_PUBLIC_IDS_QUERY, COURSES_LISTING_QUERY]) expect(q).toContain(COURSE_VISIBLE)
  })
  it('the primary lookup has NO slug fallback; the redirect lookup reads redirectFrom of this language', () => {
    expect(COURSE_BY_SLUG_QUERY).toContain('slug[$locale].current == $slug')
    expect(COURSE_BY_SLUG_QUERY).not.toMatch(/coalesce\(slug/)
    expect(COURSE_BY_SLUG_QUERY).toContain('"slugMap": slug')
    expect(COURSE_BY_OLD_SLUG_QUERY).toContain('$slug in redirectFrom[$locale]')
    // The page language's own slug, never another language's.
    expect(COURSE_PUBLIC_FIELDS).toContain('"slug": slug[$locale].current')
  })
  it('never reads meeting details, private notes or internal fields', () => {
    for (const q of Object.values(all)) {
      for (const word of ['meeting', 'passcode', 'joinUrl', 'translationStatus', 'notes']) expect(q).not.toContain(word)
    }
  })
  it('the timetable-page lookup reads published pages only, with their Access state', () => {
    expect(COURSE_TIMETABLE_PAGES_QUERY).toContain('!(_id in path("drafts.**"))')
    expect(COURSE_TIMETABLE_PAGES_QUERY).toContain('"open":')
    expect(COURSE_TIMETABLE_PAGES_QUERY).toContain('_type == "timetableSection"')
  })
})
