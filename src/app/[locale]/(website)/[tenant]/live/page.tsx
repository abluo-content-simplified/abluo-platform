import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import { currentLiveEventQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, pastEventsQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, LocaleConfig, SupportedLocale, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
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

  // Fetch event, siteConfig, designSystem, and past events in parallel
  const [event, siteConfig, designSystem, pastEvents] = await Promise.all([
    fetchForTenant<Event>(currentLiveEventQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    (async () => { const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {}); return resolveDesignSystemInheritance(raw, fetchDesignSystemById); })(),
    fetchForTenant<Event[]>(pastEventsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
  ])

  return (
    <LivePageContent
      event={event}
      siteConfig={siteConfig}
      designSystem={designSystem}
      pastEvents={pastEvents ?? []}
      locale={locale as SupportedLocale}
    />
  )
}
