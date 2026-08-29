'use client'

import Link from 'next/link'
import { PlayCircle, ArrowRight } from 'lucide-react'
import { SlideUp, FadeIn } from '@/components/animation'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { getEventMessages } from '@/lib/i18n/event-messages'
import type { Event, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { resolveEasing } from '@/lib/motion/easing'

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, liveLabel, upcomingLabel }: {
  status: Event['status']
  liveLabel: string
  upcomingLabel: string
}) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        {liveLabel}
      </span>
    )
  }
  if (status === 'upcoming') {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] border px-3 py-1 text-xs font-semibold uppercase tracking-widest"
        style={{
          borderColor: 'color-mix(in oklch, var(--color-primary) 25%, transparent)',
          backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
          color: 'var(--color-primary)',
        }}
      >
        {upcomingLabel}
      </span>
    )
  }
  return null
}

// ─── StreamCta ────────────────────────────────────────────────────────────────

function StreamCta({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
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
      {label}
    </Link>
  )
}

// ─── FeaturedEventBlock ───────────────────────────────────────────────────────
// Renders the event hero — status, title, date, image, stream CTAs, event link.
// Used on both the /live page and the homepage featured event section.

interface FeaturedEventBlockProps {
  event: Event
  designSystem: DesignSystem | null
  locale: SupportedLocale
  tenantId: string
}

export function FeaturedEventBlock({ event, designSystem, locale, tenantId }: FeaturedEventBlockProps) {
  const m = designSystem?.motion
  const durationSlow = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const easeReveal = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const msg = getEventMessages(locale)

  const heroSrc    = imageUrl(event.heroImage, 1600)
  const heroSrcSet = imageSrcSet(event.heroImage, [800, 1200, 1600, 2400])

  const startDate = event.startDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.startDate))
    : null
  const endDate = event.endDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(event.endDate))
    : null

  const eventHref = `/${locale}/${tenantId}/events/${event.slug.current}`

  // Resolve streaming CTAs from new fields, with fallback to deprecated fields
  const primaryLabel = event.primaryStreamLabel ?? event.ctaLabel ?? null
  const primaryUrl   = event.primaryStreamUrl ?? event.youtubeUrl ?? null
  const secondaryLabel = event.secondaryStreamLabel ?? null
  const secondaryUrl   = event.secondaryStreamUrl ?? null

  return (
    <div>
      {/* ── Status + title ────────────────────────────────────────── */}
      <SlideUp delay={0.05} ease={easeReveal}>
        <div className="flex items-center gap-3">
          <StatusBadge status={event.status} liveLabel={msg.statusLive} upcomingLabel={msg.statusUpcoming} />
        </div>
      </SlideUp>

      <SlideUp delay={0.12} ease={easeReveal}>
        <h2
          className="mt-4 text-[clamp(28px,5vw,46px)] font-bold leading-tight"
          style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
        >
          {event.title}
        </h2>
      </SlideUp>

      {/* ── Date + location ─────────────────────────────────────────── */}
      {(startDate || event.location) && (
        <SlideUp delay={0.2} ease={easeReveal}>
          <p
            className="mt-2 text-xl font-semibold"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}
          >
            {startDate && endDate ? `${startDate} — ${endDate}` : startDate}
            {event.location && (
              <span style={{ color: 'var(--color-text-muted)' }} className="ml-2">
                · {event.location}
              </span>
            )}
          </p>
        </SlideUp>
      )}

      {/* ── Short description ───────────────────────────────────────── */}
      {event.shortDescription && (
        <SlideUp delay={0.25} ease={easeReveal} className="mt-6">
          <p className="text-base leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {event.shortDescription}
          </p>
        </SlideUp>
      )}

      {/* ── Hero image ──────────────────────────────────────────────── */}
      {heroSrc && (
        <FadeIn delay={0.1} duration={durationSlow} ease={easeReveal} className="mt-10 overflow-hidden rounded-[var(--radius-lg)]">
          <Link href={eventHref}>
            <img
              src={heroSrc}
              srcSet={heroSrcSet}
              sizes="(max-width: 900px) 100vw, 900px"
              alt={event.heroImage?.alt ?? event.title ?? ''}
              className="w-full object-cover hover:opacity-90 transition-opacity"
              loading="eager"
            />
          </Link>
        </FadeIn>
      )}

      {/* ── CTAs ────────────────────────────────────────────────────── */}
      <SlideUp delay={0.15} ease={easeReveal} className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          {/* Primary stream CTA */}
          {primaryLabel && primaryUrl && (
            <StreamCta label={primaryLabel} href={primaryUrl} />
          )}

          {/* Secondary stream CTA */}
          {secondaryLabel && secondaryUrl && (
            <StreamCta label={secondaryLabel} href={secondaryUrl} />
          )}

          {/* View Event Details — always present */}
          <Link
            href={eventHref}
            className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] px-6 py-3.5 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{
              fontFamily: 'var(--font-body)',
              color: 'var(--color-text-primary)',
              border: '2px solid color-mix(in oklch, var(--color-text-primary) 20%, transparent)',
            }}
          >
            {msg.viewEventDetails}
            <ArrowRight size={16} />
          </Link>
        </div>
      </SlideUp>
    </div>
  )
}
