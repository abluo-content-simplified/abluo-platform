'use client'

import Link from 'next/link'
import { PlayCircle } from 'lucide-react'
import { SlideUp, FadeIn } from '@/components/animation'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import type { Event, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'

interface LivePageContentProps {
  event: Event | null
  siteConfig: WebsiteSiteConfig | null
  locale: SupportedLocale
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

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Event['status'] }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        Live
      </span>
    )
  }
  if (status === 'upcoming') {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest"
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
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LivePageContent({ event, siteConfig, locale }: LivePageContentProps) {
  if (!event) return <NoLiveEvent />

  const heroSrc = imageUrl(event.heroImage, 1600)
  const heroSrcSet = imageSrcSet(event.heroImage, [800, 1200, 1600, 2400])
  const gallerySrc = event.gallery?.[0] ? imageUrl(event.gallery[0], 1600) : undefined
  const gallerySrcSet = event.gallery?.[0] ? imageSrcSet(event.gallery[0], [800, 1200, 1600]) : undefined

  // Format date range
  const startDate = event.startDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.startDate))
    : null
  const endDate = event.endDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.endDate))
    : null

  const channelUrl = event.youtubeChannelUrl ?? 'https://www.youtube.com/@livener-net'

  // Welcome text — from Sanity siteConfig, with fallbacks
  const headline = siteConfig?.livePageHeadline ?? 'Welcome to Livener'
  const subheadline = siteConfig?.livePageSubheadline ?? 'Live video streaming, in the palm of your hands'
  const betaNotice = siteConfig?.livePageBetaNotice ?? 'Currently in beta — tested live, in real environments.'

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        backgroundImage: 'url(/livener/bkg.svg)',
        backgroundPosition: '50% 0',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '121%',
      }}
    >
      <div className="mx-auto max-w-[900px] px-5 pb-24 pt-12 md:px-10">

        {/* ── Page welcome ─────────────────────────────────────────── */}
        <SlideUp duration={0.6}>
          <h1
            className="text-[clamp(48px,8vw,68px)] font-bold leading-[1.05]"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {headline}
          </h1>
        </SlideUp>

        <SlideUp delay={0.1} duration={0.6}>
          <h2
            className="mt-3 text-[clamp(22px,4vw,32px)] font-semibold leading-tight"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}
          >
            {subheadline}
          </h2>
        </SlideUp>

        <SlideUp delay={0.18} duration={0.5}>
          <p className="mt-4 text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {betaNotice}
          </p>
        </SlideUp>

        {/* ── Event announcement ────────────────────────────────────── */}
        <div className="mt-14">
          <SlideUp delay={0.05}>
            <div className="flex items-center gap-3">
              <StatusBadge status={event.status} />
            </div>
          </SlideUp>

          <SlideUp delay={0.12}>
            <h2
              className="mt-4 text-[clamp(28px,5vw,46px)] font-bold leading-tight"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
            >
              {event.title}
            </h2>
          </SlideUp>

          {(startDate || event.location) && (
            <SlideUp delay={0.2}>
              <p
                className="mt-2 text-xl font-semibold"
                style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}
              >
                {startDate && endDate
                  ? `${startDate} — ${endDate}`
                  : startDate}
                {event.location && (
                  <span style={{ color: 'var(--color-text-muted)' }} className="ml-2">
                    · {event.location}
                  </span>
                )}
              </p>
            </SlideUp>
          )}

          {/* ── Short description — ABOVE hero image ─────────────────── */}
          {event.shortDescription && (
            <SlideUp delay={0.25} className="mt-6">
              <p className="text-base leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {event.shortDescription}
              </p>
            </SlideUp>
          )}
        </div>

        {/* ── Hero image ───────────────────────────────────────────── */}
        {heroSrc && (
          <FadeIn delay={0.1} className="mt-10 overflow-hidden rounded-2xl">
            <img
              src={heroSrc}
              srcSet={heroSrcSet}
              sizes="(max-width: 900px) 100vw, 900px"
              alt={event.heroImage?.alt ?? event.title ?? ''}
              className="w-full object-cover"
              loading="eager"
            />
          </FadeIn>
        )}

        {/* ── Full description — BELOW hero image ──────────────────── */}
        {event.fullDescription && Array.isArray(event.fullDescription) && event.fullDescription.length > 0 && (
          <SlideUp delay={0.08} className="mt-10">
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

        {/* ── YouTube channel link ─────────────────────────────────── */}
        <SlideUp delay={0.1} className="mt-8">
          <p className="text-base leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Visit{' '}
            <Link
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--color-primary)' }}
            >
              {channelUrl.replace('https://', '')}
            </Link>{' '}
            to see the future of live streaming.
          </p>
        </SlideUp>

        {/* ── Watch on YouTube CTA ──────────────────────────────────── */}
        <SlideUp delay={0.15} className="mt-10">
          <Link
            href={event.youtubeUrl ?? channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 rounded-[var(--radius-btn)] px-6 py-3.5 text-sm font-semibold transition-all"
            style={{
              fontFamily: 'var(--font-body)',
              border: '2px solid var(--color-primary)',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.backgroundColor = 'var(--color-secondary)'
              el.style.borderColor = 'var(--color-secondary)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.backgroundColor = 'var(--color-primary)'
              el.style.borderColor = 'var(--color-primary)'
            }}
          >
            <PlayCircle size={18} />
            {event.ctaLabel ?? 'Watch on YouTube'}
          </Link>
        </SlideUp>

        {/* ── Gallery image ─────────────────────────────────────────── */}
        {gallerySrc && (
          <FadeIn delay={0.1} className="mt-14 overflow-hidden rounded-2xl">
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

      </div>
    </div>
  )
}
