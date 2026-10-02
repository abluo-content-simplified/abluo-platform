/**
 * News listing page — /[locale]/[tenant]/news
 *
 * ADR-020 — the News module's index route. Renders purely from
 * `newsPage.sections[]`: add a News Listing section in the Studio and it
 * appears here. There is no fixed-field body, so unlike the Blog route this
 * page never needed a migration away from one.
 *
 * The URL segment `/news` is the same in every locale. It is still registered
 * with a SlugMapProvider (indexRouteSlugMap): the header switcher could fall
 * back to preserving the path, but the footer switcher never guesses and sent
 * visitors to the home page. The ITEM route (news/[slug]) registers per-locale
 * slugs.
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
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { indexRouteSlugMap } from '@/lib/i18n/language-switch'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '@/lib/seo/canonical'
import { ogLocale } from '@/lib/seo/og-locale'
import { ogImageUrl, imageUrl } from '@/lib/sanity/image'
import { JsonLd, CollectionJsonLd } from '@/components/JsonLd'
import type { NewsListingSection as NewsListingSectionType } from '@/lib/sanity/types'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: rawTenantId, locale } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
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

  const origin = canonicalOrigin(config?.customDomain)
  const canonical = canonicalUrl(origin, locale, 'news')

  // hreflang: the /news segment is locale-invariant, so one URL per supported
  // locale differing only in the locale prefix — plus x-default, like every
  // other route (hreflangAlternates adds it).
  const languages = hreflangAlternates(
    origin,
    Object.fromEntries(supportedLocales.map((loc) => [loc, ['news']])),
    defaultLocale
  )

  // The site's default share image. A route that declares its own openGraph
  // block REPLACES the layout's, images included, so it must be repeated here
  // (see the same note in [...slug]/page.tsx) — /news had no og:image at all.
  const ogImage = config?.openGraphImage?.asset ? ogImageUrl(config.openGraphImage as never) : undefined

  const metaTitle =
    newsPage?.seoTitle ?? (config?.siteName ? `${pageHeading} — ${config.siteName}` : pageHeading)

  return {
    title: metaTitle,
    description: pageDescription,
    alternates: seoAlternates(origin, canonical, languages, {
      isProduction: isProduction(),
      isDev: isDev(),
    }),
    openGraph: {
      title: metaTitle,
      description: pageDescription,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: ogLocale(locale),
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630 }] } : {}),
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NewsIndexPage({ params }: PageProps) {
  const { tenant: rawTenantId, locale } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)
  const hostScoped = await isHostScopedRequest(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales = localeConfig?.supportedLocales ?? [defaultLocale]

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
    moduleConfig,
  })

  // JSON-LD: the site's Organization + WebSite (same as every page route) and
  // this page as a CollectionPage listing the articles it shows, in order.
  const origin = canonicalOrigin(siteConfig?.customDomain)
  const listedArticles = (newsPage?.sections ?? [])
    .filter((s): s is NewsListingSectionType => s._type === 'newsListingSection')
    .flatMap((s) => s.articles ?? [])
    .filter((a) => a.slug?.current)

  // The /news segment is the same in every language; registering it lets
  // both language switchers keep the visitor on this index (see
  // indexRouteSlugMap) — the footer one used to send them to the home page.
  return (
    <SlugMapProvider slugMap={indexRouteSlugMap(supportedLocales, 'news')}>
    <>
      <JsonLd
        siteConfig={siteConfig}
        locale={locale}
        tenantId={tenantId}
        pathSegments={['news']}
        logoUrl={siteConfig?.logo ? imageUrl(siteConfig.logo as never, 512) : undefined}
      />
      <CollectionJsonLd
        origin={origin}
        locale={locale}
        pathSegments={['news']}
        name={newsPage?.seoTitle ?? newsPage?.heroTitle}
        description={newsPage?.seoDescription ?? newsPage?.heroSubtitle}
        items={listedArticles.map((a) => ({ pathSegments: ['news', a.slug.current], name: a.title }))}
      />
      {newsPage?.sections?.map((section, index) => (
        <SectionRenderer
          hostScoped={hostScoped}
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
    </SlugMapProvider>
  )
}
