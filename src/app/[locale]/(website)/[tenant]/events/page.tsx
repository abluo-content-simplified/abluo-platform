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
      style={{
        borderColor: 'var(--color-border)',
        color: 'var(--color-text-muted)',
      }}
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

  const m = designSystem?.motion
  const durationSlower = m?.durationSlower !== undefined ? m.durationSlower / 1000 : 0.6
  const durationSlow   = m?.durationSlow   !== undefined ? m.durationSlow   / 1000 : 0.35
  const easeReveal: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  const headline    = eventsPage?.heroTitle    ?? 'Events'
  const subheadline = eventsPage?.heroSubtitle ?? null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

        {/* ── Page header ──────────────────────────────────────────── */}
        <SlideUp duration={durationSlower} ease={easeReveal}>
          <h1
            className="text-[clamp(40px,7vw,64px)] font-bold leading-[1.05]"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {headline}
          </h1>
        </SlideUp>

        {subheadline && (
          <SlideUp delay={0.1} duration={durationSlow} ease={easeReveal}>
            <p
              className="mt-3 text-lg font-medium"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {subheadline}
            </p>
          </SlideUp>
        )}

        {/* ── Events grid ──────────────────────────────────────────── */}
        {(!events || events.length === 0) ? (
          <SlideUp delay={0.15} duration={durationSlow} ease={easeReveal} className="mt-16">
            <p className="text-base" style={{ color: 'var(--color-text-muted)' }}>
              No events yet. Check back soon.
            </p>
          </SlideUp>
        ) : (
          <div className="mt-12 grid gap-6 grid-cols-1 md:grid-cols-2">
            {events.map((event, idx) => {
              const heroSrc = imageUrl(event.heroImage, 600)
              const startDate = event.startDate
                ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(event.startDate))
                : null

              return (
                <SlideUp key={event._id} delay={0.05 + idx * 0.06} duration={durationSlower} ease={easeReveal}>
                  <Link
                    href={`/${locale}/${tenantId}/events/${event.slug.current}`}
                    className="group flex flex-col overflow-hidden rounded-2xl transition-all hover:shadow-xl"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid',
                      borderColor: 'var(--color-border)',
                    }}
                  >
                    {heroSrc && (
                      <div className="overflow-hidden" style={{ height: '220px' }}>
                        <img
                          src={heroSrc}
                          alt={event.heroImage?.alt ?? event.title ?? ''}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      </div>
                    )}

                    <div className="flex flex-col flex-1 p-5">
                      <div className="mb-3">
                        <StatusBadge status={event.status} />
                      </div>

                      <h2
                        className="font-semibold text-lg leading-snug mb-2 line-clamp-2 group-hover:opacity-75 transition-opacity"
                        style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                      >
                        {event.title}
                      </h2>

                      <div className="flex flex-wrap gap-3 text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                        {startDate && <span>📅 {startDate}</span>}
                        {event.location && <span>📍 {event.location}</span>}
                      </div>

                      {event.shortDescription && (
                        <p className="text-sm line-clamp-2 flex-1" style={{ color: 'var(--color-text-muted)' }}>
                          {event.shortDescription}
                        </p>
                      )}

                      <div className="mt-4 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                        View Details →
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
