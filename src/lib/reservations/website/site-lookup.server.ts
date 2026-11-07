import 'server-only'
// ── Reservations website — titles, places and the time zone from the website's content ──
//
// Sessions live in Supabase (times) but are NAMED in Sanity (a course's or an
// event's title, the site's locations and venues). One memoised read of the
// site context per request, a handful of small queries for the titles. Every
// part fails soft: no title is better than no page.
import { tenantClient } from '@/lib/sanity/client'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { resolveTimeZone } from '@/lib/time/zones'
import { eventSiteContextQuery, timetableEventsQuery } from '@/lib/sanity/queries'
import { COURSES_BY_PUBLIC_IDS_QUERY, TIMETABLE_VENUES_QUERY } from '@/lib/modules/courses/queries'
import type { SiteLookup } from './data'
import type { SessionFact } from './view-model'

type Fetch = <T>(query: string, params?: Record<string, unknown>) => Promise<T>
type SiteContext = { timeZone?: string | null; locations?: Array<{ key?: string | null; name?: string | null }> | null } | null

export function createSiteLookup(input: { projectSegment: string; locale: string; fetchForTenant?: Fetch }): SiteLookup {
  const { projectSegment, locale } = input
  const defaultLocale = resolveScopeFromProjectSegment(projectSegment)?.defaultLocale ?? locale
  const fetch: Fetch = input.fetchForTenant ?? tenantClient(asUrlProjectSegment(projectSegment)).fetchForTenant
  const params = { locale, defaultLocale }
  const soft = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p } catch { return fallback }
  }

  let site: Promise<SiteContext> | null = null
  const siteContext = () => (site ??= soft(fetch<SiteContext>(eventSiteContextQuery, params), null))

  return {
    timeZone: async () => resolveTimeZone((await siteContext())?.timeZone) ?? null,
    defaultLocale: async () => defaultLocale,
    async decorate(facts: SessionFact[]): Promise<SessionFact[]> {
      if (!facts.length) return facts
      const ids = (type: 'course' | 'event') => [...new Set(facts.filter((f) => f.ownerType === type).map((f) => f.ownerPublicId))]
      const venueIds = [...new Set(facts.map((f) => (f.placeRef?.kind === 'venue' ? f.placeRef.venuePublicId : null)).filter((v): v is string => !!v))]
      const [courses, events, venues, ctx] = await Promise.all([
        ids('course').length ? soft(fetch<Array<{ publicId: string; title?: string | null }>>(COURSES_BY_PUBLIC_IDS_QUERY, { ...params, publicIds: ids('course') }), []) : [],
        ids('event').length
          // The window clauses can never match: only the named events are returned.
          ? soft(fetch<Array<{ publicId?: string | null; title?: string | null }>>(timetableEventsQuery, { ...params, publicIds: ids('event'), fromIso: '9999-12-31T00:00:00Z', toIso: '0001-01-01T00:00:00Z' }), [])
          : [],
        venueIds.length ? soft(fetch<Array<{ publicId: string; name?: string | null }>>(TIMETABLE_VENUES_QUERY, { ...params, publicIds: venueIds }), []) : [],
        siteContext(),
      ])
      const titles = new Map<string, string>()
      for (const c of courses ?? []) if (c?.publicId && c.title) titles.set(`course:${c.publicId}`, c.title)
      for (const e of events ?? []) if (e?.publicId && e.title) titles.set(`event:${e.publicId}`, e.title)
      const venueNames = new Map((venues ?? []).filter((v) => v?.publicId && v.name).map((v) => [v.publicId, v.name as string]))
      const locationNames = new Map((ctx?.locations ?? []).filter((l) => l?.key && l.name).map((l) => [l.key as string, l.name as string]))
      return facts.map((f) => ({
        ...f,
        title: titles.get(`${f.ownerType}:${f.ownerPublicId}`) ?? null,
        place: f.placeRef ? (f.placeRef.kind === 'venue' ? venueNames.get(f.placeRef.venuePublicId) : locationNames.get(f.placeRef.key)) ?? null : null,
      }))
    },
  }
}
