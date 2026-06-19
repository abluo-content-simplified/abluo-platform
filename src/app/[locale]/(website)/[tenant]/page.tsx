import { tenantClient } from '@/lib/sanity/client'
import { pageHomeQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, blogListingPostsNewestQuery, blogListingPostsOldestQuery, blogListingManualPostsQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import { BlogListingSection } from '@/components/sections/BlogListingSection'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, BlogListingSection as BlogListingSectionType, SupportedLocale, DesignSystem, Post } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import { isProduction, isDev } from '@/lib/deployment'

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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? ''
  const canonical = `${baseUrl}/${locale}/${tenantId}`

  // Build hreflang alternates dynamically from siteConfig.supportedLocales.
  // Only emit entries for locales the site actually supports.
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages: Record<string, string> = {}
  for (const loc of supportedLocales) {
    languages[loc] = `${baseUrl}/${loc}/${tenantId}`
  }

  // OG locale tag — maps 2-letter code to IETF format
  const ogLocaleMap: Record<string, string> = {
    en: 'en_US', it: 'it_IT', de: 'de_DE', fr: 'fr_FR',
    es: 'es_ES', pt: 'pt_PT', nl: 'nl_NL',
  }

  return {
    title: config?.siteName ?? tenantId,
    description: config?.tagline,
    alternates: {
      // Canonical: production only
      canonical: isProduction() ? canonical : undefined,
      // hreflang: production + preview (for pre-launch multilingual validation)
      languages: !isDev() && Object.keys(languages).length > 0 ? languages : undefined,
    },
    openGraph: {
      title: config?.siteName ?? tenantId,
      description: config?.tagline ?? undefined,
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
}: {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  backgroundPattern: string | undefined
  sectionIndex: number
  locale: string
}) {
  const surface = computeSectionSurface(section.background, backgroundPattern as any, sectionIndex)

  switch (section._type) {
    case 'heroSection':
      return <HeroSection section={section} surface={surface} designSystem={designSystem} />
    case 'contentSection':
      return <ContentSection section={section} surface={surface} designSystem={designSystem} />
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
    case 'blogListingSection':
      return <BlogListingSection section={section} surface={surface} designSystem={designSystem} />
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

  const [homePage, siteConfig, designSystem] = await Promise.all([
    fetchForTenant<WebsitePage>(pageHomeQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => { const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {}); return resolveDesignSystemInheritance(raw, fetchDesignSystemById); })(),
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

  return (
    <>
      <JsonLd
        siteConfig={siteConfig}
        faqSection={faqSection}
        locale={locale}
        tenantId={tenantId}
      />
      {homePage.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={homePage.backgroundPattern}
          sectionIndex={index}
          locale={locale}
        />
      ))}
    </>
  )
}
