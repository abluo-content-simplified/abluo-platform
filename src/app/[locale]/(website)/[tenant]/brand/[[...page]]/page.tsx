import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import { designSystemQuery, localeConfigQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { isModuleEnabled, type ProjectModuleConfig } from '@/lib/modules/config'
import type { DesignSystem, LocaleConfig, SupportedLocale } from '@/lib/sanity/types'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { siteBasePath } from '@/lib/sanity/href'
import { brandHubQuery, type BrandHubQueryResult } from '@/lib/modules/brand-hub/queries'
import { buildBrandHubModel, pageFromSegments } from '@/lib/modules/brand-hub/model'
import { BRAND_HUB_MODULE_ID, BRAND_HUB_ROBOTS } from '@/lib/modules/brand-hub/route'
import { getBrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { BrandHub } from '@/components/brand-hub/BrandHub'

// ADR-036 — the Brand Hub. Always rendered on request: it documents the design
// system as it is NOW (D2), so a cached copy would describe a stale brand.
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string; page?: string[] }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, page: segments, tenant: rawTenantId } = await params
  const page = pageFromSegments(segments)
  const m = getBrandHubMessages(locale)
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)
  const siteName = await fetchForTenant<string | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug][0].siteName`,
    {},
  )
  const pageTitle = page ? m.pages[page].title : m.navLabel
  return {
    title: [pageTitle, m.navLabel, siteName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · '),
    description: page ? m.pages[page].description : undefined,
    // D5 — never indexed, wherever it is served. noindex is not privacy.
    robots: BRAND_HUB_ROBOTS,
  }
}

export default async function BrandHubPage({ params }: PageProps) {
  const { tenant: rawTenantId, locale, page: segments } = await params
  const page = pageFromSegments(segments)
  if (!page) notFound()

  // Trust boundary: the `[tenant]` segment is a URL project segment — see ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const modules = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale })
  if (!isModuleEnabled(modules, BRAND_HUB_MODULE_ID)) notFound()

  const [designSystem, data, hostScoped] = await Promise.all([
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<BrandHubQueryResult>(brandHubQuery, { locale, defaultLocale }),
    isHostScopedRequest(tenantId),
  ])

  const model = buildBrandHubModel(designSystem, data, { locale, defaultLocale })
  const basePath = `${siteBasePath(locale, tenantId, hostScoped)}/brand`

  return <BrandHub model={model} page={page} locale={locale} basePath={basePath} />
}
