'use client'

import { useCallback, useMemo, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * Cell primitives for DataTable (and the same pieces reused on cards).
 *
 * The alignment contract: every table cell is `align-top` with the same
 * `pt-4`, and the FIRST line of every cell is a 1.5rem line box. Each
 * primitive below puts its first line in that box, so the checkbox, star, ⋯,
 * the first chip, the status pill, "EN ✓", the dates and the title all share
 * one centre line (0.75rem under the top padding).
 */

/** The 1.5rem line box. */
const LINE = 'flex min-h-6 items-center'

/** Short local date ("6 Oct 2026") in the viewer's language and time zone. */
export function useShortDate() {
  const locale = useLocale()
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }), [locale])
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return ''
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? '' : fmt.format(d)
    },
    [fmt]
  )
}

/**
 * A date in the viewer's time zone. The server renders it in its own zone; the
 * browser corrects it on hydration (hence the suppressed warning, this node only).
 */
export function LocalDate({ iso, className = '', empty }: { iso: string | null | undefined; className?: string; empty?: string }) {
  const format = useShortDate()
  if (!iso) return empty ? <span className={`text-muted-foreground ${className}`}>{empty}</span> : null
  return (
    <time dateTime={iso} suppressHydrationWarning className={className}>
      {format(iso)}
    </time>
  )
}

