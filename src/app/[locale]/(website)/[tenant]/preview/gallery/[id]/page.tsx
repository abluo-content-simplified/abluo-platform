import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import {
  designSystemQuery,
  galleryDocPreviewQuery,
  galleryPreviewPageQuery,
  localeConfigQuery,
  projectModuleConfigQuery,
  websiteSiteConfigQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import type { DesignSystem, LocaleConfig, PageSection, SupportedLocale, WebsitePage, WebsiteSiteConfig } from '@/lib/sanity/types'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { asUrlProjectSegment, unbrand } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { authorizeGalleryPreview } from '@/lib/preview/authorize'
import { pageShowsGallery } from '@/lib/api/gallery-preview'
import { standaloneGallerySection, substituteGallery } from '@/lib/preview/gallery-substitute'

/**
 * PRIVATE preview of a gallery's DRAFT (client dashboard · galleries).
 *
 * Same rules as the post preview (`../../post/[id]/page.tsx`): a valid signed
 * token of kind 'gallery' for exactly this gallery and project, or 404; never
 * cached or indexed (the proxy marks `/preview/gallery/…` like `/preview/post/…`).
 *
 *   • token with a page → that page as published, with this gallery swapped for its draft;
 *   • token without     → the gallery alone in a Photo Gallery section, site design.
 * The draft is read when there is one, else the published gallery.
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

export default async function GalleryPreviewPage({ params, searchParams }: PageProps) {
  const { tenant: rawTenantId, locale, id } = await params
  const tenantId = asUrlProjectSegment(rawTenantId)
  const search = (await searchParams) ?? {}
  const h = await headers()

  const claims = await authorizeGalleryPreview({
    token: Array.isArray(search.t) ? undefined : search.t,
    galleryId: id,
    urlProject: unbrand(tenantId),
    host: h.get('x-forwarded-host') ?? h.get('host'),
    getDoc: (documentId) => sanityWriteClient.getDocument(documentId),
    pageShowsGallery: (pageId, galleryId, projectSlug) => pageShowsGallery(sanityWriteClient, pageId, galleryId, projectSlug),
  })
  if (!claims) notFound()

  const { fetchForTenant } = tenantClient(tenantId)
  const hostScoped = await isHostScopedRequest(tenantId)
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const galleryParams = { projectSlug: claims.projectSlug, locale, defaultLocale }
  const readGallery = (docId: string) =>
    sanityWriteClient.fetch<Record<string, unknown> | null>(galleryDocPreviewQuery, { ...galleryParams, docId }, { perspective: 'raw' })

  const [draft, siteConfig, designSystem, moduleConfig, page] = await Promise.all([
    (async () => (await readGallery(`drafts.${claims.draftId}`)) ?? (await readGallery(claims.draftId)))(),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => resolveDesignSystemInheritance(await fetchForTenant<DesignSystem>(designSystemQuery, {}), fetchDesignSystemById))(),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
    claims.pageId
      ? fetchForTenant<WebsitePage | null>(galleryPreviewPageQuery, { locale, defaultLocale, pageId: claims.pageId })
      : Promise.resolve(null),
  ])
  if (!draft) notFound()
  if (claims.pageId && !page) notFound()

  const enabledModuleIds = getEnabledModuleIds(moduleConfig)
  let sections: PageSection[]
  if (page) {
    await hydrateSections(page.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig })
    sections = substituteGallery(page.sections as never[], claims.draftId, draft) as unknown as PageSection[]
  } else {
    sections = [standaloneGallerySection(draft, claims.draftId) as unknown as PageSection]
  }

  return (
    <SlugMapProvider slugMap={{}}>
      {sections.map((section, index) => (
        <SectionRenderer
          hostScoped={hostScoped}
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={page?.backgroundPattern}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          enabledModuleIds={enabledModuleIds}
          moduleConfig={moduleConfig}
        />
      ))}
    </SlugMapProvider>
  )
}
