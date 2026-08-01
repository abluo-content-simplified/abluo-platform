import type { Metadata } from 'next'
import { isProduction } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import {
  currentLiveEventQuery,
  localeConfigQuery,
  websiteSiteConfigQuery,
  designSystemQuery,
  pastEventsQuery,
  additionalLiveEventsQuery,
  livePageQuery,
  projectDomainQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, LocaleConfig, LivePage, SupportedLocale, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'
import { ogImageUrl } from '@/lib/sanity/image'
import { LivePageContent } from '@/components/livener/live/LivePageContent'
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

  // Phase 1 — fetch featured event first so we can exclude its _id from additional live events
  const event = await fetchForTenant<Event>(currentLiveEventQuery, {
    locale: locale as SupportedLocale,
    defaultLocale,
  })

  // Phase 2 — fetch everything else in parallel
  const [livePage, siteConfig, designSystem, pastEvents, additionalLiveEvents] = await Promise.all([
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
    fetchForTenant<Event[]>(additionalLiveEventsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
      featuredEventId: event?._id ?? '',
    }),
  ])

  // Choose the event source: manual curation takes precedence over the auto-query.
  // The defensive filter below always removes the featured/current event and any
  // duplicates — so editors can include the live event in the manual list without
  // causing it to appear twice on the page.
  const rawDisplayEvents = livePage?.featuredEvents?.length
    ? livePage.featuredEvents
    : (pastEvents ?? [])

  const seenIds = new Set<string>()
  const displayEvents = rawDisplayEvents.filter(e => {
    if (e._id === event?._id) return false   // never show the featured event again
    if (seenIds.has(e._id)) return false      // deduplicate
    seenIds.add(e._id)
    return true
  })

  // ADR-016 Phase A — hydrate any blogListingSection sections with posts
  // fetched server-side, mutating livePage.sections in place. Additive only:
  // the fixed LivePageContent above is untouched, sections render after it.
  await hydrateSections(livePage?.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale })

  return (
    <>
      <LivePageContent
        event={event}
        livePage={livePage}
        siteConfig={siteConfig}
        designSystem={designSystem}
        pastEvents={displayEvents}
        additionalLiveEvents={additionalLiveEvents ?? []}
        locale={locale as SupportedLocale}
        tenantId={tenantId}
      />

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
        />
      ))}
    </>
  )
}
