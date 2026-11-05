// Server-only. ── The website timetable reader (ADR-045, build spec §5) ────────
//
//   const data = await timetableForSection(projectSlug, { from, to, includeOnlineDetails })
//
// One call = the plain-JSON data a Timetable section needs for a window of
// dates: the dated sessions (cancelled ones included, so the page can strike
// them through), the weekly patterns (print grid), holidays, course titles
// (Sanity), teachers (People projection only), places (Website Settings →
// Locations, or saved venues) and — ONLY when `includeOnlineDetails` is true —
// the meeting rooms.
//
// `includeOnlineDetails` is never decided here: the caller passes the result of
// `onlineDetailsAllowed()` computed from the section's own setting and the
// server-side page gate (see hydrateSections and the timetable route). When it
// is false the meeting-room table is not even read.
//
// FAILS SOFT, like read.server.ts: any problem returns an empty timetable, so a
// scheduling outage never breaks a public page.

import { tenantClient } from '@/lib/sanity/client'
import { eventSiteContextQuery } from '@/lib/sanity/queries'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { resolveTimeZone } from '@/lib/time/zones'
import { COURSES_BY_PUBLIC_IDS_QUERY, COURSES_LISTING_QUERY, TIMETABLE_VENUES_QUERY } from '@/lib/modules/courses/queries'
import { PEOPLE_BY_PUBLIC_IDS_QUERY } from '@/lib/modules/people/queries'
import {
  emptyTimetable,
  isDate,
  shapeTimetable,
  type TimetableCourseInput,
  type TimetableData,
  type TimetablePersonInput,
  type TimetableSiteLocation,
  type TimetableVenueInput,
} from '@/lib/modules/courses/timetable'
import { createCourseScheduleStore, type CourseScheduleStore } from './course-store'
import { addDays } from './recurrence'
import { projectIdForSlug } from './read.server'
import type { SchedulePlace } from './types'

export type TimetableOptions = {
  /** First / last date wanted ('YYYY-MM-DD', inclusive). */
  from: string
  to: string
  /** Only these courses; omitted = every visible (published, not archived) course. */
  coursePublicIds?: string[]
  /** true ONLY when the section allows it AND the page gate granted this visitor (onlineDetailsAllowed). */
  includeOnlineDetails: boolean
  locale: string
  defaultLocale: string
}

type Fetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

export type TimetableDeps = {
  store?: Pick<CourseScheduleStore, 'occurrencesInWindow' | 'listSeries' | 'listClosures' | 'meetingRoomsById'>
  resolveProject?: (projectSlug: string) => Promise<string | null>
  fetchForTenant?: Fetch
}

/** Windows are bounded: a month grid is ~42 days; anything larger is refused (empty). */
export const MAX_TIMETABLE_DAYS = 100

export async function timetableForSection(projectSlug: string, opts: TimetableOptions, deps: TimetableDeps = {}): Promise<TimetableData> {
  const window = { from: opts.from, to: opts.to }
  const empty = emptyTimetable(window)
  if (!isDate(opts.from) || !isDate(opts.to) || opts.to < opts.from || opts.to > addDays(opts.from, MAX_TIMETABLE_DAYS)) return empty
  try {
    const projectId = await (deps.resolveProject ?? projectIdForSlug)(projectSlug)
    if (!projectId) return empty
    const fetchForTenant: Fetch = deps.fetchForTenant ?? tenantClient(asUrlProjectSegment(projectSlug)).fetchForTenant
    const store = deps.store ?? createCourseScheduleStore()
    const params = { locale: opts.locale, defaultLocale: opts.defaultLocale }

    // Courses first: only published, non-archived courses are ever shown.
    const courses = opts.coursePublicIds
      ? opts.coursePublicIds.length
        ? await fetchForTenant<TimetableCourseInput[]>(COURSES_BY_PUBLIC_IDS_QUERY, { ...params, publicIds: opts.coursePublicIds })
        : []
      : await fetchForTenant<TimetableCourseInput[]>(COURSES_LISTING_QUERY, params)
    const courseIds = (courses ?? []).map((c) => c.publicId).filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (!courseIds.length) return empty

    // Sessions are matched on their local date afterwards; the UTC window is padded by a day each side.
    const [occurrences, series, closures] = await Promise.all([
      store.occurrencesInWindow(projectId, { from: `${addDays(opts.from, -1)}T00:00:00Z`, to: `${addDays(opts.to, 2)}T00:00:00Z`, ownerType: 'course', ownerPublicIds: courseIds }),
      store.listSeries(projectId, { ownerType: 'course', ownerPublicIds: courseIds }),
      store.listClosures(projectId),
    ])

    const teacherIds = [...new Set([...occurrences, ...series].flatMap((x) => x.instructorPublicIds))]
    const venueIds = [...new Set([...occurrences, ...series].map((x) => placeVenue(x.place)).filter((v): v is string => !!v))]
    const roomIds = opts.includeOnlineDetails ? [...new Set([...occurrences, ...series].map((x) => x.meetingRoomId).filter((v): v is string => !!v))] : []

    // Decoration reads: a failure leaves names / addresses out, never the page.
    const soft = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await p
      } catch (error) {
        console.warn(`[timetable] optional read failed for "${projectSlug}":`, (error as Error)?.message)
        return fallback
      }
    }
    const [people, site, venues, rooms] = await Promise.all([
      teacherIds.length ? soft(fetchForTenant<TimetablePersonInput[]>(PEOPLE_BY_PUBLIC_IDS_QUERY, { ...params, publicIds: teacherIds }), []) : Promise.resolve([]),
      soft(fetchForTenant<{ timeZone?: string | null; locations?: TimetableSiteLocation[] | null } | null>(eventSiteContextQuery, params), null),
      venueIds.length ? soft(fetchForTenant<TimetableVenueInput[]>(TIMETABLE_VENUES_QUERY, { ...params, publicIds: venueIds }), []) : Promise.resolve([]),
      // Meeting rooms are read ONLY on an allowed request.
      roomIds.length ? soft(store.meetingRoomsById(projectId, roomIds).then((m) => [...m.values()]), []) : Promise.resolve([]),
    ])

    return shapeTimetable({
      window,
      locale: opts.locale,
      defaultLocale: opts.defaultLocale,
      timeZone: resolveTimeZone(site?.timeZone, occurrences[0]?.timeZone, series[0]?.timeZone) ?? null,
      courses: courses ?? [],
      occurrences,
      series,
      closures,
      people: people ?? [],
      siteLocations: site?.locations ?? null,
      venues: venues ?? [],
      rooms,
      includeOnlineDetails: opts.includeOnlineDetails === true,
    })
  } catch (error) {
    console.warn(`[timetable] unavailable for "${projectSlug}" — showing no classes:`, (error as Error)?.message)
    return empty
  }
}

function placeVenue(place: SchedulePlace | null): string | null {
  return place?.kind === 'venue' ? place.venuePublicId : null
}

/** The site's time zone for "today" (Website Settings → Languages), or null. Used by the section hydration. */
export async function siteTimeZone(projectSlug: string, fetchForTenant?: Fetch): Promise<string | null> {
  try {
    const f: Fetch = fetchForTenant ?? tenantClient(asUrlProjectSegment(projectSlug)).fetchForTenant
    const site = await f<{ timeZone?: string | null } | null>(eventSiteContextQuery, { locale: 'en', defaultLocale: 'en' })
    return resolveTimeZone(site?.timeZone) ?? null
  } catch {
    return null
  }
}
