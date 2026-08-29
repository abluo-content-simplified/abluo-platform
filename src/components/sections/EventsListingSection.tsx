// ─── Events Listing Section ────────────────────────────────────────────────
// ADR-016 Phase B — modeled directly on BlogListingSection.tsx. Renders the
// hydrated `events` (attached by hydrateSections in SectionRenderer.tsx) in
// the chosen layout. Owned by the Events module — registered via
// src/lib/modules/events/sections.tsx into SECTION_MAP.

import type { EventsListingSection as EventsListingSectionType, Event, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { SectionEmptyState } from '@/components/sections/shared/SectionEmptyState'
import { imageUrl } from '@/lib/sanity/image'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'
import { resolveEasing } from '@/lib/motion/easing'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

// ─── Date formatting — locale-aware (mirrors EventCard/FeaturedEventBlock) ────

function formatEventDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

function formatEventDateRange(startDate: string, endDate: string | undefined, locale: string): string {
  const start = formatEventDate(startDate, locale)
  if (!endDate) return start
  const end = formatEventDate(endDate, locale)
  return start === end ? start : `${start} – ${end}`
}

// ─── Category chips ───────────────────────────────────────────────────────────

function CategoryChips({ categories }: { categories?: Event['categories'] }) {
  if (!categories?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {categories.map((cat) => (
        <span
          key={cat._id}
          className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-btn)] text-[10px] font-semibold uppercase tracking-widest"
          style={{
            background: cat.color
              ? `color-mix(in oklch, ${cat.color} 12%, transparent)`
              : 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
            color: cat.color ?? 'var(--color-primary)',
          }}
        >
          {cat.title}
        </span>
      ))}
    </div>
  )
}

// ─── Event meta (date + location) ─────────────────────────────────────────────

function EventMeta({ event, locale, size = 'sm' }: { event: Event; locale: string; size?: 'sm' | 'base' }) {
  const textSize = size === 'base' ? 'text-sm' : 'text-xs'
  if (!event.startDate && !event.location) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${textSize}`} style={{ color: 'var(--color-text-muted)' }}>
      {event.startDate && <span>{formatEventDateRange(event.startDate, event.endDate, locale)}</span>}
      {event.startDate && event.location && <span aria-hidden="true">·</span>}
      {event.location && <span>{event.location}</span>}
    </div>
  )
}

// ─── Event Card — Standard (used in Grid layout) ──────────────────────────────

function EventListingCard({ event, href, locale, priority = false }: { event: Event; href: string; locale: string; priority?: boolean }) {
  const coverSrc = imageUrl(event.heroImage, 800)

  return (
    <a
      href={href}
      className="group flex flex-col h-full overflow-hidden rounded-[var(--radius-lg)] transition-shadow hover:shadow-lg"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      <div className="shrink-0 overflow-hidden" style={{ height: '200px' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={event.heroImage?.alt ?? event.title ?? ''}
            className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading={priority ? 'eager' : 'lazy'}
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      <div className="flex flex-col flex-1 p-5">
        <CategoryChips categories={event.categories} />
        <h3
          className="text-base font-semibold leading-snug tracking-tight mb-2 line-clamp-2"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {event.title}
        </h3>
        {event.shortDescription && (
          <p
            className="text-sm leading-relaxed line-clamp-3 flex-1 mb-4"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {event.shortDescription}
          </p>
        )}
        <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <EventMeta event={event} locale={locale} />
        </div>
      </div>
    </a>
  )
}

// ─── Event Card — Large (Featured layout + Magazine main card) ────────────────

function EventListingCardLarge({ event, href, locale }: { event: Event; href: string; locale: string }) {
  const coverSrc = imageUrl(event.heroImage, 1200)

  return (
    <a
      href={href}
      className="group flex flex-col h-full overflow-hidden rounded-[var(--radius-lg)] transition-shadow hover:shadow-lg"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      <div className="relative shrink-0 overflow-hidden" style={{ paddingTop: '56.25%' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={event.heroImage?.alt ?? event.title ?? ''}
            className={`absolute inset-0 h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading="eager"
          />
        ) : (
          <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      <div className="flex flex-col flex-1 p-6 md:p-8">
        <CategoryChips categories={event.categories} />
        <h3
          className="mb-3 line-clamp-3 [--fs-h3:1.5rem] md:[--fs-h3:1.875rem]"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h3, var(--fs-h3))', fontWeight: 'var(--font-weight-h3, 600)', lineHeight: 'var(--line-height-h3, 1.375)', letterSpacing: 'var(--letter-spacing-h3, -0.025em)' }}
        >
          {event.title}
        </h3>
        {event.shortDescription && (
          <p
            className="text-base leading-relaxed line-clamp-3 flex-1 mb-6"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {event.shortDescription}
          </p>
        )}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <EventMeta event={event} locale={locale} size="base" />
        </div>
      </div>
    </a>
  )
}

// ─── Event Card — Mini (Magazine right column) ────────────────────────────────

function EventListingCardMini({ event, href, locale }: { event: Event; href: string; locale: string }) {
  const coverSrc = imageUrl(event.heroImage, 240)

  return (
    <a
      href={href}
      className="group flex gap-4 p-4 rounded-[var(--radius-md)] overflow-hidden transition-shadow hover:shadow-md"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid',
        borderColor: 'var(--color-border)',
        textDecoration: 'none',
      }}
    >
      <div className="shrink-0 overflow-hidden rounded-[var(--radius-md)]" style={{ width: '80px', height: '80px' }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={event.heroImage?.alt ?? event.title ?? ''}
            className={`h-full w-full object-cover ${IMAGE_HOVER_CLASSES}`}
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: 'var(--color-border)' }} />
        )}
      </div>

      <div className="flex flex-col justify-center min-w-0 gap-1">
        {event.categories?.[0] && (
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            {event.categories[0].title}
          </span>
        )}
        <h4
          className="text-sm font-semibold leading-snug line-clamp-2"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {event.title}
        </h4>
        <EventMeta event={event} locale={locale} />
      </div>
    </a>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eventHref(eventsBase: string, slug: string, fromParam?: string): string {
  const base = `${eventsBase}/${slug}`
  return fromParam ? `${base}?from=${fromParam}` : base
}

