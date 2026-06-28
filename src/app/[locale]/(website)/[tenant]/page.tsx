import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, blogListingPostsNewestQuery, blogListingPostsOldestQuery, blogListingManualPostsQuery, homepageFeaturedEventQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { HeroLiveCaptureSection } from '@/components/sections/HeroLiveCaptureSection'
import { HeroLensSection } from '@/components/sections/HeroLensSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import { FormSection } from '@/components/sections/FormSection'
import { StatementSection } from '@/components/sections/StatementSection'
import { MetricsSection } from '@/components/sections/MetricsSection'
import { SECTION_MAP } from '@/lib/modules/sections'
import { FeaturedEventBlock } from '@/components/events/FeaturedEventBlock'
import { SectionContainer } from '@/components/sections/SectionContainer'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, BlogListingSection as BlogListingSectionType, FormSection as FormSectionType, HeroLiveCaptureSection as HeroLiveCaptureSectionType, HeroLensSection as HeroLensSectionType, SupportedLocale, DesignSystem, Post, Event } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import { isProduction, isDev } from '@/lib/deployment'
import { ogImageUrl } from '@/lib/sanity/image'

export const dynamic = 'force-dynamic'

// ─── Blog listing post fetcher ────────────────────────────────────────────────

/**
 * Fetch posts for a single blogListingSection based on its filter + sort config.
 * Returns one extra post beyond maxItems so the caller can detect "has more".
 */
async function fetchBlogListingPosts(
  section: BlogListingSectionType,
  fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant'],
  locale: SupportedLocale,
  defaultLocale: SupportedLocale,
): Promise<Post[]> {
  const {
    filterMode = 'latest',
    sortOrder = 'newest',
    maxItems = 3,
    categoryId,
    eventId,
    postIds,
  } = section

  // Manual selection: fetch by explicit post IDs then sort/reorder in JS
  if (filterMode === 'manual' && postIds?.length) {
    const posts = await fetchForTenant<Post[]>(blogListingManualPostsQuery, {
      locale,
      defaultLocale,
      postIds,
    })
    if (sortOrder === 'manual') {
      // Preserve the editor-defined array order
      const indexMap: Record<string, number> = Object.fromEntries(
        postIds.map((id, i) => [id, i])
      )
      return [...posts].sort((a, b) => (indexMap[a._id] ?? 999) - (indexMap[b._id] ?? 999))
    }
    if (sortOrder === 'oldest') {
      return posts.sort((a, b) =>
        (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '')
      )
    }
    return posts.sort((a, b) =>
      (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
    )
  }

  // Dynamic filter (latest / featured / byCategory / byEvent) — let GROQ sort
  const query = sortOrder === 'oldest' ? blogListingPostsOldestQuery : blogListingPostsNewestQuery
  return fetchForTenant<Post[]>(query, {
    locale,
    defaultLocale,
    filterMode,
    categoryId: categoryId ?? null,
    eventId: eventId ?? null,
    // Fetch one extra to detect "has more" for the View All button
    maxItems: maxItems + 1,
  })
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale } = await params
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

// ─── Section renderer ─────────────────────────────────────────────────────────

function SectionRenderer({
  section,
  siteConfig,
  designSystem,
  backgroundPattern,
  sectionIndex,
  locale,
  tenantSlug,
  fromParam,
}: {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  backgroundPattern: string | undefined
  sectionIndex: number
  locale: string
  tenantSlug: string
  fromParam?: string
}) {
  const surface = computeSectionSurface(section.background, backgroundPattern as any, sectionIndex)

  // ── Module-owned sections ────────────────────────────────────────────────
  // Derived from MODULE_REGISTRY via SECTION_MAP. New module sections are
  // registered in their module's sections.tsx file; no changes here required.
  const ModuleSection = SECTION_MAP[section._type]
  if (ModuleSection) {
    return <>{ModuleSection({ section, surface, designSystem, siteConfig, locale, tenantSlug, fromParam })}</>
  }

  // ── Platform-owned sections ──────────────────────────────────────────────
  // These sections are platform assets available to every tenant regardless
  // of which modules are installed. They are registered here explicitly and
  // must not be moved to module files (Sections vs Modules principle, ADR-011).
  switch (section._type) {
    case 'heroSection':
      return <HeroSection section={section} surface={surface} designSystem={designSystem} />
    case 'heroLiveCaptureSection':
      return <HeroLiveCaptureSection section={section as HeroLiveCaptureSectionType} surface={surface} designSystem={designSystem} />
    case 'heroLensSection':
      return <HeroLensSection section={section as HeroLensSectionType} surface={surface} designSystem={designSystem} />
    case 'contentSection':
      return <ContentSection section={section} surface={surface} designSystem={designSystem} />
    case 'statementSection':
      return <StatementSection section={section} surface={surface} designSystem={designSystem} />
    case 'treatmentsSection':
      return <TreatmentsSection section={section} surface={surface} designSystem={designSystem} />
    case 'teamSection':
      return <TeamSection section={section} surface={surface} designSystem={designSystem} />
    case 'textSection':
      return <TextSection section={section} surface={surface} designSystem={designSystem} />
    case 'faqSection':
      return <FAQSection section={section} surface={surface} designSystem={designSystem} />
    case 'contactSection':
      return <ContactSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} locale={locale} />
    case 'formSection':
      return <FormSection section={section as FormSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
    case 'metricsSection':
      return <MetricsSection section={section} surface={surface} designSystem={designSystem} />
    default:
      return null
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WebsitePage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [homePage, siteConfig, designSystem, featuredEvent] = await Promise.all([
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => { const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {}); return resolveDesignSystemInheritance(raw, fetchDesignSystemById); })(),
    fetchForTenant<Event>(homepageFeaturedEventQuery, { locale, defaultLocale }),
  ])

  if (!homePage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-400">No home page found for: {tenantId}</p>
      </div>
    )
  }

  // Hydrate any blogListingSection sections with posts fetched server-side
  if (homePage.sections) {
    await Promise.all(
      homePage.sections.map(async (section) => {
        if (section._type !== 'blogListingSection') return
        const bls = section as BlogListingSectionType
        const posts = await fetchBlogListingPosts(bls, fetchForTenant, locale as SupportedLocale, defaultLocale)
        // Slice to maxItems — we fetched one extra to detect overflow for View All
        bls.posts = posts.slice(0, bls.maxItems ?? 3)
      })
    )
  }

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
        />
      ))}
    </>
  )
}
