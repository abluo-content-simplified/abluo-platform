import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery, pageByOldSlugQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, FAQSection as FAQSectionType, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { notFound, redirect } from 'next/navigation'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { isProduction, isDev } from '@/lib/deployment'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

export const dynamic = 'force-dynamic'

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: rawTenantId, locale, slug } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [page, config] = await Promise.all([
    fetchForTenant<WebsitePage>(pageBySlugQuery, { locale, defaultLocale, slug }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
  ])

  if (!page) return {}

  const canonicalBase = config?.customDomain ? `https://${config.customDomain}` : null

  const pageTitle = page.title
    ? `${page.title} — ${config?.siteName ?? tenantId}`
    : config?.siteName ?? tenantId

  // Build hreflang alternates from the page's per-locale slug map.
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages: Record<string, string> = {}
  if (canonicalBase) {
    for (const loc of supportedLocales) {
      const locSlug = page.slugMap?.[loc]?.current
      if (locSlug) {
        languages[loc] = `${canonicalBase}/${loc}/${tenantId}/${locSlug}`
      }
    }
  }

  const canonical = canonicalBase
    ? `${canonicalBase}/${locale}/${tenantId}/${slug}`
    : undefined

  // OG locale tag — maps 2-letter code to IETF format
  const ogLocaleMap: Record<string, string> = {
    en: 'en_US', it: 'it_IT', de: 'de_DE', fr: 'fr_FR',
    es: 'es_ES', pt: 'pt_PT', nl: 'nl_NL',
  }

  return {
    title: pageTitle,
    alternates: {
      canonical: isProduction() ? canonical : undefined,
      languages: !isDev() && Object.keys(languages).length > 0 ? languages : undefined,
    },
    openGraph: {
      title: pageTitle,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: ogLocaleMap[locale] ?? locale,
      type: 'website',
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// SectionRenderer is imported from src/components/sections/SectionRenderer.tsx
// (ADR-016 Phase 0) — shared with the home route, not duplicated here.

export default async function WebsitePageRoute({ params }: PageProps) {
  const { tenant: rawTenantId, locale, slug } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [page, siteConfig, designSystem, moduleConfig] = await Promise.all([
    fetchForTenant<WebsitePage>(pageBySlugQuery, { locale, defaultLocale, slug }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  // ── Redirect check ──────────────────────────────────────────────────────────
  // If no page was found by the current slug, check if this is an old slug
  // that was renamed. If so, 301-redirect to the new slug.
  if (!page) {
    const redirectTarget = await fetchForTenant<{ currentSlug: string } | null>(
      pageByOldSlugQuery,
      { locale, slug }
    )
    if (redirectTarget?.currentSlug) {
      redirect(`/${locale}/${tenantId}/${redirectTarget.currentSlug}`)
    }
    return notFound()
  }

  // ── Hydrate blogListingSection posts server-side ────────────────────────────
  // ADR-020 — one query now serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(page.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig })

  // ── Slug map — passed to the language switcher via context ──────────────────
  // Maps each locale to its current slug for this page.
  const slugMap: Partial<Record<SupportedLocale, string>> = {}
  if (page.slugMap) {
    for (const [loc, slugObj] of Object.entries(page.slugMap)) {
      if (slugObj?.current) {
        slugMap[loc as SupportedLocale] = slugObj.current
      }
    }
  }

  const faqSection = page.sections?.find(
    (s): s is FAQSectionType => s._type === 'faqSection'
  ) ?? null

  return (
    <SlugMapProvider slugMap={slugMap}>
      <JsonLd
        siteConfig={siteConfig}
        faqSection={faqSection}
        locale={locale}
        tenantId={tenantId}
      />
      {page.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={page.backgroundPattern}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam={slug}
          enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
        />
      ))}
    </SlugMapProvider>
  )
}