// ─── Grid Layout ──────────────────────────────────────────────────────────────

function GridLayout({
  events,
  eventsBase,
  locale,
  fromParam,
  duration,
  ease,
}: {
  events: Event[]
  eventsBase: string
  locale: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const count = events.length
  const gridCols =
    count === 1
      ? 'grid-cols-1 max-w-xl mx-auto w-full'
      : count === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className={`grid gap-6 ${gridCols}`}>
      {events.map((event, i) => (
        <SlideUp key={event._id} duration={duration} ease={ease} delay={i * 0.08} className="h-full">
          <EventListingCard event={event} href={eventHref(eventsBase, event.slug.current, fromParam)} locale={locale} priority={i === 0} />
        </SlideUp>
      ))}
    </div>
  )
}

// ─── Featured Layout ─────────────────────────────────────────────────────────

function FeaturedLayout({
  events,
  eventsBase,
  locale,
  fromParam,
  duration,
  ease,
}: {
  events: Event[]
  eventsBase: string
  locale: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const [first, ...rest] = events
  if (!first) return null

  return (
    <div className="flex flex-col gap-6">
      <SlideUp duration={duration} ease={ease} delay={0}>
        <EventListingCardLarge event={first} href={eventHref(eventsBase, first.slug.current, fromParam)} locale={locale} />
      </SlideUp>

      {rest.length > 0 && (
        <div
          className={`grid gap-6 ${
            rest.length === 1
              ? 'grid-cols-1 max-w-xl'
              : rest.length === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {rest.map((event, i) => (
            <SlideUp key={event._id} duration={duration} ease={ease} delay={0.1 + i * 0.08} className="h-full">
              <EventListingCard event={event} href={eventHref(eventsBase, event.slug.current, fromParam)} locale={locale} />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Magazine Layout ──────────────────────────────────────────────────────────

function MagazineLayout({
  events,
  eventsBase,
  locale,
  fromParam,
  duration,
  ease,
}: {
  events: Event[]
  eventsBase: string
  locale: string
  fromParam?: string
  duration: number
  ease: string | number[]
}) {
  const [first, ...rest] = events
  if (!first) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <SlideUp duration={duration} ease={ease} delay={0} className="lg:col-span-3 h-full">
        <EventListingCardLarge event={first} href={eventHref(eventsBase, first.slug.current, fromParam)} locale={locale} />
      </SlideUp>

      {rest.length > 0 && (
        <div className="lg:col-span-2 flex flex-col gap-4">
          {rest.map((event, i) => (
            <SlideUp key={event._id} duration={duration} ease={ease} delay={0.12 + i * 0.1}>
              <EventListingCardMini event={event} href={eventHref(eventsBase, event.slug.current, fromParam)} locale={locale} />
            </SlideUp>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  section: EventsListingSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantId: string
  /** When set, appended as ?from=${fromParam} to every card link. */
  fromParam?: string
}

export function EventsListingSection({ section, surface, designSystem, locale, tenantId, fromParam }: Props) {
  const {
    eyebrow,
    title,
    subtitle,
    layout = 'grid',
    viewAllLabel,
    viewAllHref,
    emptyStateHeading,
    emptyStateBody,
  } = section

  const events = section.events ?? []
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Base URL for event detail links: /[locale]/[tenant]/events
  const eventsBase = `/${locale}/${tenantId}/events`

  // Motion tokens — durationSlow for content sections
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  // ADR-016 Phase B — empty-state semantics (identical across all three
  // listing sections): zero events + no emptyStateHeading → render nothing.
  // Zero events + emptyStateHeading set → render the localized empty block.
  if (events.length === 0) {
    if (!emptyStateHeading) return null
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <SectionEmptyState heading={emptyStateHeading} body={emptyStateBody} duration={duration} ease={ease} />
      </SectionContainer>
    )
  }

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {(eyebrow || title || subtitle) && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12">
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              className="mb-4"
            />
          )}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p
              className="mt-3 text-base leading-relaxed max-w-2xl"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {subtitle}
            </p>
          )}
        </SlideUp>
      )}

      {layout === 'featured' ? (
        <FeaturedLayout events={events} eventsBase={eventsBase} locale={locale} fromParam={fromParam} duration={duration} ease={ease} />
      ) : layout === 'magazine' ? (
        <MagazineLayout events={events} eventsBase={eventsBase} locale={locale} fromParam={fromParam} duration={duration} ease={ease} />
      ) : (
        <GridLayout events={events} eventsBase={eventsBase} locale={locale} fromParam={fromParam} duration={duration} ease={ease} />
      )}

      {viewAllLabel && viewAllHref && (
        <SlideUp duration={duration} ease={ease} delay={0.25} className="mt-12 flex justify-center">
          <a
            href={viewAllHref}
            className="inline-flex items-center gap-2 px-7 py-3 rounded-[var(--radius-btn)] text-sm font-medium border transition-opacity hover:opacity-75"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            {viewAllLabel}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              style={{ opacity: 0.5 }}
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </SlideUp>
      )}
    </SectionContainer>
  )
}
