/**
 * News & Announcements listing page — /[locale]/[tenant]/blog
 *
 * ADR-016 Phase C — this route renders purely from `blogPage.sections[]`
 * (heroSection + blogListingSection, populated by migration
 * 002-migrate-singleton-sections.ts) plus SEO metadata. The fixed hero JSX
 * and hardcoded featured-card + grid layout that used to live directly in
 * this file have been retired — see git history / ADR-016 Phase C Standard
 * Handoff for the pre-migration implementation and the parity notes on the
 * blogListingSection `layout: 'grid'` approximation of the old
 * featured-card + grid composite.
 *
 * Architecture notes:
 * - `getNewsPageMessages` is still used for `generateMetadata` SEO fallback
 *   strings while a tenant has no `blogPage` document — that is a metadata
 *   concern, not page-body rendering, and is unaffected by this retirement.
 * - The page uses no SlugMapProvider because the URL /blog is the same
 *   in every locale — the LanguageSwitcher's fallback path-preservation
 *   branch handles locale switching correctly.
 */

import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import {
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
  blogPageQuery,
  projectModuleConfigQuery,
} from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { LocaleConfig, SupportedLocale, DesignSystem, WebsiteSiteConfig, BlogPage } from '@/lib/sanity/types'
import { getNewsPageMessages } from '@/lib/i18n/news-page-messages'
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

  const [config, blogPage] = await Promise.all([
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<BlogPage>(blogPageQuery, { locale, defaultLocale }),
  ])

  // Fallback to hardcoded strings while a blogPage document is being created.
  const msg = getNewsPageMessages(locale)
  const pageHeading = blogPage?.heroTitle ?? msg.title
  const pageDescription = blogPage?.seoDescription ?? blogPage?.heroSubtitle ?? msg.subtitle

  const canonicalBase = config?.customDomain ? `https://${config.customDomain}` : null
  const canonical = canonicalBase ? `${canonicalBase}/${locale}/${tenantId}/blog` : undefined

  // hreflang: /blog is locale-invariant in path.
  const languages: Record<string, string> = {}
  if (canonicalBase) {
    for (const loc of supportedLocales) {
      languages[loc] = `${canonicalBase}/${loc}/${tenantId}/blog`
    }
  }

  const metaTitle = blogPage?.seoTitle
    ?? (config?.siteName ? `${pageHeading} — ${config.siteName}` : pageHeading)

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

export default async function NewsListingPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-016 Phase C — the page now renders purely from sections[]. The
  // featured-card + grid posts list that used to be fetched and rendered
  // here directly is now fetched by hydrateSections below, driven by the
  // migrated blogListingSection section.
  const [designSystem, blogPage, siteConfig, moduleConfig] = await Promise.all([
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<BlogPage>(blogPageQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  // ADR-016 Phase A/C — hydrate blogListingSection / eventsListingSection /
  // liveLatestSection sections with data fetched server-side, mutating
  // blogPage.sections in place. This is now the ONLY data-fetch path for the
  // page body — there is no fixed-field rendering left.
  // ADR-020 — one query now serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(blogPage?.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig })

  return (
    <>
    {blogPage?.sections?.map((section, index) => (
      <SectionRenderer
        key={section._key}
        section={section}
        siteConfig={siteConfig}
        designSystem={designSystem}
        backgroundPattern={undefined}
        sectionIndex={index}
        locale={locale}
        tenantSlug={tenantId}
        fromParam="blog"
        enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
      />
    ))}
    </>
  )
}
