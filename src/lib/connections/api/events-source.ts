// ── Event v1 — where the data comes from (Sanity, server-only) ───────────────
//
// Every read goes through `tenantClient(projectSlug)`, so the tenant-scope
// guard refuses any query that does not filter on `$projectSlug`. The project
// slug comes from the Connection's project row — never from the request.
// Published documents only: drafts and release versions are excluded in the
// query itself, whatever the client's perspective.

import { tenantClient } from '@/lib/sanity/client'
import { enabledModuleIdsQuery } from '@/lib/sanity/queries'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { withSchedules } from '@/lib/scheduling/read.server'
import type { EventSiteV1, EventV1Row } from './event-contract'
import { PARTNER_EVENT_SITE_QUERY, PARTNER_EVENTS_EXISTING_QUERY, PARTNER_EVENTS_PAGE_QUERY } from './event-queries'

export interface EventsPageQuery {
  projectSlug: string
  /** Cursor position: effective change time (ISO, ms precision) and public id ('' = start of that instant, '~' = end). */
  after: { t: string; id: string }
  /** The sweep's fixed window end (ISO). */
  upTo: string
  limit: number
}

export interface EventsSource {
  enabledModules(projectSlug: string): Promise<string[]>
  site(projectSlug: string, customDomain: string | null | undefined): Promise<EventSiteV1 | null>
  /** Published events with (effective change time, publicId) > after, effective time ≤ upTo; ordered by both. Rows carry `_eff` (ms). */
  page(q: EventsPageQuery): Promise<EventV1Row[]>
  /** The subset of `publicIds` that still have a published event in the project. */
  existing(projectSlug: string, publicIds: string[]): Promise<string[]>
}

export function createSanityEventsSource(): EventsSource {
  const client = (slug: string) => tenantClient(asProjectSlug(slug))
  return {
    async enabledModules(projectSlug) {
      try {
        return (await client(projectSlug).fetchForTenant<string[] | null>(enabledModuleIdsQuery, {})) ?? []
      } catch {
        return [] // fail closed: no modules → no data
      }
    },
    async site(projectSlug, customDomain) {
      const s = await client(projectSlug).fetchForTenant<{
        defaultLocale?: string | null
        supportedLocales?: string[] | null
        timeZone?: string | null
        locations?: EventSiteV1['locations'] | null
      } | null>(PARTNER_EVENT_SITE_QUERY, {})
      const supported = s?.supportedLocales?.length ? s.supportedLocales : []
      const defaultLocale = s?.defaultLocale || supported[0]
      if (!defaultLocale) return null
      return {
        defaultLocale,
        locales: [defaultLocale, ...supported.filter((l) => l !== defaultLocale)],
        timeZone: s?.timeZone ?? null,
        origin: customDomain ? `https://${customDomain}` : null,
        locations: s?.locations ?? [],
      }
    },
    async page(q) {
      const rows = (
        (await client(q.projectSlug).fetchForTenant<EventV1Row[] | null>(PARTNER_EVENTS_PAGE_QUERY, {
          afterMs: Date.parse(q.after.t),
          afterId: q.after.id,
          upToMs: Date.parse(q.upTo),
        })) ?? []
      ).slice(0, q.limit)
      // ADR-038 C3 — dates from the schedule (Supabase) when one exists; Sanity's
      // otherwise (fails soft). The cursor still follows Sanity's change time:
      // C6 adds the schedule's updated_at so a date-only change re-syncs.
      return withSchedules(q.projectSlug, rows)
    },
    async existing(projectSlug, publicIds) {
      if (!publicIds.length) return []
      return (await client(projectSlug).fetchForTenant<string[] | null>(PARTNER_EVENTS_EXISTING_QUERY, { publicIds })) ?? []
    },
  }
}
