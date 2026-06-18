import type { Metadata } from 'next'
import Link from 'next/link'
import { tenantClient } from '@/lib/sanity/client'
import {
  eventsPageQuery,
  eventsQuery,
  localeConfigQuery,
  designSystemQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, EventsPage, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { SlideUp, FadeIn } from '@/components/animation'

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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Event['status'] }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        Live
      </span>
    )
  }
  if (status === 'upcoming') {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-widest"
        style={{
          borderColor: 'color-mix(in oklch, var(--color-primary) 25%, transparent)',
          backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
          color: 'var(--color-primary)',
        }}
      >
        Upcoming
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-widest"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
    >
      Past
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventsListPage({ params }: PageProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [eventsPage, events, designSystem] = await Promise.all([
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
  ])

  // ─── Motion tokens ──────────────────────────────────────────────────────────
  const m = designSystem?.motion
  const durationSlower = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const durationSlow   = m?.durationSlow   !== undefined ? m.durationSlow   / 1000 : 0.35
  const easeReveal: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const headline    = eventsPage?.heroTitle    ?? 'Events'
  const subheadline = eventsPage?.heroSubtitle ?? null
  const introText   = eventsPage?.introText    ?? null
  const embedUrl    = eventsPage?.cloudflareVideoId ? cloudflareEmbedUrl(eventsPage.cloudflareVideoId) : null
  const heroSrc     = eventsPage?.heroImage ? imageUrl(eventsPage.heroImage, 1600) : null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

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
              No events yet. Check back soon.
            </p>
          </SlideUp>
        ) : (
          <div className="mt-14 grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event, idx) => {
              const eventHeroSrc = imageUrl(event.heroImage, 600)
              const startDate = event.startDate
                ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(event.startDate))
                : null

              return (
                <SlideUp key={event._id} delay={0.05 + idx * 0.06} duration={durationSlower} ease={easeReveal}>
                  <Link
                    href={`/${locale}/${tenantId}/events/${event.slug.current}`}
                    className="group flex flex-col overflow-hidden rounded-2xl transition-all hover:shadow-xl h-full"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid',
                      borderColor: 'var(--color-border)',
                    }}
                  >
                    {/* Image — fixed height, always covers */}
                    <div className="overflow-hidden shrink-0" style={{ height: '200px' }}>
                      {eventHeroSrc ? (
                        <img
                          src={eventHeroSrc}
                          alt={event.heroImage?.alt ?? event.title ?? ''}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full" style={{ backgroundColor: 'var(--color-border)' }} />
                      )}
                    </div>

                    {/* Content — flex column, CTA pinned to bottom */}
                    <div className="flex flex-col flex-1 p-5">
                      <div className="mb-3 shrink-0">
                        <StatusBadge status={event.status} />
                      </div>

                      <h2
                        className="font-semibold text-base leading-snug mb-2 line-clamp-2 shrink-0 group-hover:opacity-75 transition-opacity"
                        style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                      >
                        {event.title}
                      </h2>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mb-3 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                        {startDate && <span>📅 {startDate}</span>}
                        {event.location && <span>📍 {event.location}</span>}
                      </div>

                      <p
                        className="text-sm line-clamp-3 flex-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {event.shortDescription ?? ''}
                      </p>

                      {/* CTA — always at bottom */}
                      <div className="mt-4 pt-4 shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                          View Details →
                        </span>
                      </div>
                    </div>
                  </Link>
                </SlideUp>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
