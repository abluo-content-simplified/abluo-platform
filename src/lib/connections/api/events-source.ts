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
import type { EventSiteV1, EventV1Row } from './event-contract'
import { PARTNER_EVENT_SITE_QUERY, PARTNER_EVENTS_PAGE_QUERY } from './event-queries'

export interface EventsPageQuery {
  projectSlug: string
  after: { t: string; id: string }
  upTo: string
  limit: number
}

export interface EventsSource {
  enabledModules(projectSlug: string): Promise<string[]>
  site(projectSlug: string, customDomain: string | null | undefined): Promise<EventSiteV1 | null>
  /** Published events with (_updatedAt, publicId) > after and _updatedAt ≤ upTo, oldest first. */
  page(q: EventsPageQuery): Promise<EventV1Row[]>
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
      return (
        (await client(q.projectSlug).fetchForTenant<EventV1Row[] | null>(PARTNER_EVENTS_PAGE_QUERY, {
          afterT: q.after.t,
          afterId: q.after.id,
          upTo: q.upTo,
        })) ?? []
      ).slice(0, q.limit)
    },
  }
}
