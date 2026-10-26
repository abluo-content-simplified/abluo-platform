import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, homepageFeaturedEventQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import { FeaturedEventBlock } from '@/components/events/FeaturedEventBlock'
import { SectionContainer } from '@/components/layout/SectionContainer'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, SupportedLocale, DesignSystem, Event } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { collectSectionFaqItems, faqJsonLdLinks } from '@/lib/faq/collect'
import { isSectionTypeAvailable } from '@/lib/modules/sections'
import { isProduction, isDev } from '@/lib/deployment'
import { ogImageUrl, imageUrl } from '@/lib/sanity/image'
import { ogLocale } from '@/lib/seo/og-locale'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '@/lib/seo/canonical'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { withSchedule } from '@/lib/scheduling/read.server'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { siteBasePath } from '@/lib/sanity/href'

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
  // The home document is fetched here as well as in the page body: its SEO
  // fields are page-level overrides of the site defaults, and generateMetadata
  // has no other way to see them. Same query, same params — Next's request
  // memoisation collapses the two into one round trip.
  const [config, homePage] = await Promise.all([
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
  ])

  // Canonical base from Sanity project.customDomain — single source of truth.
  // Null when the project has no custom domain (new/unlaunched tenants).
  //
  // The URL is built by @/lib/seo/canonical and carries NO project segment: the
  // public home page of a custom domain is `https://domain/en`, not
  // `https://domain/en/<project>`. Both spellings answer (see proxy.ts), which
  // is exactly why the canonical has to name one of them.
  const origin = canonicalOrigin(config?.customDomain)
  const canonical = canonicalUrl(origin, locale)

  // hreflang from siteConfig.supportedLocales, plus x-default.
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages = hreflangAlternates(
    origin,
    Object.fromEntries(supportedLocales.map((loc) => [loc, []])),
    defaultLocale
  )


  // Page-level SEO wins, then the site default, then the bare site name.
  const metaTitle = homePage?.seoTitle ?? config?.seoDefaultTitle ?? config?.siteName ?? tenantId
  const metaDescription =
    homePage?.seoDescription ?? config?.seoDefaultDescription ?? config?.tagline
  const pageOgImage = homePage?.ogImage?.asset ? ogImageUrl(homePage.ogImage as never) : undefined

  return {
    // ── Every relative metadata URL resolves against this ────────────────────
    // Next infers metadataBase when it is unset, and on a multi-tenant project
    // it infers ONE host for all of them: every site advertised its generated
    // card on `https://www.ameliez.com/...`, i.e. one client's page pointing at
    // another client's domain. Pinning it to this tenant's canonical origin is
    // what keeps a relative metadata URL on the right site.
    //
    // Absolute URLs (an uploaded Sanity image) ignore metadataBase, which is
    // why only the generated card was affected.
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: metaTitle,
    description: metaDescription,
    alternates: seoAlternates(origin, canonical, languages, {
      isProduction: isProduction(),
      isDev: isDev(),
    }),
    ...(homePage?.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: metaTitle,
      description: metaDescription ?? undefined,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: ogLocale(locale),
      type: 'website',
      // ── `images` must be ABSENT, not undefined, when nothing is authored ──
      // The generated card (./opengraph-image.tsx) is applied by Next only
      // when this metadata object has no OWN `images` property:
      //
      //   if (openGraph && !source?.openGraph?.hasOwnProperty('images')) { … }
      //
      // `hasOwnProperty`, not a truthiness check. Returning `undefined` from a
      // ternary here still CREATES the key, which silently disables the
      // generated card on every site. Hence the spread: the key exists only
      // when there is a real image behind it.
      ...(() => {
        const url =
          pageOgImage ??
          (config?.openGraphImage?.asset ? ogImageUrl(config.openGraphImage as never) : undefined)
        if (url) return { images: [{ url, width: 1200, height: 630 }] }
        // No custom domain → no metadataBase → the generated card's relative
        // URL would resolve against whatever host Next infers, which is some
        // other tenant's. An empty array is an OWN `images` property, so it
        // suppresses the file convention: no card beats a wrong one.
        return origin ? {} : { images: [] }
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
  const hostScoped = await isHostScopedRequest(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [homePage, siteConfig, designSystem, sanityFeaturedEvent, moduleConfig] = await Promise.all([
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => { const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {}); return resolveDesignSystemInheritance(raw, fetchDesignSystemById); })(),
    fetchForTenant<Event>(homepageFeaturedEventQuery, { locale, defaultLocale }),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])
  // ADR-038 C3 — dates from the schedule (Supabase) when one exists; Sanity's otherwise.
  const featuredEvent = await withSchedule(String(tenantId), sanityFeaturedEvent)

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

  await hydrateSections(homePage.sections, {
    fetchForTenant, projectSlug: String(tenantId), locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig,
    // ADR-040 §15 — the home page is always public: a Download section here lists documents for everyone only.
    downloads: homePage._id ? {
      projectSegment: String(tenantId),
      pageId: homePage._id,
      page: { restricted: false, groupIds: [] },
      visitorGroupIds: null,
      locale,
      defaultLocale,
      siteBaseFor: (l) => siteBasePath(l, tenantId, hostScoped),
    } : undefined,
  })

  // ADR-037 D7 — one FAQPage from every FAQ section this page renders (none
  // when the FAQ module is not installed: the sections do not render either).
  const faqItems = collectSectionFaqItems(homePage.sections, {
    available: isSectionTypeAvailable('faqSection', enabledModuleIds),
    links: faqJsonLdLinks({ locale, siteBase: siteBasePath(locale, tenantId, hostScoped), origin: canonicalOrigin(siteConfig?.customDomain) }),
  })

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
        faqItems={faqItems}
        locale={locale}
        tenantId={tenantId}
        pathSegments={[]}
        logoUrl={siteConfig?.logo ? imageUrl(siteConfig.logo as never, 512) : undefined}
      />

      {/* ── Hero section (always first) ──────────────────────────── */}
      {heroSections.map((section, index) => (
        <SectionRenderer
          hostScoped={hostScoped}
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
          hostScoped={hostScoped}
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
