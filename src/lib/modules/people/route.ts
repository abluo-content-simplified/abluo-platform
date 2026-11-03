// ── People — profile route lookups (ADR-043 D7) ───────────────────────────────
//
// The three reads of a profile URL, bound to the tenant-scoped client. Kept in
// their own file so every fetchForTenant call site names its query directly
// (fetch-for-tenant-call-sites.test.ts proves each is tenant-scoped).

import { PERSON_BY_OLD_SLUG_QUERY, PERSON_BY_SLUG_QUERY, PERSON_SLUG_ARCHIVED_QUERY } from './queries'
import { resolvePersonRoute, type PeopleFetch, type PersonRouteOutcome } from './website'

export function loadPersonRoute<P>(
  fetchForTenant: PeopleFetch,
  params: { slug: string; locale: string; defaultLocale: string },
): Promise<PersonRouteOutcome<P>> {
  return resolvePersonRoute<P>(
    {
      bySlug: () => fetchForTenant<P | null>(PERSON_BY_SLUG_QUERY, params),
      byOldSlug: () => fetchForTenant<{ currentSlug?: string | null } | null>(PERSON_BY_OLD_SLUG_QUERY, params),
      archived: () => fetchForTenant<boolean | null>(PERSON_SLUG_ARCHIVED_QUERY, params),
    },
    params.slug,
  )
}
