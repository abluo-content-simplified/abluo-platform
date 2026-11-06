// Server-only. ── Hydration of a Timetable section (ADR-045, build spec §5) ───────
//
// Called by hydrateSections (the ONE hydration path shared by every page
// route — `[tenant]/page.tsx` and `[tenant]/[...slug]/page.tsx`), per request.
// It fills `section.timetable` with the current month (and the current week's
// days, which may spill into a neighbouring month).
//
// Online meeting details are decided HERE, on the server, from facts the page
// route already verified: the section's own setting and the page gate's
// outcome (`pageProtected` = the gate granted this visitor on a restricted
// page). Nothing the browser sends takes part.

import { siteTimeZone, timetableForSection, type TimetableDeps } from '@/lib/scheduling/timetable.server'
import type { TimetableSection } from '@/lib/sanity/types'
import { projectDomainQuery } from '@/lib/sanity/queries'
import { normalizeHost } from '@/lib/tenancy/host-scope'
import type { TimetableCourseInput } from './timetable'
import { addDays } from '@/lib/scheduling/recurrence'
import { monthOf, monthRange, onlineDetailsAllowed, todayIn, weekStart } from './timetable'

type Fetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

export type TimetableHydrationContext = {
  projectSlug?: string
  locale: string
  defaultLocale: string
  fetchForTenant: Fetch
  /** The Sanity _id of the page the section sits on, when known (enables month navigation). */
  pageId?: string | null
  /** The page is Access-protected and the gate granted this visitor. */
  pageProtected: boolean
  /** The project's enabled module ids (null/absent = unknown). Events in the timetable need 'events' to be listed: unknown = off. */
  enabledModuleIds?: string[] | null
  now?: Date
  /** Preview route only (verified token): this course is shown as if published. See TimetableOptions.previewCourse. */
  previewCourse?: TimetableCourseInput
  /** Test seam: the scheduling store / project resolver (defaults to the real ones). */
  deps?: Omit<TimetableDeps, 'fetchForTenant'>
}

/** The courses a section shows: undefined = all; a (possibly empty) list = the picked ones. */
export function sectionCourseIds(section: Pick<TimetableSection, 'courseScope' | 'courseIds'>): string[] | undefined {
  if (section.courseScope !== 'pick') return undefined
  return [...new Set((section.courseIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export const EVENTS_MODULE_ID = 'events'

/** Events appear in the timetable only when the section asks AND the Events module is installed and on (unknown = off). */
export function eventsIncluded(section: Pick<TimetableSection, 'includeEvents'>, enabledModuleIds: readonly string[] | null | undefined): boolean {
  return section.includeEvents === true && Array.isArray(enabledModuleIds) && enabledModuleIds.includes(EVENTS_MODULE_ID)
}

/** Members' notes survive only on a protected page the visitor was granted on: same fact as the meeting details. */
export function membersNotesAllowed(pageProtected: unknown): boolean {
  return pageProtected === true
}

/** The site's public host for the printed title: the project's custom domain, normalised by the platform host rules (no www). */
async function siteHostOf(fetchForTenant: Fetch): Promise<string | null> {
  try {
    const domain = await fetchForTenant<string | null>(projectDomainQuery, {})
    return normalizeHost(domain) || null
  } catch {
    return null
  }
}

export async function hydrateTimetableSection(section: TimetableSection, ctx: TimetableHydrationContext): Promise<void> {
  // Never leave members-only text on a section for a visitor who may not read it (the section object is what the page renders).
  if (!membersNotesAllowed(ctx.pageProtected)) section.membersNotes = null
  if (!ctx.projectSlug) return
  const timeZone = await siteTimeZone(ctx.projectSlug, ctx.fetchForTenant)
  const today = todayIn(timeZone, ctx.now)
  const month = monthOf(today)
  const range = monthRange(month)
  const monday = weekStart(today)
  const from = monday < range.from ? monday : range.from
  const sunday = addDays(monday, 6)
  const to = sunday > range.to ? sunday : range.to

  const onlineDetails = onlineDetailsAllowed({ showOnlineDetails: section.showOnlineDetails, pageProtected: ctx.pageProtected })
  const [data, siteHost] = await Promise.all([
    timetableForSection(
      ctx.projectSlug,
      { from, to, coursePublicIds: sectionCourseIds(section), includeOnlineDetails: onlineDetails, includeEvents: eventsIncluded(section, ctx.enabledModuleIds), locale: ctx.locale, defaultLocale: ctx.defaultLocale, previewCourse: ctx.previewCourse },
      { ...ctx.deps, fetchForTenant: ctx.fetchForTenant },
    ),
    siteHostOf(ctx.fetchForTenant),
  ])
  section.timetable = { month, today, data: { ...data, timeZone: data.timeZone ?? timeZone }, onlineDetails, pageId: ctx.pageId ?? null, siteHost }
}
