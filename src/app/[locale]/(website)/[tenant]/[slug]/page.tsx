import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { HeroSection } from '@/components/sections/HeroSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'
import { notFound } from 'next/navigation'

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

  return {
    title: pageTitle,
    alternates: {
      canonical,
      languages: {
        it: `${baseUrl}/it/${tenantId}/${slug}`,
        en: `${baseUrl}/en/${tenantId}/${slug}`,
      },
    },
    openGraph: {
      title: pageTitle,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: locale === 'it' ? 'it_IT' : 'en_US',
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
}: {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  backgroundPattern: string | undefined
  sectionIndex: number
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
      return <ContactSection section={section} surface={surface} designSystem={designSystem} siteConfig={siteConfig} />
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

  if (!page) return notFound()

  const faqSection = page.sections?.find(
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
      {page.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={page.backgroundPattern}
          sectionIndex={index}
        />
      ))}
    </>
  )
}
