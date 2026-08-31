import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, homepageFeaturedEventQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import { FeaturedEventBlock } from '@/components/events/FeaturedEventBlock'
import { SectionContainer } from '@/components/layout/SectionContainer'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, FAQSection as FAQSectionType, SupportedLocale, DesignSystem, Event } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { isProduction, isDev } from '@/lib/deployment'
import { ogImageUrl } from '@/lib/sanity/image'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

export const dynamic = 'force-dynamic'

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: rawTenantId, locale } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })

  // Canonical base from Sanity project.customDomain — single source of truth.
  // Null when the project has no custom domain (new/unlaunched tenants).
  const canonicalBase = config?.customDomain ? `https://${config.customDomain}` : null
  const canonical = canonicalBase ? `${canonicalBase}/${locale}/${tenantId}` : undefined

  // Build hreflang alternates dynamically from siteConfig.supportedLocales.
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages: Record<string, string> = {}
  if (canonicalBase) {
    for (const loc of supportedLocales) {
      languages[loc] = `${canonicalBase}/${loc}/${tenantId}`
    }
  }

  // OG locale tag — maps 2-letter code to IETF format
  const ogLocaleMap: Record<string, string> = {
    en: 'en_US', it: 'it_IT', de: 'de_DE', fr: 'fr_FR',
    es: 'es_ES', pt: 'pt_PT', nl: 'nl_NL',
  }

  const metaTitle = config?.seoDefaultTitle ?? config?.siteName ?? tenantId
  const metaDescription = config?.seoDefaultDescription ?? config?.tagline

  return {
    title: metaTitle,
    description: metaDescription,
    alternates: {
      canonical: isProduction() ? canonical : undefined,
      languages: !isDev() && Object.keys(languages).length > 0 ? languages : undefined,
    },
    openGraph: {
      title: metaTitle,
      description: metaDescription ?? undefined,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: ogLocaleMap[locale] ?? locale,
      type: 'website',
      images: (() => {
        const url = config?.openGraphImage?.asset ? ogImageUrl(config.openGraphImage as any) : undefined
        return url ? [{ url, width: 1200, height: 630 }] : undefined
      })(),
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// SectionRenderer is imported from src/components/sections/SectionRenderer.tsx
// (ADR-016 Phase 0) — shared with the [slug] route, not duplicated here.

export default async function WebsitePage({ params }: PageProps) {
  const { tenant: rawTenantId, locale } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [homePage, siteConfig, designSystem, featuredEvent, moduleConfig] = await Promise.all([
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => { const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {}); return resolveDesignSystemInheritance(raw, fetchDesignSystemById); })(),
    fetchForTenant<Event>(homepageFeaturedEventQuery, { locale, defaultLocale }),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  if (!homePage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-400">No home page found for: {tenantId}</p>
      </div>
    )
  }

  // Hydrate any blogListingSection sections with posts fetched server-side
  // ADR-020 — one query now serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(homePage.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig })

  const faqSection = homePage.sections?.find(
    (s): s is FAQSectionType => s._type === 'faqSection'
  ) ?? null

  // Split sections so the featured event lands between the hero and the rest.
  // Hero types are always the first section; everything else follows.
  const heroTypes = new Set(['heroSection', 'heroLiveCaptureSection', 'heroLensSection'])
  const allSections = homePage.sections ?? []
  const firstIsHero = allSections.length > 0 && heroTypes.has(allSections[0]._type)
  const heroSections = firstIsHero ? allSections.slice(0, 1) : []
  const bodySections = firstIsHero ? allSections.slice(1) : allSections

  return (
    <>
      <JsonLd
        siteConfig={siteConfig}
        faqSection={faqSection}
        locale={locale}
        tenantId={tenantId}
      />

      {/* ── Hero section (always first) ──────────────────────────── */}
      {heroSections.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={homePage.backgroundPattern}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam="home"
          enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
        />
      ))}

      {/* ── Featured event — collapses when no active event ─────── */}
      {featuredEvent && (
        <SectionContainer>
          <FeaturedEventBlock
            event={featuredEvent}
            designSystem={designSystem}
            locale={locale as SupportedLocale}
            tenantId={tenantId}
          />
        </SectionContainer>
      )}

      {/* ── Remaining page sections ──────────────────────────────── */}
      {bodySections.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={homePage.backgroundPattern}
          sectionIndex={firstIsHero ? index + 1 : index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam="home"
          enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
        />
      ))}
    </>
  )
}
