import type { MetadataRoute } from 'next'
import { canonicalUrl } from './canonical'
import { cleanCourseSegments } from '@/lib/modules/courses/website'

/**
 * Course pages in the sitemap (ADR-045 D5; Requirement 4 of the Publicly
 * Routable Content Pattern) for ONE project.
 *
 * The rows come from SITEMAP_COURSES_QUERY (src/lib/modules/courses/queries.ts),
 * which already keeps only courses that are on the website (published, go-live
 * date passed, not archived) — drafts, scheduled and archived courses never
 * appear. The caller reads them only for a project whose Courses installation
 * is enabled and has a segment. This turns rows into URLs: one per site locale
 * where BOTH the course's slug and the language's course segment are set. Pure,
 * so it is tested without a request.
 */
export type CourseSitemapRow = {
  slugMap?: Record<string, { current?: string | null } | undefined> | null
  _updatedAt?: string | null
  /** The course page is members only (it takes the access of its timetable pages): never listed. */
  membersOnly?: boolean | null
}

export function courseSitemapEntries(opts: {
  rows: readonly CourseSitemapRow[] | null | undefined
  /** Raw module config `courseSegment` (a localizedString); invalid entries are ignored. */
  courseSegment: unknown
  origin: string
  locales: readonly string[]
  primaryLocale: string
}): MetadataRoute.Sitemap {
  const segments = cleanCourseSegments(opts.courseSegment)
  const out: MetadataRoute.Sitemap = []
  for (const row of opts.rows ?? []) {
    if (row.membersOnly) continue
    for (const locale of opts.locales) {
      const segment = segments[locale]
      const slug = row.slugMap?.[locale]?.current
      if (!segment || !slug) continue
      out.push({
        url: canonicalUrl(opts.origin, locale, segment, slug)!,
        ...(row._updatedAt ? { lastModified: new Date(row._updatedAt) } : {}),
        changeFrequency: 'weekly',
        priority: locale === opts.primaryLocale ? 0.6 : 0.5,
      })
    }
  }
  return out
}
