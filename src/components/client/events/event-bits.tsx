'use client'

import { useTranslations } from 'next-intl'
import type { EventLifecycle } from '@/lib/api/event-drafts'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { shortMoment } from '@/components/app/lifecycle/publish-plan'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export const EVENT_ICONS = {
  back: svg('M15 18l-6-6 6-6'),
  plus: svg('M12 5v14M5 12h14'),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  pin: svg('M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  photo: svg('M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01'),
  list: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
  cards: svg('M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'),
}

/**
 * The event's PUBLICATION status as the shared lifecycle badge (ADR-032):
 * Draft · Scheduled (+ its date, in the site's zone, 24 h) · Published
 * (+ Pending changes) · Unpublished · Archived. Not the event's own status
 * (cancelled, postponed…), which is separate and shown on the website.
 */
export function EventLifecycleBadge({
  lifecycle,
  changes = lifecycle.hasChanges,
  zone,
  oneLine = false,
}: {
  lifecycle: Pick<EventLifecycle, 'status' | 'publishedAt'> & Partial<Pick<EventLifecycle, 'hasChanges'>>
  /** Show "Pending changes" (default: the lifecycle's own flag). */
  changes?: boolean
  /** The site's IANA time zone. */
  zone: string
  oneLine?: boolean
}) {
  const tp = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  if (lifecycle.status === 'scheduled' && lifecycle.publishedAt) {
    return <LifecycleBadge status="scheduled" extra={tp('moment', shortMoment(lifecycle.publishedAt, zone, dateLocale))} oneLine={oneLine} />
  }
  return <LifecycleBadge status={lifecycle.status} changes={changes && lifecycle.status !== 'archived'} oneLine={oneLine} />
}

/** "Sat 12 Apr 2026, 09:00 – Mon 14 Apr, 20:00" in the viewer's language and time zone. */
export function useEventDates() {
  const dateLocale = useDateLocale()
  return (start: string | null, end: string | null): string => {
    if (!start) return ''
    const s = new Date(start)
    if (Number.isNaN(s.getTime())) return ''
    const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    const full = new Intl.DateTimeFormat(dateLocale, { ...day, ...time })
    if (!end) return full.format(s)
    const e = new Date(end)
    if (Number.isNaN(e.getTime())) return full.format(s)
    const sameDay = s.toDateString() === e.toDateString()
    try {
      return sameDay
        ? `${full.format(s)} – ${new Intl.DateTimeFormat(dateLocale, time).format(e)}`
        : full.formatRange(s, e)
    } catch {
      return `${full.format(s)} – ${full.format(e)}`
    }
  }
}
