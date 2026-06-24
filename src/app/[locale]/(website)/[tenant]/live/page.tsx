import type { Metadata } from 'next'
import { isProduction } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import {
  currentLiveEventQuery,
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
  pastEventsQuery,
  livePageQuery,
  projectDomainQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, LocaleConfig, LivePage, SupportedLocale, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { ogImageUrl } from '@/lib/sanity/image'
import { LivePageContent } from '@/components/livener/live/LivePageContent'

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

  const [event, livePage, siteConfig, designSystem, pastEvents] = await Promise.all([
    fetchForTenant<Event>(currentLiveEventQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
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
    fetchForTenant<Event[]>(pastEventsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
  ])

  // Featured events from livePage take precedence over auto past events
  const displayEvents = (livePage?.featuredEvents && livePage.featuredEvents.length > 0)
    ? livePage.featuredEvents
    : (pastEvents ?? [])

  return (
    <LivePageContent
      event={event}
      livePage={livePage}
      siteConfig={siteConfig}
      designSystem={designSystem}
      pastEvents={displayEvents}
      locale={locale as SupportedLocale}
      tenantId={tenantId}
    />
  )
}
