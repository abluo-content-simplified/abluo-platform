'use client'

import { useContext, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import type { TestimonialListItem } from '@/lib/api/testimonials'
import type { FilterableTestimonial, TestimonialListState } from '@/lib/client/testimonials-filter'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { DisplayTimeZoneContext, Pill } from '@/components/app/ui/list/cells'

/**
 * Shared bits of the Testimonials screens (ADR-048 D9): the list row type, the
 * status badge, the "Missing …" language marker, the rating, language names,
 * input limits and icons.
 */

/** One row of the Testimonials list (table, cards, phone rows). */
export type TestimonialRow = FilterableTestimonial & {
  publicId: string
  /** The excerpt shown under the name. */
  excerpt: string
  anonymous: boolean
  /** The real name behind it — only for people who may see it (testimonials.private.read). */
  privateName: string | null
  featured: boolean
  permissionToPublish: boolean
  /** Site languages the full text is missing in. */
  missingLocales: string[]
  isPublished: boolean
  hasDraft: boolean
  createdAt: string
  /** The testimonial's editor (read-only without testimonials.write). */
  href: string
}

/**
 * Input limits, mirroring TESTIMONIAL_LIMITS in src/lib/modules/testimonials/model.ts
 * (the server enforces them; the browser only stops typing past them). Kept here so the
 * client bundle never imports server code.
 */
export const TESTIMONIAL_UI_LIMITS = { displayName: 120, context: 200, abstract: 600, body: 5000, sourceUrl: 500, age: 120, fullName: 200, email: 320, phone: 60, note: 5000 } as const

export function stateOf(item: Pick<TestimonialListItem, 'status' | 'hasChanges'>): TestimonialListState {
  return item.status === 'published' && item.hasChanges ? 'changes' : item.status
}

export function toTestimonialRow(
  item: TestimonialListItem,
  projectSlug: string,
  labels: { anonymous: string; untitled: string },
  languages: string[],
  privateName: string | null
): TestimonialRow {
  return {
    id: item.id,
    publicId: item.publicId,
    name: item.displayName || (item.anonymous ? labels.anonymous : labels.untitled),
    excerpt: item.excerpt,
    anonymous: item.anonymous,
    privateName,
    searchText: `${item.searchText} ${(privateName ?? '').toLowerCase()}`,
    state: stateOf(item),
    rating: item.rating,
    featured: item.featured,
    permissionToPublish: item.permissionToPublish,
    missingLocales: item.bodyLocales.length ? languages.filter((l) => !item.bodyLocales.includes(l)) : [],
    isPublished: item.isPublished,
    hasDraft: item.hasDraft,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    href: `/${projectSlug}/testimonials/${item.id}`,
  }
}

/** The testimonial's status as the shared lifecycle badge: Draft · Published (+ Pending changes) · Unpublished · Archived. */
export function TestimonialStateBadge({ state, oneLine = false }: { state: TestimonialListState; oneLine?: boolean }) {
  if (state === 'changes') return <LifecycleBadge status="published" changes oneLine={oneLine} />
  return <LifecycleBadge status={state} oneLine={oneLine} />
}

/** "Missing DE, FR" when the text lacks a site language; nothing when complete. */
export function MissingLanguages({ locales }: { locales: string[] }) {
  const t = useTranslations('clientDashboard.testimonials.list')
  if (!locales.length) return null
  return <Pill tone="highlight">{t('missing', { languages: locales.map((l) => l.toUpperCase()).join(', ') })}</Pill>
}

/** "★ 4" with a full sentence for screen readers; "—" when there is no rating. */
export function RatingValue({ rating, empty = '—' }: { rating: number | null; empty?: string }) {
  const t = useTranslations('clientDashboard.testimonials.list')
  if (rating === null) return <span className="text-sm leading-6 text-muted-foreground">{empty}</span>
  return (
    <span className="inline-flex items-center gap-1 text-sm leading-6 text-foreground tabular-nums" role="img" aria-label={t('ratingLabel', { rating })}>
      <span aria-hidden="true" className="text-muted-foreground">
        {ICONS.star}
      </span>
      <span aria-hidden="true">{rating}</span>
    </span>
  )
}

/** Language name in the dashboard's language ("German"), falling back to the code. */
export function useLanguageName() {
  const ui = useLocale()
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([ui], { type: 'language' })
  } catch {
    names = null
  }
  return (code: string) => {
    try {
      return names?.of(code) ?? code.toUpperCase()
    } catch {
      return code.toUpperCase()
    }
  }
}

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  star: svg('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z', 14, 1.8),
  quote: svg('M7 7h4v4c0 3-2 5-4 5M15 7h4v4c0 3-2 5-4 5', 16, 2),
  lock: svg('M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', 18, 2),
}

/**
 * "6 Oct 2026, 14:30" — date and 24-hour time in the project's time zone (the
 * list screens provide it through DisplayTimeZoneContext), in the viewer's
 * language. Empty text for a missing or unreadable date.
 */
export function useDateTime() {
  const dateLocale = useDateLocale()
  const timeZone = useContext(DisplayTimeZoneContext) ?? undefined
  const fmt = useMemo(() => {
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    try {
      return new Intl.DateTimeFormat(dateLocale, { ...options, timeZone })
    } catch {
      return new Intl.DateTimeFormat(dateLocale, options)
    }
  }, [dateLocale, timeZone])
  return (iso: string | null | undefined): string => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : fmt.format(d)
  }
}
