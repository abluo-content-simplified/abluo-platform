import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { isProduction, isDev } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import {
  eventBySlugQuery,
  eventByOldSlugQuery,
  eventsQuery,
  localeConfigQuery,
  designSystemQuery,
} from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import type { Event, LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { SlideUp } from '@/components/animation'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { EventCard } from '@/components/events/EventCard'
import { BackButton } from '@/components/events/BackButton'

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string }>
  searchParams?: Promise<{ from?: string }>
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: tenantId, locale, slug } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const supportedLocales: SupportedLocale[] = localeConfig?.supportedLocales ?? [defaultLocale]

  const event = await fetchForTenant<Event>(eventBySlugQuery, {
    slug,
    locale: locale as SupportedLocale,
    defaultLocale,
  })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // Build hreflang alternates from per-locale slugs in slugMap.
  const alternates: Record<string, string> = {}
  if (event?.slugMap) {
    for (const loc of supportedLocales) {
      const locSlug = event.slugMap[loc as SupportedLocale]?.current
      if (locSlug) {
        alternates[loc] = `${baseUrl}/${loc}/${tenantId}/events/${locSlug}`
      }
    }
  }

  return {
    title: event?.seoTitle ?? event?.title ?? 'Event',
    description: event?.seoDescription ?? event?.shortDescription ?? 'Event details',
    alternates: {
      canonical: isProduction() ? `${baseUrl}/${locale}/${tenantId}/events/${event?.slugMap?.[locale as SupportedLocale]?.current ?? ''}` : undefined,
      languages: !isDev() && Object.keys(alternates).length > 0 ? alternates : undefined,
    },
    openGraph: {
      title: event?.seoTitle ?? event?.title,
      description: event?.seoDescription ?? event?.shortDescription ?? undefined,
      images: event?.heroImage?.asset
        ? (() => {
            const url = imageUrl(event.heroImage, 1200)
            return url ? [url] : undefined
          })()
        : undefined,
    },
  }
}

