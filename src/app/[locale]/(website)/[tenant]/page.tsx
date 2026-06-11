import { tenantClient } from '@/lib/sanity/client'
import { homePageQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import { HeroSection } from '@/components/sections/HeroSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { FAQSection } from '@/components/sections/FAQSection'
import { ContactSection } from '@/components/sections/ContactSection'
import type { WebsiteHomePage, WebsiteSiteConfig, LocaleConfig, PageSection, FAQSection as FAQSectionType, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { computeSectionSurface } from '@/lib/sanity/surfaces'

export const dynamic = 'force-dynamic'

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

  return {
    title: config?.siteName ?? tenantId,
    description: config?.tagline,
    alternates: {
      canonical,
      languages: {
        it: `${baseUrl}/it/${tenantId}`,
        en: `${baseUrl}/en/${tenantId}`,
      },
    },
    openGraph: {
      title: config?.siteName ?? tenantId,
      description: config?.tagline ?? undefined,
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

export default async function WebsitePage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [homePage, siteConfig, designSystem] = await Promise.all([
    fetchForTenant<WebsiteHomePage>(homePageQuery, { locale, defaultLocale }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    fetchForTenant<DesignSystem>(designSystemQuery, {}),
  ])

  if (!homePage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-400">Contenuto non trovato per: {tenantId}</p>
      </div>
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
        />
      ))}
    </>
  )
}
