// ── Courses — course page route lookups (ADR-045 D5) ──────────────────────────
//
// The reads of a course page URL, bound to the tenant-scoped client. Kept in
// their own file so every fetchForTenant call site names its query directly
// (fetch-for-tenant-call-sites.test.ts proves each is tenant-scoped).

import { COURSE_BY_OLD_SLUG_QUERY, COURSE_BY_SLUG_QUERY, COURSE_GATE_PAGE_QUERY, COURSE_TIMETABLE_PAGES_QUERY } from './queries'
import { resolveCourseRoute, type CourseRouteOutcome, type CoursesFetch } from './website'

export function loadCourseRoute<C>(
  fetchForTenant: CoursesFetch,
  params: { slug: string; locale: string; defaultLocale: string },
): Promise<CourseRouteOutcome<C>> {
  return resolveCourseRoute<C>(
    {
      bySlug: () => fetchForTenant<C | null>(COURSE_BY_SLUG_QUERY, params),
      byOldSlug: () => fetchForTenant<{ currentSlug?: string | null } | null>(COURSE_BY_OLD_SLUG_QUERY, params),
    },
    params.slug,
  )
}

/** The raw rows of the site's published timetable pages (normalizePlacementPages reads them). A failure reads as none. */
export async function loadTimetablePages(fetchForTenant: CoursesFetch): Promise<unknown> {
  try {
    return await fetchForTenant<unknown>(COURSE_TIMETABLE_PAGES_QUERY, {})
  } catch {
    return []
  }
}

/** Access fields of ONE timetable page (COURSE_GATE_PAGE_QUERY); a failure reads as none (→ denied by the caller). */
export async function loadCourseGatePage(
  fetchForTenant: CoursesFetch,
  params: { pageId: string; locale: string; defaultLocale: string; ancestorPaths: string[] },
): Promise<CourseGatePageRow | null> {
  try {
    return await fetchForTenant<CourseGatePageRow | null>(COURSE_GATE_PAGE_QUERY, params)
  } catch {
    return null
  }
}

export type CourseGatePageRow = {
  access?: unknown
  ancestorAccess?: Array<{ access?: unknown }> | null
  contentWithheld?: boolean | null
  accessPromptNote?: unknown
}
