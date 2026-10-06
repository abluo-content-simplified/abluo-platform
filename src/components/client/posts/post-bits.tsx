'use client'

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { Link } from '@/i18n/navigation'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from '@/components/client/ui/anchored-popover'
import { CellIcon, CellIconButton, CellStack, Chips, LocalDate, MediaFrame, Pill, useShortDate } from '@/components/client/ui/list/cells'
import { OVERLAY_CHIP } from '@/components/client/ui/list/overlay-chip'
import type { PostStatus } from '@/lib/client/posts-filter'
import type { LanguageState } from './types'

/**
 * Small Posts-specific pieces for the list (table, desktop cards, phone
 * cards): status pill, language ticks and the featured star, built on the
 * generic primitives in `ui/list/cells`.
 */

export { LocalDate, useShortDate }

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z'

export const ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  cards: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  image: svg('M3 3h18v18H3zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21', 20, 1.5),
  clock: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', 14),
  tick: svg('M20 6 9 17l-5-5', 14, 2.6),
  warn: svg('M12 4 2.5 20h19zM12 10v4M12 17h.01', 14, 2),
  offline: svg('M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M12 20h.01'),
  online: svg('M5 12.9a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01M2 9.3a15 15 0 0 1 20 0'),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  more: svg('M5 12h.01M12 12h.01M19 12h.01', 20, 2.6),
  tag: svg('M3 12V4h8l10 10-8 8zM7.5 8.5h.01'),
  x: svg('M6 6l12 12M18 6L6 18'),
  star: svg(STAR, 20, 1.8),
  starSmall: svg(STAR, 16, 2),
  starOff: svg(`${STAR}M4 4l16 16`, 20, 1.8),
  chevron: svg('m6 9 6 6 6-6', 14, 2.2),
}

export function StarGlyph({ on, size = 20, stroke = 1.8 }: { on: boolean; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" aria-hidden="true">
      <path d={STAR} />
    </svg>
  )
}

/** "+ New post": the primary action in the page header. */
export function NewPostLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {ICONS.plus}
      {label}
    </Link>
  )
}

const TONE = { published: 'success', scheduled: 'highlight', draft: 'outline', offline: 'muted' } as const

/**
 * Live / Scheduled / Draft / Offline, plus "Unpublished changes" when a draft
 * exists. 1.5rem pills. `oneLine`: never wraps (the badge truncates).
 */
export function StatusPill({ status, badge, oneLine = false }: { status: PostStatus; badge?: string | null; oneLine?: boolean }) {
  const t = useTranslations('clientDashboard.posts.pill')
  return (
    <span className={`flex items-start gap-1.5 ${oneLine ? 'min-w-0 flex-nowrap overflow-hidden' : 'flex-wrap'}`}>
      <Pill
        tone={TONE[status]}
        icon={status === 'published' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : status === 'scheduled' ? ICONS.clock : undefined}
      >
        {t(status)}
      </Pill>
      {badge ? (
        <span
          title={badge}
          className={`h-6 rounded-full border border-border px-2.5 text-xs leading-[1.375rem] font-medium whitespace-nowrap text-foreground ${oneLine ? 'block min-w-0 truncate' : 'inline-flex shrink-0 items-center'}`}
        >
          {badge}
        </span>
      ) : null}
    </span>
  )
}

/**
 * "EN ✓  IT ⚠" — one entry per site language, each on a 1.5rem line: stacked
 * (table) or inline (cards); `oneLine`: inline and never wrapping.
 */
export function LanguageTicks({ states, stacked = false, oneLine = false }: { states: LanguageState[]; stacked?: boolean; oneLine?: boolean }) {
  const t = useTranslations('clientDashboard.posts.lang')
  if (!states.length) return null
  const tick = ({ code, complete }: LanguageState) => {
    const language = code.toUpperCase()
    const label = complete ? t('complete', { language }) : t('missing', { language })
    return (
      <span className="inline-flex h-6 items-center gap-1 text-xs font-medium">
        <span className={complete ? 'text-foreground' : 'text-muted-foreground'}>{language}</span>
        <span role="img" aria-label={label} title={label} className={`grid place-items-center ${complete ? 'text-success' : 'text-destructive'}`}>
          {complete ? ICONS.tick : ICONS.warn}
        </span>
      </span>
    )
  }
  if (stacked) return <CellStack items={states.map((s) => ({ key: s.code, node: tick(s) }))} />
  return (
    <span className={`flex items-start gap-x-3 ${oneLine ? 'min-w-0 flex-nowrap overflow-hidden' : 'flex-wrap'}`}>
      {states.map((s) => (
        <span key={s.code}>{tick(s)}</span>
      ))}
    </span>
  )
}

