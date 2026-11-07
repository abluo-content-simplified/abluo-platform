// ── Courses module — where a course shows on the website (pure, browser-safe) ──
//
// The website shows a course through a `timetableSection` on a PUBLISHED page
// and — when the site has course pages (Courses module `courseSegment`,
// ADR-045 D5) — on the course's own page. So "is this course online?" is a
// question about the site's pages and settings, answered here from plain data
// read by `src/lib/api/course-placement.ts` (the thin fetch). Same rule as the
// website (`sectionCourseIds`): a section with "Pick courses" shows exactly the
// picked ones, any other section shows every visible course.

import { canonicalUrl } from '@/lib/seo/canonical'

/** One timetable section of a page, as stored: its scope and the picked courses' document ids. */
export interface PlacementTimetable {
  courseScope: string | null
  /** Sanity document ids of the picked courses (`courses[]._ref`). */
  courseIds: string[]
}

/** One published page that carries at least one timetable section. */
export interface PlacementPage {
  id: string
  pageType: string | null
  /** Slug per language (no fallback), without slashes. */
  slugs: Record<string, string>
  /** No Access protection (visible to everybody). */
  open: boolean
  timetables: PlacementTimetable[]
}

export interface PlacementInfo {
  /** `https://www.<domain>` (canonicalOrigin) or null while the site has no domain. */
  origin: string | null
  defaultLocale: string
  pages: PlacementPage[]
  /** Course page segments per language (cleaned module config); absent/{} = no course pages on this site. */
  courseSegments?: Record<string, string>
  /** The PUBLISHED course's page address per language, when known. */
  courseSlugs?: Record<string, string>
}

/** Does this section show the course (by document id)? */
export function sectionShowsCourse(section: PlacementTimetable, courseDocId: string): boolean {
  return section.courseScope === 'pick' ? section.courseIds.includes(courseDocId) : true
}

/** The pages (open ones first) that show the course. */
export function pagesShowingCourse(pages: readonly PlacementPage[], courseDocId: string): PlacementPage[] {
  const showing = pages.filter((p) => p.timetables.some((s) => sectionShowsCourse(s, courseDocId)))
  return [...showing.filter((p) => p.open), ...showing.filter((p) => !p.open)]
}

export interface CoursePlacement {
  /** At least one published page shows the course in a timetable. */
  onWebsite: boolean
  /** Address of the timetable page in the site's default language (any language when it has none there); null without a domain. */
  url: string | null
}

/**
 * Where a course appears: `onWebsite`, and the address to open. The course's own
 * page wins (default language, else any language with a segment and an
 * address). A site with a course segment in its default language always gives
 * a published course a page there (publish fills the address from the required
 * main-language title), so such a course is on the website even before it has
 * an address.
 */
export function coursePlacement(info: PlacementInfo, courseDocId: string): CoursePlacement {
  const segments = info.courseSegments ?? {}
  const slugs = info.courseSlugs ?? {}
  const pageLocales = [info.defaultLocale, ...Object.keys(segments).filter((l) => l !== info.defaultLocale)]
  for (const loc of pageLocales) {
    if (segments[loc] && slugs[loc]) return { onWebsite: true, url: canonicalUrl(info.origin, loc, segments[loc], slugs[loc]) ?? null }
  }
  const pagesOn = !!segments[info.defaultLocale]
  for (const page of pagesShowingCourse(info.pages, courseDocId)) {
    const home = page.pageType === 'home'
    const locale = (page.slugs[info.defaultLocale] || home) ? info.defaultLocale : Object.keys(page.slugs)[0]
    // A page with no slug in any language (and not the home page) cannot be visited.
    if (!home && !locale) continue
    return { onWebsite: true, url: canonicalUrl(info.origin, locale!, home ? null : page.slugs[locale!]) ?? null }
  }
  return { onWebsite: pagesOn, url: null }
}

/** `{ en: { current: 'yoga' } }` (a stored localizedSlug) → `{ en: 'yoga' }`; anything malformed is skipped. */
export function normalizeSlugMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [loc, v] of Object.entries(raw as Record<string, unknown>)) {
    if (loc.startsWith('_')) continue
    const cur = (v as { current?: unknown } | null)?.current
    if (typeof cur === 'string' && cur) out[loc] = cur
  }
  return out
}

/** Reads the raw query rows into PlacementPage[] (anything malformed is skipped). */
export function normalizePlacementPages(raw: unknown): PlacementPage[] {
  if (!Array.isArray(raw)) return []
  const out: PlacementPage[] = []
  for (const row of raw as Array<Record<string, unknown> | null>) {
    if (!row || typeof row._id !== 'string') continue
    const slugs: Record<string, string> = {}
    if (row.slugs && typeof row.slugs === 'object') {
      for (const [loc, v] of Object.entries(row.slugs as Record<string, unknown>)) {
        if (loc.startsWith('_')) continue
        const cur = typeof v === 'string' ? v : (v as { current?: unknown } | null)?.current
        if (typeof cur === 'string' && cur.replace(/^\/+|\/+$/g, '')) slugs[loc] = cur.replace(/^\/+|\/+$/g, '')
      }
    }
    const timetables = (Array.isArray(row.timetables) ? (row.timetables as Array<Record<string, unknown> | null>) : []).map((s) => ({
      courseScope: typeof s?.courseScope === 'string' ? s.courseScope : null,
      courseIds: (Array.isArray(s?.courseIds) ? (s!.courseIds as unknown[]) : []).filter((x): x is string => typeof x === 'string' && x.length > 0),
    }))
    out.push({ id: row._id, pageType: typeof row.pageType === 'string' ? row.pageType : null, slugs, open: row.open !== false, timetables })
  }
  return out
}
