import { tenantClient } from '@/lib/sanity/client'
import { homePageQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import { HeroSection } from '@/components/sections/HeroSection'
import { ContentSection } from '@/components/sections/ContentSection'
import { TreatmentsSection } from '@/components/sections/TreatmentsSection'
import { TeamSection } from '@/components/sections/TeamSection'
import { TextSection } from '@/components/sections/TextSection'
import { ContactSection } from '@/components/sections/ContactSection'
import type { WebsiteHomePage, WebsiteSiteConfig, PageSection } from '@/lib/sanity/types'
import type { Metadata } from 'next'

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId } = await params
  const { fetchForTenant } = tenantClient(tenantId)
  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery)
  return {
    title: config?.siteName ?? tenantId,
    description: config?.tagline,
  }
}

// ─── Section renderer ─────────────────────────────────────────────────────────

function SectionRenderer({
  section,
  siteConfig,
}: {
  section: PageSection
  siteConfig: WebsiteSiteConfig | null
}) {
  switch (section._type) {
    case 'heroSection':
      return <HeroSection section={section} />
    case 'contentSection':
      return <ContentSection section={section} />
    case 'treatmentsSection':
      return <TreatmentsSection section={section} />
    case 'teamSection':
      return <TeamSection section={section} />
    case 'textSection':
      return <TextSection section={section} />
    case 'contactSection':
      return <ContactSection section={section} siteConfig={siteConfig} />
    default:
      return null
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WebsitePage({ params }: PageProps) {
  const { tenant: tenantId } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const [homePage, siteConfig] = await Promise.all([
    fetchForTenant<WebsiteHomePage>(homePageQuery),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery),
  ])

  if (!homePage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-400">Contenuto non trovato per: {tenantId}</p>
      </div>
    )
  }

  return (
    <>
      {homePage.sections?.map((section) => (
        <SectionRenderer key={section._key} section={section} siteConfig={siteConfig} />
      ))}
    </>
  )
}