/** Cover thumbnail (object-cover, already focal-cropped by the CDN) or a same-size placeholder. */
export function Thumb({ src, className }: { src?: string | null; className: string }) {
  return <MediaFrame src={src} className={className} />
}

/** Small muted category chips, wrapping (or on one line: `oneLine`). */
export function CategoryChips({ categories, max, oneLine }: { categories: string[]; max?: number; oneLine?: boolean }) {
  return <Chips items={categories} max={max} oneLine={oneLine} />
}

/**
 * The featured star. Display-only unless `onChange` is given; then a tap opens a
 * small popover anchored to the star — "Mark as featured" / "Remove from
 * featured" and Cancel — and only that button changes it (no accidental toggles).
 */
export function FeaturedStar({
  featured,
  title,
  onChange,
  align = 'right',
  variant = 'default',
}: {
  featured: boolean
  title: string
  onChange?: (next: boolean) => Promise<boolean>
  align?: 'left' | 'right'
  /** 'cell': a 1.5rem visual on a table line (CellIconButton); 'chip': a 2rem card overlay chip. */
  variant?: 'default' | 'cell' | 'chip'
}) {
  const t = useTranslations('clientDashboard.posts.featured')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const starRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const label = featured ? t('isOn', { title }) : t('isOff', { title })

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) starRef.current?.focus()
  }, [])
  useAnchoredPopover({ open, anchorRef: starRef, panelRef, align, onDismiss: close })
  useEffect(() => {
    if (open) actionRef.current?.focus()
  }, [open])

  if (!onChange) {
    if (variant === 'cell') {
      return (
        <CellIcon>
          <span role="img" aria-label={label} className={`grid place-items-center ${featured ? 'text-foreground' : 'text-muted-foreground/50'}`}>
            <StarGlyph on={featured} size={18} />
          </span>
        </CellIcon>
      )
    }
    return (
      <span
        role="img"
        aria-label={label}
        className={`grid place-items-center ${variant === 'chip' ? OVERLAY_CHIP : `size-6 ${featured ? 'text-foreground' : 'text-muted-foreground/50'}`}`}
      >
        <StarGlyph on={featured} size={18} stroke={variant === 'chip' ? 2.2 : 1.8} />
      </span>
    )
  }
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    setTarget(portalTarget(e.currentTarget))
    setOpen((o) => !o)
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      {variant === 'cell' ? (
        <CellIconButton
          ref={starRef}
          label={label}
          icon={<StarGlyph on={featured} size={18} />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          className={featured ? 'text-foreground' : 'text-muted-foreground'}
        />
      ) : (
        <button
          ref={starRef}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          className={`${
            variant === 'chip' ? `${OVERLAY_CHIP} transition-colors duration-200 hover:bg-background` : 'grid size-11 place-items-center rounded-full hover:bg-hover'
          } focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${variant === 'chip' || featured ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <StarGlyph on={featured} size={variant === 'chip' ? 18 : 20} stroke={variant === 'chip' ? 2.2 : 1.8} />
        </button>
      )}
      {open && target
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={t('dialog')}
              style={FLOATING_STYLE}
              onClick={(e) => e.stopPropagation()}
              className="z-50 flex w-64 flex-col items-stretch gap-2 rounded-2xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-[var(--shadow-raise)]"
            >
              <p className="text-sm leading-5 text-muted-foreground">{t('help')}</p>
              <button
                ref={actionRef}
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const ok = await onChange(!featured)
                  setBusy(false)
                  if (ok) close()
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
              >
                <StarGlyph on={!featured} size={18} />
                {featured ? t('remove') : t('mark')}
              </button>
              <button
                type="button"
                onClick={() => close()}
                className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t('cancel')}
              </button>
            </div>,
            target
          )
        : null}
    </div>
  )
}

/** The date line on phone cards: Ends … / Goes live … / Published … / Edited … (viewer's time zone). */
export function CardDateLine({
  status,
  publishedAt,
  expiresAt,
  updatedAt,
}: {
  status: PostStatus
  publishedAt: string | null
  expiresAt: string | null
  updatedAt: string
}) {
  const t = useTranslations('clientDashboard.posts.meta')
  const format = useShortDate()
  const text =
    status === 'offline'
      ? t('offlineSince', { date: format(expiresAt ?? updatedAt) })
      : expiresAt
        ? t('ends', { date: format(expiresAt) })
        : status === 'scheduled'
          ? t('scheduled', { date: format(publishedAt) })
          : status === 'published'
            ? t('published', { date: format(publishedAt) })
            : t('edited', { date: format(updatedAt) })
  return (
    <span suppressHydrationWarning className="inline-flex items-start gap-1">
      {status === 'scheduled' && !expiresAt ? <span className="pt-0.5">{ICONS.clock}</span> : null}
      {text}
    </span>
  )
}