/** Primary text (1.5rem line, links when `href`), optional muted subtitle below. */
export function CellText({
  primary,
  secondary,
  href,
  clamp = 2,
}: {
  primary: ReactNode
  secondary?: ReactNode
  href?: string | null
  /** Lines of primary text before it clamps (1 or 2). */
  clamp?: 1 | 2
}) {
  const cls = `${clamp === 1 ? 'line-clamp-1' : 'line-clamp-2'} text-sm leading-6 font-semibold text-foreground`
  return (
    <div className="min-w-0">
      {href ? (
        <Link href={href} className={`${cls} hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}>
          {primary}
        </Link>
      ) : (
        <span className={cls}>{primary}</span>
      )}
      {secondary ? <p className="mt-0.5 line-clamp-2 text-sm leading-5 font-normal text-muted-foreground">{secondary}</p> : null}
    </div>
  )
}

/**
 * Small muted chips (1.5rem), wrapping; "+N" after `max`. `oneLine`: never
 * wraps — the chips truncate to fit and "+N" is a chip of its own.
 */
export function Chips({ items, max, oneLine = false }: { items: string[]; max?: number; oneLine?: boolean }) {
  if (!items.length) return null
  const shown = max ? items.slice(0, max) : items
  const rest = items.length - shown.length
  if (oneLine) {
    return (
      <span className="flex w-full min-w-0 flex-nowrap items-start gap-1 overflow-hidden">
        {shown.map((c) => (
          <span key={c} title={c} className="block h-6 min-w-0 truncate rounded-md bg-muted px-2 text-xs leading-6 text-muted-foreground">
            {c}
          </span>
        ))}
        {rest > 0 ? <span className="block h-6 shrink-0 rounded-md bg-muted px-2 text-xs leading-6 text-muted-foreground">+{rest}</span> : null}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-start gap-1">
      {shown.map((c) => (
        <span key={c} className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs whitespace-nowrap text-muted-foreground">
          {c}
        </span>
      ))}
      {rest > 0 ? <span className="inline-flex h-6 items-center px-1 text-xs text-muted-foreground">+{rest}</span> : null}
    </span>
  )
}

/** Chips in a cell; `empty` (e.g. "—") on the line when there are none. */
export function CellChips({ items, max, empty = '—' }: { items: string[]; max?: number; empty?: ReactNode }) {
  return items.length ? <Chips items={items} max={max} /> : <span className={`${LINE} text-sm text-muted-foreground`}>{empty}</span>
}

export type PillTone = 'success' | 'highlight' | 'outline' | 'muted'
const PILL_TONE: Record<PillTone, string> = {
  success: 'bg-success/15 text-foreground',
  highlight: 'bg-accent text-accent-foreground',
  outline: 'border border-border text-muted-foreground',
  muted: 'bg-muted text-muted-foreground',
}

/** A 1.5rem rounded pill: optional leading icon / dot. */
export function Pill({ tone = 'muted', icon, children }: { tone?: PillTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${PILL_TONE[tone]}`}>
      {icon}
      {children}
    </span>
  )
}

/** One or more pills in a cell, wrapping; the first sits on the line. */
export function CellPill({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-start gap-1.5">{children}</span>
}

/**
 * The icon slot every icon cell uses — header and body alike (star, ⋯, the
 * row checkbox): a 1.5rem box, left-aligned in the cell, its top on the
 * cell's top padding, so it sits on the row's first line and exactly under
 * the header icon (same `px-2` in both). The control's 2.75rem hit area is
 * absolutely positioned around the box, so it never moves the box.
 */
export const ICON_SLOT = 'relative flex size-6 shrink-0 items-center justify-center'

/** A header (or display-only) icon in the icon slot. */
export function CellIcon({ children }: { children: ReactNode }) {
  return <span className={ICON_SLOT}>{children}</span>
}

/** A 2.75rem control (e.g. the row checkbox) centred on the icon slot. */
export function CellIconSlot({ children }: { children: ReactNode }) {
  return (
    <span className={ICON_SLOT}>
      <span className="absolute -inset-2.5 flex items-center justify-center">{children}</span>
    </span>
  )
}

/**
 * An icon control in the icon slot: a 1.5rem visual (the icon and its hover
 * circle) with an invisible 2.75rem hit area around it.
 */
export function CellIconButton({
  icon,
  label,
  ref,
  className = '',
  ...rest
}: {
  icon: ReactNode
  label: string
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>) {
  return (
    <span className={ICON_SLOT}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...rest}
        className={`group/cib absolute -inset-2.5 grid place-items-center rounded-full focus-visible:outline-none ${className}`}
      >
        <span className="grid size-6 place-items-center rounded-full transition-colors duration-200 group-hover/cib:bg-hover group-focus-visible/cib:ring-2 group-focus-visible/cib:ring-ring">
          {icon}
        </span>
      </button>
    </span>
  )
}

/** A short local date on the line; `icon` (e.g. a clock) before it; `empty` when there is none. */
export function CellDate({ iso, empty = '—', icon }: { iso: string | null | undefined; empty?: string; icon?: ReactNode }) {
  return (
    <span className={`${LINE} gap-1 text-sm leading-6 whitespace-nowrap text-muted-foreground`}>
      {iso && icon ? icon : null}
      <LocalDate iso={iso} empty={empty} />
    </span>
  )
}

/** Stacked lines, each a 1.5rem line box (e.g. one language per line). */
export function CellStack({ items }: { items: { key: string; node: ReactNode }[] }) {
  if (!items.length) return null
  return (
    <span className="flex flex-col items-start">
      {items.map((i) => (
        <span key={i.key} className={LINE}>
          {i.node}
        </span>
      ))}
    </span>
  )
}

export const IMAGE_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3h18v18H3zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21" />
  </svg>
)

/** Focal point (0–1) → CSS object-position. */
export function focalPosition(focal?: { x: number; y: number } | null): string | undefined {
  return focal ? `${(focal.x * 100).toFixed(1)}% ${(focal.y * 100).toFixed(1)}%` : undefined
}

/**
 * An image in a fixed frame, in normal flow, object-cover around the focal
 * point — or a placeholder of exactly the same frame (muted background +
 * image icon). `size` fixes the frame's width and height (inline, with the
 * same minimums, so a table or flex parent can never shrink the
 * placeholder); without it `className` must size the frame (e.g.
 * `absolute inset-0 size-full` inside a sized box).
 */
export function MediaFrame({
  src,
  alt = '',
  focal,
  size,
  className = '',
}: {
  src?: string | null
  alt?: string
  focal?: { x: number; y: number } | null
  /** Fixed frame, e.g. { width: '6rem', height: '4.5rem' }. */
  size?: { width: string; height: string }
  className?: string
}) {
  const box = size ? { width: size.width, height: size.height, minWidth: size.width, minHeight: size.height } : undefined
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN image, already sized and focal-cropped
    return <img src={src} alt={alt} loading="lazy" style={{ ...box, objectPosition: focalPosition(focal) }} className={`block shrink-0 bg-muted object-cover ${className}`} />
  }
  return (
    <span aria-hidden="true" style={box} className={`grid shrink-0 place-items-center bg-muted text-muted-foreground ${className}`}>
      {IMAGE_ICON}
    </span>
  )
}

/** The table image: 6rem × 4.5rem (image and placeholder alike), rounded-lg; its top sits on the row's top padding. */
export function CellImage({ src, alt, focal }: { src?: string | null; alt?: string; focal?: { x: number; y: number } | null }) {
  return <MediaFrame src={src} alt={alt} focal={focal} size={{ width: '6rem', height: '4.5rem' }} className="rounded-lg" />
}
