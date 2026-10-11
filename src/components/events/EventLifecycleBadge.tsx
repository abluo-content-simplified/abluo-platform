import type { Event } from '@/lib/sanity/types'
import { getEventMessages } from '@/lib/i18n/event-messages'

/**
 * ADR-031 — an authored cancelled / postponed / sold-out status. It is the one
 * thing a visitor must not miss, so it uses the brand colour, not a muted chip.
 * Renders nothing for a scheduled event (or an event authored before ADR-031).
 *
 *   overlay — pinned on the top-left of a card image
 *   inline  — in the text flow (mini cards, detail page)
 */
export function EventLifecycleBadge({
  status,
  locale,
  variant = 'inline',
  className = '',
}: {
  status: Event['eventStatus']
  locale: string
  variant?: 'overlay' | 'inline'
  className?: string
}) {
  if (!status || status === 'scheduled') return null
  const msg = getEventMessages(locale)
  const label = status === 'cancelled' ? msg.statusCancelled : status === 'postponed' ? msg.statusPostponed : msg.statusSoldOut
  return (
    <span
      className={`${variant === 'overlay' ? 'absolute left-3 top-3 z-10 shadow-md' : 'inline-flex'} items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${className}`}
      style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
    >
      {label}
    </span>
  )
}
