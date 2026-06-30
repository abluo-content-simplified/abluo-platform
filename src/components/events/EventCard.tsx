'use client'

import Link from 'next/link'
import { SlideUp } from '@/components/animation'
import { imageUrl } from '@/lib/sanity/image'
import type { Event } from '@/lib/sanity/types'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'

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

// ─── Event card ───────────────────────────────────────────────────────────────

interface EventCardProps {
  event: Event
  locale: string
  tenantId: string
  /** Stagger delay in seconds */
  delay?: number
  /** Animation duration in seconds */
  duration?: number
  /** Easing — CSS cubic-bezier string or [x1,y1,x2,y2] array */
  ease?: string | number[]
  /**
   * Origin context — appended as `?from=<value>` so the Event Detail page
   * can route the back button correctly.
   * e.g. "events" | "live"
   */
  from?: string
}

/**
 * EventCard — standardized card used in every event listing context.
 *
 * Layout guarantees:
 *  - Fixed 200px image height, object-cover — every card has the same image area
 *  - Title clamped to 2 lines
 *  - Description clamped to 3 lines
 *  - CTA always pinned to the bottom via mt-auto
 *  - h-full on both the SlideUp wrapper and the Link so CSS Grid row
 *    equalisation works correctly
 *
 * Motion tokens (duration, ease) are passed in from the parent page so that
 * every card respects the tenant's design system timing.
 */
export function EventCard({
  event,
  locale,
  tenantId,
  delay = 0,
  duration = 0.6,
  ease = [0.0, 0.0, 0.2, 1],
  from,
}: EventCardProps) {
  const heroSrc = imageUrl(event.heroImage, 600)

  const startDate = event.startDate
    ? new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date(event.startDate))
    : null

  const href = from
    ? `/${locale}/${tenantId}/events/${event.slug.current}?from=${from}`
    : `/${locale}/${tenantId}/events/${event.slug.current}`

  return (
    <SlideUp delay={delay} duration={duration} ease={ease} className="h-full">
      <Link
        href={href}
        className="group flex h-full flex-col overflow-hidden rounded-2xl transition-all hover:shadow-xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Image — fixed height, object-cover on every card */}
        <div className="shrink-0 overflow-hidden" style={{ height: '200px' }}>
          {heroSrc ? (
            <img
              src={heroSrc}
              alt={event.heroImage?.alt ?? event.title ?? ''}
              className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
          )}
        </div>

        {/* Content — flex column so mt-auto on CTA pins it to the bottom */}
        <div className="flex flex-1 flex-col p-5">
          {/* Status badge */}
          <div className="mb-3">
            <StatusBadge status={event.status} />
          </div>

          {/* Title — max 2 lines */}
          <h2
            className="mb-2 line-clamp-2 text-base font-semibold leading-snug transition-opacity group-hover:opacity-75"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
          >
            {event.title}
          </h2>

          {/* Date + location */}
          {(startDate || event.location) && (
            <div
              className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {startDate && <span>{startDate}</span>}
              {event.location && <span>{event.location}</span>}
            </div>
          )}

          {/* Description — max 3 lines */}
          <p
            className="line-clamp-3 overflow-hidden text-sm"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {event.shortDescription ?? ''}
          </p>

          {/* CTA — mt-auto pins to bottom regardless of content height */}
          <div
            className="mt-auto pt-4"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
              View Details →
            </span>
          </div>
        </div>
      </Link>
    </SlideUp>
  )
}
