/**
 * News listing page — /[locale]/[tenant]/news
 *
 * ADR-020 — the News module's index route. Renders purely from
 * `newsPage.sections[]`: add a News Listing section in the Studio and it
 * appears here. There is no fixed-field body, so unlike the Blog route this
 * page never needed a migration away from one.
 *
 * The URL segment `/news` is the same in every locale, so this page uses no
 * SlugMapProvider — the language switcher's path-preserving fallback handles
 * locale changes correctly. Only the ITEM route (news/[slug]) carries a slug
 * map, because item slugs are per-locale.
 *
 * Module gating: if the News module is not enabled for the website, the
 * newsListingSection renders nothing (isSectionTypeAvailable) and hydration is
 * skipped. The route itself still resolves — a bare page rather than a 404 —
 * which matches how /blog and /events behave for their modules.
 */

import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import {
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
  newsPageQuery,
  projectModuleConfigQuery,
} from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type {
  LocaleConfig,
  SupportedLocale,
  DesignSystem,
  WebsiteSiteConfig,
  NewsPage,
} from '@/lib/sanity/types'
import { getNewsModuleMessages } from '@/lib/i18n/news-module-messages'
import { isProduction, isDev } from '@/lib/deployment'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales = localeConfig?.supportedLocales ?? [defaultLocale]

  const [config, newsPage] = await Promise.all([
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<NewsPage>(newsPageQuery, { locale, defaultLocale }),
  ])

  // Title fallback while a newsPage document is being created. Deliberately a
  // generic, localized module label rather than tenant-specific marketing copy
  // — the tenant's own heading comes from Sanity the moment the document exists.
  const msg = getNewsModuleMessages(locale)
  const pageHeading = newsPage?.heroTitle ?? msg.newsListLabel
  const pageDescription = newsPage?.seoDescription ?? newsPage?.heroSubtitle

  const canonicalBase = config?.customDomain ? `https://${config.customDomain}` : null
  const canonical = canonicalBase ? `${canonicalBase}/${locale}/${tenantId}/news` : undefined

  // hreflang: the /news segment is locale-invariant, so one URL per supported
  // locale differing only in the locale prefix.
  const languages: Record<string, string> = {}
  if (canonicalBase) {
    for (const loc of supportedLocales) {
      languages[loc] = `${canonicalBase}/${loc}/${tenantId}/news`
    }
  }

  const metaTitle =
    newsPage?.seoTitle ?? (config?.siteName ? `${pageHeading} — ${config.siteName}` : pageHeading)

  return {
    title: metaTitle,
    description: pageDescription,
    alternates: {
      canonical: isProduction() ? canonical : undefined,
      languages: !isDev() && Object.keys(languages).length > 0 ? languages : undefined,
    },
    openGraph: {
      title: metaTitle,
      description: pageDescription,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      type: 'website',
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NewsIndexPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [designSystem, newsPage, siteConfig, moduleConfig] = await Promise.all([
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<NewsPage>(newsPageQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  // ADR-020 — one query serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(newsPage?.sections, {
    fetchForTenant,
    locale: locale as SupportedLocale,
    defaultLocale,
    enabledModuleIds,
  })

  return (
    <>
      {newsPage?.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={undefined}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam="news"
          enabledModuleIds={enabledModuleIds}
          moduleConfig={moduleConfig}
        />
      ))}
    </>
  )
}
