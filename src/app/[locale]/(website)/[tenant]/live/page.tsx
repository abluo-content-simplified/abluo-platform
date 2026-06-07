import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import { currentLiveEventQuery, localeConfigQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import type { Event, LocaleConfig, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'
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

  const event = await fetchForTenant<Event>(currentLiveEventQuery, { locale, defaultLocale })

  return {
    title: event?.seoTitle ?? event?.title ?? 'Live — Livener',
    description: event?.seoDescription ?? event?.shortDescription ?? 'Live video streaming from Livener.',
    openGraph: {
      title: event?.seoTitle ?? event?.title ?? 'Live — Livener',
      description: event?.seoDescription ?? event?.shortDescription ?? undefined,
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LivePage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // Fetch event and siteConfig in parallel
  const [event, siteConfig] = await Promise.all([
    fetchForTenant<Event>(currentLiveEventQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
  ])

  return (
    <LivePageContent
      event={event}
      siteConfig={siteConfig}
      locale={locale as SupportedLocale}
    />
  )
}
