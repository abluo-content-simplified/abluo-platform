// ── Event registration / prices / hosts — presentational pieces ───────────────
//
// Shared by the event detail page and every event card (EventCard,
// EventsListingSection). No hooks, no 'use client' — safe to render from both
// server and client components. All user-facing chrome comes from
// getEventMessages(locale); content strings come resolved from GROQ.

import type { Event } from '@/lib/sanity/types'
import { getEventMessages } from '@/lib/i18n/event-messages'
import {
  formatPrice,
  priceSummary,
  resolveEventLink,
  validPriceOptions,
  visibleHosts,
} from '@/lib/modules/events/engagement'

const EXTERNAL_PROPS = { target: '_blank', rel: 'noopener noreferrer' } as const

// ─── Hosts ────────────────────────────────────────────────────────────────────

/**
 * "Hosted by Anna, Marco". With `linked`, names whose host carries a url
 * become links (use on the detail page). Cards pass `linked={false}` because
 * the whole card is already a link.
 */
export function EventHostsLine({
  hosts,
  locale,
  tenantId,
  linked = true,
  className,
}: {
  hosts: Event['hosts']
  locale: string
  tenantId: string
  linked?: boolean
  className?: string
}) {
  const list = visibleHosts(hosts)
  if (list.length === 0) return null
  const msg = getEventMessages(locale)

  return (
    <p className={className} style={{ color: 'var(--color-text-secondary)' }}>
      <span>{msg.hostedBy} </span>
      {list.map((host, i) => {
        const link = linked ? resolveEventLink(host.url, locale, tenantId) : null
        const name = link ? (
          <a
            href={link.href}
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: 'var(--color-primary)' }}
            {...(link.external ? EXTERNAL_PROPS : {})}
          >
            {host.name}
          </a>
        ) : (
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {host.name}
          </span>
        )
        return (
          <span key={host._key ?? `${host.name}-${i}`}>
            {i > 0 && ', '}
            {name}
            {linked && host.role && (
              <span style={{ color: 'var(--color-text-muted)' }}> ({host.role})</span>
            )}
          </span>
        )
      })}
    </p>
  )
}

// ─── Registration button (detail page) ────────────────────────────────────────

export function EventRegisterButton({
  event,
  locale,
  tenantId,
}: {
  event: Pick<Event, 'registrationUrl' | 'registrationLabel'>
  locale: string
  tenantId: string
}) {
  const link = resolveEventLink(event.registrationUrl, locale, tenantId)
  if (!link) return null
  const msg = getEventMessages(locale)
  return (
    <a
      href={link.href}
      className="inline-flex items-center gap-2 px-7 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
      style={{
        backgroundColor: 'var(--btn-primary-bg, var(--color-primary))',
        color: 'var(--btn-primary-text, var(--color-background))',
        borderRadius: 'var(--radius-btn)',
        fontFamily: 'var(--font-body)',
      }}
      {...(link.external ? EXTERNAL_PROPS : {})}
    >
      {event.registrationLabel || msg.registerFallback}
    </a>
  )
}

// ─── Price list (detail page) ─────────────────────────────────────────────────

export function EventPriceList({ options, locale }: { options: Event['priceOptions']; locale: string }) {
  const list = validPriceOptions(options)
  if (list.length === 0) return null
  const msg = getEventMessages(locale)
  return (
    <div>
      <h2
        className="mb-3 text-sm font-semibold uppercase tracking-widest"
        style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}
      >
        {msg.pricesHeading}
      </h2>
      <ul
        className="divide-y rounded-[var(--radius-lg)]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {list.map((o, i) => (
          <li
            key={o._key ?? i}
            className="flex items-baseline justify-between gap-4 px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="min-w-0">
              {o.label && (
                <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {o.label}
                </div>
              )}
              {o.note && (
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {o.note}
                </div>
              )}
            </div>
            <div className="shrink-0 text-base font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {formatPrice(o.amount, o.currency, locale)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Card extras (listing cards) ──────────────────────────────────────────────

/**
 * Hosts + compact price + registration link for listing cards. The card's
 * main link must be a "stretched" link (an ::after overlay) so this row's
 * registration link can sit above it (relative z-10) without nesting <a>s.
 */
export function EventCardExtras({
  event,
  locale,
  tenantId,
  size = 'sm',
  className = '',
}: {
  event: Event
  locale: string
  tenantId: string
  size?: 'sm' | 'base'
  /** Spacing classes for the wrapper — nothing renders when there is nothing to show. */
  className?: string
}) {
  const msg = getEventMessages(locale)
  const price = priceSummary(event.priceOptions, locale, msg.priceFrom)
  const register = resolveEventLink(event.registrationUrl, locale, tenantId)
  const hasHosts = visibleHosts(event.hosts).length > 0
  if (!price && !register && !hasHosts) return null
  const textSize = size === 'base' ? 'text-sm' : 'text-xs'

  return (
    <div className={`flex flex-col gap-2 ${textSize} ${className}`}>
      <EventHostsLine hosts={event.hosts} locale={locale} tenantId={tenantId} linked={false} className="line-clamp-2" />
      {(price || register) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {price && (
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {price}
            </span>
          )}
          {register && (
            <a
              href={register.href}
              className="relative z-10 font-semibold underline-offset-4 hover:underline"
              style={{ color: 'var(--color-primary)' }}
              {...(register.external ? EXTERNAL_PROPS : {})}
            >
              {event.registrationLabel || msg.registerFallback} →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
