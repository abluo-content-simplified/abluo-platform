/**
 * Courses — "will it be on the website?" (Publish = online). Read-only.
 *
 * A course appears on the website only through a timetable section of a
 * PUBLISHED page of the project. This reads those pages (raw perspective, no
 * drafts), the canonical origin (ADR-034) and the default language; the rule
 * itself is `coursePlacement()` (pure, tested). Used by publish / schedule
 * (refused when nothing would show the course) and by the editor ("View on
 * website", and the explanation before clicking).
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { canonicalOrigin } from '@/lib/seo/canonical'
import { pageIsOpen } from '@/lib/access/groq'
import { COURSE_READ_PERMISSION, CourseError, isCourseId } from '@/lib/api/course-lifecycle'
import { coursePlacement, normalizePlacementPages, type CoursePlacement, type PlacementInfo } from '@/lib/modules/courses/placement'

type Fetch = (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>
export type PlacementDeps = { client?: { fetch: Fetch } }

const RAW = { perspective: 'raw' } as const

/** Exported so tests assert exactly what runs. Published pages only; the picked courses are weak references (`_ref` = course document id). */
export const COURSE_PLACEMENT_QUERY = /* groq */ `{
  "pages": *[_type == "page" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && count(sections[_type == "timetableSection"]) > 0]{
    _id, pageType, "slugs": slug, "open": ${pageIsOpen()},
    "timetables": sections[_type == "timetableSection"]{ courseScope, "courseIds": courses[]._ref }
  },
  "domain": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && defined(customDomain)][0].customDomain,
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }
}`

/** The raw facts for one project (the thin fetch). */
export async function readPlacementInfo(client: { fetch: Fetch }, projectSlug: string): Promise<PlacementInfo> {
  const r = (await client.fetch(COURSE_PLACEMENT_QUERY, { projectSlug }, RAW)) as {
    pages?: unknown
    domain?: unknown
    site?: { defaultLocale?: unknown; supportedLocales?: unknown } | null
  } | null
  const domain = typeof r?.domain === 'string' ? r.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''
  const supported = Array.isArray(r?.site?.supportedLocales) ? (r!.site!.supportedLocales as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const defaultLocale = (typeof r?.site?.defaultLocale === 'string' && r.site.defaultLocale) || supported[0] || 'en'
  return {
    origin: canonicalOrigin(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain.toLowerCase() : null),
    defaultLocale,
    pages: normalizePlacementPages(r?.pages),
  }
}

/** Where the course shows on the website. courses.course.read; ids of other projects' courses are not probed (the answer only says "no"). */
export async function getCoursePlacement(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: PlacementDeps = {}): Promise<CoursePlacement> {
  assertModuleAction(ctx, projectId, COURSE_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) throw new CourseError('forbidden', 'No access to this project.')
  if (!isCourseId(input?.id)) throw new CourseError('not_found', 'Unknown course.')
  return coursePlacement(await readPlacementInfo(deps.client ?? sanityWriteClient, grant.projectSlug), input.id)
}
