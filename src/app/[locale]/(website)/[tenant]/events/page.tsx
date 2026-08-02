import type { Metadata } from 'next'
import { tenantClient } from '@/lib/sanity/client'
import {
  eventsPageQuery,
  eventsQuery,
  localeConfigQuery,
  designSystemQuery,
  websiteSiteConfigQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, EventsPage, LocaleConfig, SupportedLocale, DesignSystem, WebsiteSiteConfig } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { SlideUp, FadeIn } from '@/components/animation'
import { EventCard } from '@/components/events/EventCard'
import { PageContainer } from '@/components/layout/PageContainer'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import { getEventMessages } from '@/lib/i18n/event-messages'

// Cloudflare Stream account subdomain — shared with LivePageContent
const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'

function cloudflareEmbedUrl(videoId: string): string {
  return `https://${CLOUDFLARE_ACCOUNT}.cloudflarestream.com/${videoId}/iframe`
}

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

  const eventsPage = await fetchForTenant<EventsPage>(eventsPageQuery, { locale, defaultLocale })

  return {
    title: eventsPage?.seoTitle ?? eventsPage?.heroTitle ?? 'Events',
    description: eventsPage?.seoDescription ?? eventsPage?.heroSubtitle ?? 'All events',
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventsListPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [eventsPage, events, designSystem, siteConfig] = await Promise.all([
    fetchForTenant<EventsPage>(eventsPageQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    fetchForTenant<Event[]>(eventsQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, {
      locale: locale as SupportedLocale,
      defaultLocale,
    }),
  ])

  const msg = getEventMessages(locale)

  // ─── Motion tokens ──────────────────────────────────────────────────────────
  const m = designSystem?.motion
  const durationSlower = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const durationSlow   = m?.durationSlow   !== undefined ? m.durationSlow   / 1000 : 0.35
  const easeReveal: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  // ADR-016 Phase A — hydrate any blogListingSection sections with posts
  // fetched server-side, mutating eventsPage.sections in place. Additive only:
  // the fixed hero/grid content below is untouched, sections render after it.
  await hydrateSections(eventsPage?.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale })

  const headline    = eventsPage?.heroTitle    ?? 'Events'
  const subheadline = eventsPage?.heroSubtitle ?? null
  const introText   = eventsPage?.introText    ?? null
  const embedUrl    = eventsPage?.cloudflareVideoId ? cloudflareEmbedUrl(eventsPage.cloudflareVideoId) : null
  const heroSrc     = eventsPage?.heroImage ? imageUrl(eventsPage.heroImage, 1600) : null

  return (
    <>
    <PageContainer>

        {/* ── Page header ──────────────────────────────────────────── */}
        <SlideUp duration={durationSlower} ease={easeReveal}>
          <h1
            className="text-[clamp(48px,8vw,68px)] font-bold leading-[1.05]"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {headline}
          </h1>
        </SlideUp>

        {subheadline && (
          <SlideUp delay={0.1} duration={durationSlower} ease={easeReveal}>
            <h2
              className="mt-3 text-[clamp(22px,4vw,32px)] font-semibold leading-tight"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}
            >
              {subheadline}
            </h2>
          </SlideUp>
        )}

        {introText && (
          <SlideUp delay={0.18} duration={durationSlow} ease={easeReveal}>
            <p className="mt-4 text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {introText}
            </p>
          </SlideUp>
        )}

        {/* ── Hero image ───────────────────────────────────────────── */}
        {heroSrc && (
          <FadeIn delay={0.2} duration={durationSlow} ease={easeReveal} className="mt-10 overflow-hidden rounded-2xl">
            <img
              src={heroSrc}
              alt={eventsPage?.heroImage?.alt ?? headline}
              className="w-full object-cover"
              loading="eager"
            />
          </FadeIn>
        )}

        {/* ── Video embed ───────────────────────────────────────────── */}
        {embedUrl && (
          <FadeIn delay={0.25} duration={durationSlow} ease={easeReveal} className="mt-10 overflow-hidden rounded-2xl">
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <iframe
                src={embedUrl}
                loading="lazy"
                style={{
                  border: 'none',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  width: '100%',
                  borderRadius: 'var(--radius-card, 16px)',
                }}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </FadeIn>
        )}

        {/* ── Events grid ──────────────────────────────────────────── */}
        {(!events || events.length === 0) ? (
          <SlideUp delay={0.2} duration={durationSlow} ease={easeReveal} className="mt-16">
            <p className="text-base" style={{ color: 'var(--color-text-muted)' }}>
              {msg.noEventsYetHeading} {msg.noEventsYetBody}
            </p>
          </SlideUp>
        ) : (
          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event, idx) => (
              <EventCard
                key={event._id}
                event={event}
                locale={locale}
                tenantId={tenantId}
                delay={0.05 + idx * 0.06}
                duration={durationSlower}
                ease={easeReveal}
                from="events"
              />
            ))}
          </div>
        )}
    </PageContainer>

    {eventsPage?.sections?.map((section, index) => (
      <SectionRenderer
        key={section._key}
        section={section}
        siteConfig={siteConfig}
        designSystem={designSystem}
        backgroundPattern={undefined}
        sectionIndex={index}
        locale={locale}
        tenantSlug={tenantId}
        fromParam="events"
      />
    ))}
    </>
  )
}
