import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { tenantClient } from '@/lib/sanity/client'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { localeConfigQuery } from '@/lib/sanity/queries'
import type { LocaleConfig, SupportedLocale } from '@/lib/sanity/types'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { PersonProfile } from '@/components/people/PersonProfile'
import type { PersonRouteRecord } from '@/components/people/PersonRoute'
import { PERSON_DRAFT_PREVIEW_QUERY } from '@/lib/modules/people/preview-query'
import { PEOPLE_GROUP_LABELS_QUERY, groupLabels } from '@/lib/modules/people/website'
import { asUrlProjectSegment, unbrand } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { siteBasePath } from '@/lib/sanity/href'
import { authorizePersonPreview } from '@/lib/preview/authorize'

/**
 * PRIVATE preview of a person's profile page (People module · ADR-043 D7).
 *
 * The live profile body (`PersonProfile`) inside the same website layout, from
 * the person's DRAFT, else its published version. Same protections as the post
 * preview (`../../post/[id]/page.tsx`): without a valid signed token of kind
 * 'person' for exactly this person and project (minted by the client dashboard
 * for a user who may read People, 15 minutes) the route 404s — see
 * `authorizePersonPreview`. Never cached, never indexed (`noindex` here plus
 * `X-Robots-Tag` / `Cache-Control: no-store` from the proxy), not in the
 * sitemap. Visibility and archived state are not applied: an editor previews a
 * page before it is switched on.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ tenant: string; locale: string; id: string }>
  searchParams?: Promise<{ t?: string | string[]; theme?: string }>
}

export const metadata: Metadata = {
  title: 'Preview',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

export default async function PersonPreviewPage({ params, searchParams }: PageProps) {
  const { tenant: rawTenantId, locale, id } = await params
  const tenantId = asUrlProjectSegment(rawTenantId)
  const search = (await searchParams) ?? {}
  const h = await headers()

  const claims = await authorizePersonPreview({
    token: Array.isArray(search.t) ? undefined : search.t,
    personId: id,
    urlProject: unbrand(tenantId),
    host: h.get('x-forwarded-host') ?? h.get('host'),
    getDoc: (documentId) => sanityWriteClient.getDocument(documentId),
  })
  if (!claims) notFound()

  const { fetchForTenant } = tenantClient(tenantId)
  const siteBase = siteBasePath(locale, tenantId, await isHostScopedRequest(tenantId))
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // The live projection over the document itself (perspective "raw"): the draft first, else the published person.
  const read = (docId: string) =>
    sanityWriteClient.fetch<PersonRouteRecord | null>(
      PERSON_DRAFT_PREVIEW_QUERY,
      { docId, projectSlug: claims.projectSlug, locale, defaultLocale },
      { perspective: 'raw' },
    )
  const person = (await read(`drafts.${claims.draftId}`)) ?? (await read(claims.draftId))
  if (!person) notFound()

  const terms = person.groups?.length
    ? await fetchForTenant<{ key?: string; label?: unknown }[]>(PEOPLE_GROUP_LABELS_QUERY, {})
    : []

  return (
    <SlugMapProvider slugMap={{}}>
      <PersonProfile
        person={person}
        locale={locale}
        siteBase={siteBase}
        projectSlug={tenantId}
        groups={groupLabels(person.groups, terms, locale, defaultLocale)}
      />
    </SlugMapProvider>
  )
}
