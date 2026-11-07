// ── Hydration of a Course List section (ADR-045 D5) ───────────────────────────
//
// Called by hydrateSections (the ONE hydration path shared by every page
// route). Fills `section.courseList` with the courses to show, in order:
//   • picked courses (`courseCount > 0`) — the editor's order, only those that
//     are on the website (published, go-live date passed, not archived);
//   • otherwise every course that is on the website, by title.
// The section is presentation only: the course rows come from the module's own
// projection (COURSE_PUBLIC_FIELDS) and nothing else.

import type { CourseListCourse, CourseListSection } from '@/lib/sanity/types'
import { COURSES_BY_PUBLIC_IDS_QUERY, COURSES_LISTING_QUERY } from './queries'

type Fetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

/** The picked publicIds (unique, in order) — or undefined when the section shows every course. */
export function courseListIds(section: Pick<CourseListSection, 'courseIds' | 'courseCount'>): string[] | undefined {
  if ((section.courseCount ?? 0) <= 0) return undefined
  return [...new Set((section.courseIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

/** Rows in the order of `ids`; rows without a title are dropped (a course with no words in any language shows nothing). */
export function orderCourses(rows: readonly CourseListCourse[] | null | undefined, ids: readonly string[] | undefined): CourseListCourse[] {
  const list = (rows ?? []).filter((r): r is CourseListCourse => !!r?.publicId && !!r.title?.trim())
  if (!ids) return list
  const byId = new Map(list.map((r) => [r.publicId, r]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

export async function hydrateCourseListSection(
  section: CourseListSection,
  ctx: { locale: string; defaultLocale: string; fetchForTenant: Fetch },
): Promise<void> {
  const ids = courseListIds(section)
  const params = { locale: ctx.locale, defaultLocale: ctx.defaultLocale }
  const rows = ids
    ? ids.length
      ? await ctx.fetchForTenant<CourseListCourse[]>(COURSES_BY_PUBLIC_IDS_QUERY, { ...params, publicIds: ids })
      : []
    : await ctx.fetchForTenant<CourseListCourse[]>(COURSES_LISTING_QUERY, params)
  section.courseList = orderCourses(rows, ids)
}
