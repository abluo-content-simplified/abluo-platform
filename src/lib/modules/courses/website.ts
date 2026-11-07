// ── Courses module — website helpers (ADR-045 D5: course pages) ───────────────
//
// Pure. The rules the course page route, the course listing section and the
// timetable's "About this course" link share:
//   • is the Courses module installed for this site (placement gating),
//   • the per-language base path of course pages (module config `courseSegment`),
//   • the course page dispatch and its redirect outcome.
//
// The base path is NEVER hardcoded ("classes", "cours" …): it is the module
// config, validated on save (config-validators.ts `courses.courseSegment`). The
// route still defends itself: a value that is not one lowercase url-safe
// segment, or that is a platform route word, is ignored (no dispatch, no links).
//
// Same shape as the People profile pages (src/lib/modules/people/website.ts),
// with one difference Tom asked for: a course that is archived or not (yet)
// published has NO page — its address is a plain 404, no redirect.

import { isReservedSlug } from '@/lib/platform/reserved-slugs'
import { getModuleConfig, type ProjectModuleConfig } from '@/lib/modules/config'
import { COURSES_MODULE_ID } from './model'

/** One lowercase url-safe segment: `classes`, `corsi`, `our-courses` ("courses" itself is a reserved dashboard word). */
export const COURSE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const COURSE_SEGMENT_MAX_LENGTH = 64

/**
 * Module gating, same contract as isSectionTypeAvailable: an unresolved module
 * list (null) fails open; a resolved list must contain `courses`.
 */
export function isCoursesModuleOn(enabledModuleIds: readonly string[] | null | undefined): boolean {
  return enabledModuleIds == null || enabledModuleIds.includes(COURSES_MODULE_ID)
}

/** A usable segment or null. */
export function cleanCourseSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!v || v.length > COURSE_SEGMENT_MAX_LENGTH) return null
  if (!COURSE_SEGMENT_PATTERN.test(v)) return null
  if (isReservedSlug(v)) return null
  return v
}

/** Per-language course segments from a raw `courseSegment` localizedString (invalid entries dropped). */
export function cleanCourseSegments(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [loc, v] of Object.entries(raw as Record<string, unknown>)) {
    if (loc.startsWith('_')) continue
    const s = cleanCourseSegment(v)
    if (s) out[loc] = s
  }
  return out
}

/** Every language's course segment for this site ({} when nothing is configured). */
export function courseSegments(moduleConfig: ProjectModuleConfig): Record<string, string> {
  return cleanCourseSegments(getModuleConfig(moduleConfig, COURSES_MODULE_ID)?.courseSegment)
}

/** The course base path in one language, or null (nothing configured). No locale fallback. */
export function courseSegmentFor(moduleConfig: ProjectModuleConfig, locale: string): string | null {
  return courseSegments(moduleConfig)[locale] ?? null
}

/** What the website needs to link a course: the site base and the language's course segment. */
export interface CourseLinkContext {
  siteBase: string
  segment: string | null
}

/** The page URL path of a course, or null (no segment in this language, no slug in this language). */
export function courseHref(slug: string | null | undefined, ctx: CourseLinkContext | null | undefined): string | null {
  if (!ctx?.segment || !slug) return null
  return `${ctx.siteBase}/${ctx.segment}/${slug}`
}

/** locale → [segment, slug], only where BOTH exist (a language without either has no course page). */
export function coursePathsByLocale(
  slugMap: Record<string, { current?: string | null } | null | undefined> | null | undefined,
  segments: Record<string, string>,
  locales: readonly string[],
): Record<string, [string, string] | undefined> {
  const out: Record<string, [string, string] | undefined> = {}
  for (const loc of locales) {
    const slug = slugMap?.[loc]?.current
    const segment = segments[loc]
    if (slug && segment) out[loc] = [segment, slug]
  }
  return out
}

// ── Course page route ─────────────────────────────────────────────────────────

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** `[segment, slug]` under this language's course segment → the slug; anything else → null (falls through to the page lookup). */
export function planCourseRoute(
  segments: readonly string[],
  segment: string | null | undefined,
): { slug: string } | null {
  if (!segment || segments.length !== 2) return null
  const [first, slug] = segments.map(safeDecode)
  if (!slug || first.toLowerCase() !== segment) return null
  return { slug }
}

export type CourseRouteOutcome<C> =
  | { kind: 'found'; course: C }
  | { kind: 'redirect'; slug: string }
  | { kind: 'none' }

/** The slug-lookup fetcher shape both the route and the tests use. */
export type CoursesFetch = <T>(query: string, params: Record<string, unknown>) => Promise<T>

/**
 * Requirements 2–3 of the routable pattern for a course: primary lookup with NO
 * slug fallback, then the redirect lookup. Both lookups only see courses that
 * are on the website (published, go-live date passed, not archived), so an
 * archived or unpublished course ends as `none` → 404. The lookups are passed in
 * so each `fetchForTenant` call site keeps an imported query (see route.ts).
 */
export async function resolveCourseRoute<C>(
  lookups: {
    bySlug: () => Promise<C | null>
    byOldSlug: () => Promise<{ currentSlug?: string | null } | null>
  },
  slug: string,
): Promise<CourseRouteOutcome<C>> {
  const course = await lookups.bySlug()
  if (course) return { kind: 'found', course }
  const old = await lookups.byOldSlug()
  if (old?.currentSlug && old.currentSlug !== slug) return { kind: 'redirect', slug: old.currentSlug }
  return { kind: 'none' }
}