// ─── Static Params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  return []
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EventDetailPage({ params, searchParams }: PageProps) {
  const { tenant: tenantId, locale, slug } = await params
  const resolvedSearch = await searchParams
  const from = resolvedSearch?.from
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // Fetch event and design system in parallel.
  const [event, designSystem, allEvents] = await Promise.all([
    fetchForTenant<Event>(eventBySlugQuery, { slug, locale: locale as SupportedLocale, defaultLocale }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<Event[]>(eventsQuery, { locale: locale as SupportedLocale, defaultLocale }),
  ])

  // Primary lookup missed — check if this slug was a redirect.
  if (!event) {
    const redirectResult = await fetchForTenant<{ currentSlug: string }>(
      eventByOldSlugQuery,
      { slug, locale: locale as SupportedLocale }
    )
    if (redirectResult?.currentSlug) {
      redirect(`/${locale}/${tenantId}/events/${redirectResult.currentSlug}`)
    }
    notFound()
  }

  // Build slug map for the language switcher.
  const slugMap: SlugMap = {}
  if (event.slugMap) {
    for (const [loc, slugObj] of Object.entries(event.slugMap)) {
      if (slugObj?.current) {
        slugMap[loc as SupportedLocale] = slugObj.current
      }
    }
  }

  // Related events — filter by resolved slug string.
  const relatedEvents = (allEvents ?? [])
    .filter(e => e.slug?.current !== slug)
    .slice(0, 3)

  const heroSrc = imageUrl(event.heroImage, 1600)
  const heroSrcSet = imageSrcSet(event.heroImage, [800, 1200, 1600, 2400])

  const startDate = event.startDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(event.startDate))
    : null
  const endDate = event.endDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(event.endDate))
    : null

  return (
    <SlugMapProvider slugMap={slugMap}>
      <div style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="mx-auto max-w-[900px] px-5 py-12 md:px-10">

          {/* ── Back button — returns to origin context ────────────── */}
          <SlideUp duration={0.5}>
            <BackButton
              fallbackUrl={
                from === 'events'
                  ? `/${locale}/${tenantId}/events`
                  : `/${locale}/${tenantId}/live`
              }
              label={from === 'events' ? 'Back to Events' : 'Back to Live'}
            />
          </SlideUp>

          {/* ── Hero image ────────────────────────────────────────── */}
          {heroSrc && (
            <SlideUp delay={0.05} duration={0.6}>
              <div className="mb-12 overflow-hidden rounded-xl">
                <img
                  src={heroSrc}
                  srcSet={heroSrcSet}
                  alt={event.heroImage?.alt ?? event.title}
                  className="w-full h-auto object-cover"
                  style={{ maxHeight: '500px', objectFit: 'cover' }}
                />
              </div>
            </SlideUp>
          )}

          {/* ── Title & metadata ──────────────────────────────────── */}
          <SlideUp delay={0.1} duration={0.6}>
            <h1
              className="text-[clamp(36px,7vw,56px)] font-bold leading-[1.05] mb-4"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
            >
              {event.title}
            </h1>
          </SlideUp>

          <SlideUp delay={0.15} duration={0.5}>
            <div className="flex flex-wrap items-center gap-4 mb-8 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {startDate && <div>📅 {startDate}{endDate && endDate !== startDate ? ` – ${endDate}` : ''}</div>}
              {event.location && <div>📍 {event.location}</div>}
            </div>
          </SlideUp>

          {/* ── Short description ────────────────────────────────── */}
          {event.shortDescription && (
            <SlideUp delay={0.2} duration={0.5}>
              <p className="text-lg font-medium mb-8" style={{ color: 'var(--color-text-primary)' }}>
                {event.shortDescription}
              </p>
            </SlideUp>
          )}

          {/* ── Full description ────────────────────────────────── */}
          {event.fullDescription && (
            <SlideUp delay={0.25} duration={0.5}>
              <div
                className="prose mb-12 max-w-none"
                style={{
                  '--tw-prose-body': 'var(--color-text-primary)',
                  '--tw-prose-headings': 'var(--color-text-primary)',
                } as React.CSSProperties}
              >
                {Array.isArray(event.fullDescription) && event.fullDescription.map((block: any, idx: number) => (
                  <div key={idx} className="mb-4" style={{ color: 'var(--color-text-primary)' }}>
                    {block._type === 'block' && block.children?.map((child: any, cidx: number) => (
                      <span key={cidx}>{child.text}</span>
                    ))}
                  </div>
                ))}
              </div>
            </SlideUp>
          )}

          {/* ── Schedule ──────────────────────────────────────────── */}
          {event.schedule && event.schedule.length > 0 && (
            <SlideUp delay={0.3} duration={0.5}>
              <div className="mb-12">
                <h2
                  className="text-2xl font-bold mb-6"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                >
                  Schedule
                </h2>
                <div className="space-y-4">
                  {event.schedule.map((item: any) => (
                    <div key={item._key} className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                      <div className="flex items-start gap-4">
                        <div className="font-semibold min-w-[80px]" style={{ color: 'var(--color-primary)' }}>
                          {item.time}
                        </div>
                        <div>
                          <div className="font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                            {item.title}
                          </div>
                          {item.description && (
                            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SlideUp>
          )}

          {/* ── Gallery ────────────────────────────────────────────── */}
          {event.gallery && event.gallery.length > 0 && (
            <SlideUp delay={0.35} duration={0.5}>
              <div className="mb-12">
                <h2
                  className="text-2xl font-bold mb-6"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                >
                  Gallery
                </h2>
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  {event.gallery.map((image: any, idx: number) => (
                    <div key={idx} className="overflow-hidden rounded-lg">
                      <img
                        src={imageUrl(image, 600)}
                        alt={image.alt ?? `Gallery image ${idx + 1}`}
                        className="w-full h-auto object-cover"
                        style={{ maxHeight: '300px', objectFit: 'cover' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </SlideUp>
          )}

          {/* ── YouTube ────────────────────────────────────────────── */}
          {event.youtubeUrl && (
            <SlideUp delay={0.4} duration={0.5}>
              <div className="mb-12">
                <h2
                  className="text-2xl font-bold mb-6"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                >
                  Watch
                </h2>
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  <iframe
                    src={event.youtubeUrl.replace(/watch\?v=/, 'embed/')}
                    title={event.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </SlideUp>
          )}

          {/* ── Related events ────────────────────────────────────── */}
          {relatedEvents.length > 0 && (
            <SlideUp delay={0.45} duration={0.5}>
              <div className="mb-12">
                <h2
                  className="text-2xl font-bold mb-6"
                  style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
                >
                  Related Events
                </h2>
                <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
                  {relatedEvents.map((relEvent: Event, idx: number) => (
                    <EventCard
                      key={relEvent._id ?? relEvent.slug.current}
                      event={relEvent}
                      locale={locale}
                      tenantId={tenantId}
                      delay={0.05 + idx * 0.06}
                      from={from === 'live' ? 'live' : 'events'}
                    />
                  ))}
                </div>
              </div>
            </SlideUp>
          )}
        </div>
      </div>
    </SlugMapProvider>
  )
}
