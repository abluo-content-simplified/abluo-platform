import type { Metadata } from 'next'
import { isProduction } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import {
  currentLiveEventQuery,
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
  livePageQuery,
  projectDomainQuery,
  enabledModuleIdsQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, LocaleConfig, LivePage, SupportedLocale, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { ogImageUrl } from '@/lib/sanity/image'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'

// force-dynamic: always render server-side so event status changes are immediate.
// (ISR can permanently cache a failed initial generation if Sanity returns null at build time.)
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

  const [event, livePage, customDomain] = await Promise.all([
    fetchForTenant<Event>(currentLiveEventQuery, { locale, defaultLocale }),
    fetchForTenant<LivePage>(livePageQuery, { locale, defaultLocale }),
    fetchForTenant<string | null>(projectDomainQuery, {}),
  ])

  const title = livePage?.seoTitle ?? event?.seoTitle ?? event?.title ?? 'Live — Livener'
  const description = livePage?.seoDescription ?? event?.seoDescription ?? event?.shortDescription ?? 'Live video streaming from Livener.'

  const canonicalBase = customDomain ? `https://${customDomain}` : null
  const canonical = canonicalBase && isProduction()
    ? `${canonicalBase}/${locale}/${tenantId}/live`
    : undefined

  // Use the current event's hero image for OG when available.
  const ogImg = event?.heroImage?.asset ? ogImageUrl(event.heroImage) : undefined
  const ogImages = ogImg ? [{ url: ogImg, width: 1200, height: 630 }] : undefined

  return {
    title,
    description,
    alternates: { canonical },
    ...(ogImages ? {
      openGraph: { title, description, url: canonical, images: ogImages },
      twitter:   { card: 'summary_large_image' as const, title, description, images: [ogImg!] },
    } : {
      openGraph: { title, description, url: canonical },
    }),
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LivePage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ADR-016 Phase C — the page now renders purely from sections[]. The
  // current-event / past-events / "More Live Productions" data that used to
  // be fetched here directly is now fetched by hydrateSections below, driven
  // by the migrated liveLatestSection + eventsListingSection sections.
  const [livePage, siteConfig, designSystem, enabledModuleIds] = await Promise.all([
    fetchForTenant<LivePage>(livePageQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<string[] | null>(enabledModuleIdsQuery, {}),
  ])

  // ADR-016 Phase A/C — hydrate blogListingSection / eventsListingSection /
  // liveLatestSection sections with data fetched server-side, mutating
  // livePage.sections in place. This is now the ONLY data-fetch path for the
  // page body — there is no fixed-field rendering left.
  await hydrateSections(livePage?.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds })

  return (
    <>
      {livePage?.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={undefined}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam="live"
          enabledModuleIds={enabledModuleIds}
        />
      ))}
    </>
  )
}
