import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery, pageByOldSlugQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import { FormSection } from '@/components/sections/FormSection'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, FormSection as FormSectionType, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import { notFound, redirect } from 'next/navigation'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { isProduction, isDev } from '@/lib/deployment'

export const dynamic = 'force-dynamic'

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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? ''
  const canonical = `${baseUrl}/${locale}/${tenantId}/${slug}`

  const pageTitle = page.title
    ? `${page.title} — ${config?.siteName ?? tenantId}`
    : config?.siteName ?? tenantId

  // Build hreflang alternates from the page's per-locale slug map.
  // Only include locales that have an actual slug set (not empty).
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages: Record<string, string> = {}
  for (const loc of supportedLocales) {
    const locSlug = page.slugMap?.[loc]?.current
    if (locSlug) {
      languages[loc] = `${baseUrl}/${loc}/${tenantId}/${locSlug}`
    }
  }

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
}: {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  backgroundPattern: string | undefined
  sectionIndex: number
  locale: string
  tenantSlug: string
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
    case 'formSection':
      return <FormSection section={section as FormSectionType} surface={surface} designSystem={designSystem} locale={locale} tenantSlug={tenantSlug} />
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
        />
      ))}
    </SlugMapProvider>
  )
}
