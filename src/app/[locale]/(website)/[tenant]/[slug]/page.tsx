import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery, pageByOldSlugQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, blogListingPostsNewestQuery, blogListingPostsOldestQuery, blogListingManualPostsQuery } from '@/lib/sanity/queries'
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
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, BlogListingSection as BlogListingSectionType, FormSection as FormSectionType, HeroLiveCaptureSection as HeroLiveCaptureSectionType, HeroLensSection as HeroLensSectionType, SupportedLocale, DesignSystem, Post } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import { notFound, redirect } from 'next/navigation'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { isProduction, isDev } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

// ─── Blog listing post fetcher ────────────────────────────────────────────────

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

  if (filterMode === 'manual' && postIds?.length) {
    const posts = await fetchForTenant<Post[]>(blogListingManualPostsQuery, {
      locale,
      defaultLocale,
      postIds,
    })
    if (sortOrder === 'manual') {
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

  const query = sortOrder === 'oldest' ? blogListingPostsOldestQuery : blogListingPostsNewestQuery
  return fetchForTenant<Post[]>(query, {
    locale,
    defaultLocale,
    filterMode,
    categoryId: categoryId ?? null,
    eventId: eventId ?? null,
    maxItems: maxItems + 1,
  })
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale, slug } = await params
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

export default async function WebsitePageRoute({ params }: PageProps) {
  const { tenant: tenantId, locale, slug } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [page, siteConfig, designSystem] = await Promise.all([
    fetchForTenant<WebsitePage>(pageBySlugQuery, { locale, defaultLocale, slug }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
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
  if (page.sections) {
    await Promise.all(
      page.sections.map(async (section) => {
        if (section._type !== 'blogListingSection') return
        const bls = section as BlogListingSectionType
        const posts = await fetchBlogListingPosts(bls, fetchForTenant, locale as SupportedLocale, defaultLocale)
        bls.posts = posts.slice(0, bls.maxItems ?? 3)
      })
    )
  }

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
        />
      ))}
    </SlugMapProvider>
  )
}
