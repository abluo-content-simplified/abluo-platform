'use client'

import { SlideUp, FadeIn } from '@/components/animation'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { EventCard } from '@/components/events/EventCard'
import { FeaturedEventBlock } from '@/components/events/FeaturedEventBlock'
import type { Event, LivePage, SupportedLocale, WebsiteSiteConfig, DesignSystem } from '@/lib/sanity/types'

// Cloudflare Stream account subdomain for Livener.
// To generate an embed URL: https://${CLOUDFLARE_ACCOUNT}.cloudflarestream.com/${videoId}/iframe
const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'

function cloudflareEmbedUrl(videoId: string): string {
  return `https://${CLOUDFLARE_ACCOUNT}.cloudflarestream.com/${videoId}/iframe`
}

interface LivePageContentProps {
  event: Event | null
  livePage: LivePage | null
  siteConfig: WebsiteSiteConfig | null
  designSystem: DesignSystem | null
  pastEvents?: Event[]
  additionalLiveEvents?: Event[]
  locale: SupportedLocale
  tenantId: string
}

// Section title lookup — matches next-intl messages/[locale].json live.moreLiveProductions
const moreLiveTitles: Record<string, string> = {
  en: 'More Live Productions',
  it: 'Altre Produzioni Live',
  de: 'Weitere Live-Produktionen',
}

// ─── No event fallback ────────────────────────────────────────────────────────

function NoLiveEvent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-10">
      <div className="text-center">
        <p
          className="text-2xl font-semibold"
          style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)', opacity: 0.4 }}
        >
          No live event scheduled right now.
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-primary)', opacity: 0.25 }}>
          Check back soon.
        </p>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LivePageContent({
  event,
  livePage,
  siteConfig,
  designSystem,
  pastEvents = [],
  additionalLiveEvents = [],
  locale,
  tenantId,
}: LivePageContentProps) {
  if (!event) return <NoLiveEvent />

  // ─── Motion tokens from resolved design system ─────────────────────────────
  const m = designSystem?.motion
  const durationSlower = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const durationSlow   = m?.durationSlow   !== undefined ? m.durationSlow   / 1000 : 0.35
  const easeReveal: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const gallerySrc = event.gallery?.[0] ? imageUrl(event.gallery[0], 1600) : undefined
  const gallerySrcSet = event.gallery?.[0] ? imageSrcSet(event.gallery[0], [800, 1200, 1600]) : undefined

  // Editorial content from livePage document, with fallbacks
  const headline    = livePage?.heroTitle    ?? 'Welcome to Livener'
  const subheadline = livePage?.heroSubtitle ?? 'Live video streaming, in the palm of your hands'
  const betaNotice  = livePage?.betaNotice   ?? 'Currently in beta — tested live, in real environments.'

  // Cloudflare video embed URL
  const embedUrl = livePage?.cloudflareVideoId
    ? cloudflareEmbedUrl(livePage.cloudflareVideoId)
    : null

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
      }}
    >
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

        {/* ── Page welcome ─────────────────────────────────────────── */}
        <SlideUp duration={durationSlower} ease={easeReveal}>
          <h1
            className="text-[clamp(48px,8vw,68px)] font-bold leading-[1.05]"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {headline}
          </h1>
        </SlideUp>

        <SlideUp delay={0.1} duration={durationSlower} ease={easeReveal}>
          <h2
            className="mt-3 text-[clamp(22px,4vw,32px)] font-semibold leading-tight"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}
          >
            {subheadline}
          </h2>
        </SlideUp>

        <SlideUp delay={0.18} duration={durationSlow} ease={easeReveal}>
          <p className="mt-4 text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {betaNotice}
          </p>
        </SlideUp>

        {/* ── Cloudflare video embed ────────────────────────────────── */}
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

        {/* ── Event announcement (status, title, date, image, CTA) ──── */}
        <div className="mt-14">
          <FeaturedEventBlock
            event={event}
            designSystem={designSystem}
            locale={locale}
            tenantId={tenantId}
          />
        </div>

        {/* ── Full description ────────────────────────────────────── */}
        {event.fullDescription && Array.isArray(event.fullDescription) && event.fullDescription.length > 0 && (
          <SlideUp delay={0.08} ease={easeReveal} className="mt-10">
            <div
              className="space-y-4 text-base leading-relaxed"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {(event.fullDescription as any[]).map((block: any) => {
                if (block._type !== 'block') return null
                const text = block.children?.map((c: any) => c.text).join('') ?? ''
                return <p key={block._key}>{text}</p>
              })}
            </div>
          </SlideUp>
        )}

        {/* ── Gallery image ─────────────────────────────────────────── */}
        {gallerySrc && (
          <FadeIn delay={0.1} duration={durationSlow} ease={easeReveal} className="mt-14 overflow-hidden rounded-2xl">
            <img
              src={gallerySrc}
              srcSet={gallerySrcSet}
              sizes="(max-width: 900px) 100vw, 900px"
              alt={event.gallery?.[0]?.alt ?? ''}
              className="w-full object-cover"
              loading="lazy"
            />
          </FadeIn>
        )}

        {/* ── More Live Productions ────────────────────────────────── */}
        {additionalLiveEvents.length > 0 && (
          <div className="mt-20 border-t pt-20" style={{ borderColor: 'var(--color-border)' }}>
            <SlideUp duration={durationSlower} ease={easeReveal}>
              <h2
                className="text-[clamp(28px,5vw,46px)] font-bold leading-tight mb-10"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
              >
                {moreLiveTitles[locale] ?? moreLiveTitles.en}
              </h2>
            </SlideUp>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {additionalLiveEvents.map((liveEvent, idx) => (
                <EventCard
                  key={liveEvent._id}
                  event={liveEvent}
                  locale={locale}
                  tenantId={tenantId}
                  delay={0.05 + idx * 0.08}
                  duration={durationSlower}
                  ease={easeReveal}
                  from="live"
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Past / Featured Events ────────────────────────────────── */}
        {pastEvents && pastEvents.length > 0 && (
          <div className="mt-20 border-t pt-20" style={{ borderColor: 'var(--color-border)' }}>
            <SlideUp duration={durationSlower} ease={easeReveal}>
              <h2
                className="text-[clamp(28px,5vw,46px)] font-bold leading-tight mb-10"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
              >
                Past Live Events
              </h2>
            </SlideUp>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {pastEvents.map((pastEvent, idx) => (
                <EventCard
                  key={pastEvent._id}
                  event={pastEvent}
                  locale={locale}
                  tenantId={tenantId}
                  delay={0.05 + idx * 0.08}
                  duration={durationSlower}
                  ease={easeReveal}
                  from="live"
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
