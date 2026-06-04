import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import { currentLiveEventQuery, localeConfigQuery } from '@/lib/sanity/queries'
import type { Event, LocaleConfig, SupportedLocale } from '@/lib/sanity/types'
import { LivePageContent } from '@/components/livener/live/LivePageContent'

// ISR: revalidate every 60 seconds so status changes (upcoming → live → past)
// propagate quickly without requiring a full redeploy
export const revalidate = 60

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

  // Get the tenant's default locale for proper GROQ fallback resolution
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // Fetch the current or next live event
  // Priority: isCurrentLiveEvent flag → status "live" → next upcoming by startDate
  const event = await fetchForTenant<Event>(currentLiveEventQuery, {
    locale: locale as SupportedLocale,
    defaultLocale,
  })

  return <LivePageContent event={event} locale={locale as SupportedLocale} />
}
