'use client'

import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { AutoGrid, type AutoGridDensity } from '@/components/app/ui/list/AutoGrid'
import type { MediaLibraryItem } from '@/lib/api/media-library'
import { localeFor, needsDescription, type LocaleOf } from '@/lib/client/media-filter'
import { MEDIA_ICONS } from './MediaPhotoSheet'

export type ThumbSize = AutoGridDensity
export const THUMB_SIZES: readonly ThumbSize[] = ['small', 'medium', 'large']

/** Press and hold this long to start selecting (phones and tablets). */
const LONG_PRESS_MS = 500
/** A finger that moves this far is scrolling, not holding. */
const LONG_PRESS_SLOP_PX = 10
/** Two fingers moving this far apart (or together), relative to where they started, change the size by one step. */
const PINCH_STEP = 1.3

/**
 * The Media grid: square photo tiles with "Used N times" and "No description"
 * badges — the same tiles as before, now in an AutoGrid that fills the
 * content width (more columns as space allows). Tap / click a tile to open
 * it; while selecting, a tap ticks it (Shift-click ticks a range on a
 * computer). Press and hold a tile to start selecting (touch). Pinch with two
 * fingers to change the tile size (touch).
 */
export function MediaGrid({
  items,
  defaultLocale,
  size,
  onSize,
  selecting,
  selected,
  nameOf,
  onOpen,
  onToggle,
  onStartSelecting,
  showProject = false,
}: {
  items: MediaLibraryItem[]
  /** The site's default language, or per photo when the list spans several sites. */
  defaultLocale: LocaleOf<MediaLibraryItem>
  size: ThumbSize
  onSize: (size: ThumbSize) => void
  /** Ticks are showing: a tap ticks instead of opening. */
  selecting: boolean
  selected: Set<string>
  nameOf: (item: MediaLibraryItem) => string
  onOpen: (item: MediaLibraryItem) => void
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  /** Long press: start selecting with this photo ticked. */
  onStartSelecting: (id: string) => void
  /** Label each tile with its project (lists that span several projects). */
  showProject?: boolean
}) {
  const t = useTranslations('clientDashboard.media')

  // ── Long press (touch) ─────────────────────────────────────────────────────
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  useEffect(() => {
    const ref = press
    return () => {
      if (ref.current) clearTimeout(ref.current.timer)
    }
  }, [])
  const cancelPress = useCallback(() => {
    if (press.current && !press.current.fired) {
      clearTimeout(press.current.timer)
      press.current = null
    }
  }, [])

  // ── Pinch (touch) ──────────────────────────────────────────────────────────
  const sizeRef = useRef(size)
  useEffect(() => {
    sizeRef.current = size
  }, [size])
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchBase = useRef<number | null>(null)
  const dist = () => {
    const [a, b] = [...touches.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const endTouch = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinchBase.current = null
  }
  const pinch = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        pinchBase.current = dist() || null
        cancelPress()
      }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const base = pinchBase.current
      if (touches.current.size !== 2 || !base) return
      const ratio = dist() / base
      const at = THUMB_SIZES.indexOf(sizeRef.current)
      // Pinch out = larger thumbnails.
      const next = ratio > PINCH_STEP ? at + 1 : ratio < 1 / PINCH_STEP ? at - 1 : at
      if (next !== at && next >= 0 && next < THUMB_SIZES.length) {
        sizeRef.current = THUMB_SIZES[next]
        onSize(THUMB_SIZES[next])
      }
      if (next !== at) pinchBase.current = dist() || null
    },
    onPointerUp: endTouch,
    onPointerCancel: endTouch,
  }

  const pressHandlers = (item: MediaLibraryItem) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (selecting || e.pointerType === 'mouse') return
      const timer = setTimeout(() => {
        if (!press.current) return
        press.current.fired = true
        navigator.vibrate?.(10)
        onStartSelecting(item.assetId)
      }, LONG_PRESS_MS)
      press.current = { id: item.assetId, x: e.clientX, y: e.clientY, timer, fired: false }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (e: ReactMouseEvent) => {
      if (press.current) e.preventDefault()
    },
    onClick: (e: ReactMouseEvent) => {
      // The click that ends a long press only starts the selection.
      if (press.current?.fired) {
        press.current = null
        return
      }
      if (selecting) onToggle(item.assetId, !selected.has(item.assetId), e.shiftKey)
      else onOpen(item)
    },
  })

  return (
    <AutoGrid density={size} label={t('library.title')} className="touch-pan-y" {...pinch}>
      {items.map((item) => {
        const name = nameOf(item)
        const on = selected.has(item.assetId)
        return (
          <li
            key={item.assetId}
            className={`relative aspect-square overflow-hidden rounded-xl border bg-muted ${on ? 'border-ring ring-2 ring-ring' : 'border-border'}`}
          >
            <button
              type="button"
              {...pressHandlers(item)}
              aria-label={selecting ? t('select.photo', { name }) : t('library.edit', { name })}
              aria-pressed={selecting ? on : undefined}
              className="block size-full touch-manipulation select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
              <img
                src={item.thumbUrl}
                alt=""
                width="240"
                height="240"
                loading="lazy"
                draggable={false}
                className={`size-full object-cover [-webkit-touch-callout:none] transition-transform ${on ? 'scale-[0.94] rounded-lg' : ''}`}
              />
            </button>
            {selecting ? (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 ${
                  on ? 'border-action bg-action text-action-foreground' : 'border-background bg-background/60'
                }`}
              >
                {on ? MEDIA_ICONS.tick : null}
              </span>
            ) : null}
            {showProject && item.project ? (
              <span className="pointer-events-none absolute top-1.5 right-1.5 max-w-[70%] truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 text-foreground">
                {item.project.name}
              </span>
            ) : null}
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex flex-col items-start gap-1">
              <span className="max-w-full truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 text-foreground">
                {t('library.usage', { count: item.usedIn.length })}
              </span>
              {needsDescription(item, localeFor(defaultLocale, item)) && size !== 'small' ? (
                <span className="max-w-full truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 text-muted-foreground">{t('library.needsDescription')}</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </AutoGrid>
  )
}

/** Small / Medium / Large tiles: a 44px segmented control with icons. */
export function SizeSwitch({
  value,
  onChange,
  label,
  names,
  className = '',
}: {
  value: ThumbSize
  onChange: (v: ThumbSize) => void
  label: string
  names: Record<ThumbSize, string>
  className?: string
}) {
  const icon = (n: number) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {n === 3 ? (
        // many small squares
        [3, 10, 17].flatMap((x) => [3, 10, 17].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="4" height="4" rx="1" />))
      ) : n === 2 ? (
        [3, 13].flatMap((x) => [3, 13].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="8" height="8" rx="1.5" />))
      ) : (
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
      )}
    </svg>
  )
  return (
    <div role="radiogroup" aria-label={label} className={`h-11 items-stretch gap-1 rounded-xl border border-border bg-background p-1 ${className}`}>
      {THUMB_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={names[s]}
          title={names[s]}
          onClick={() => onChange(s)}
          className={`grid w-10 place-items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            value === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {icon(s === 'small' ? 3 : s === 'medium' ? 2 : 1)}
        </button>
      ))}
    </div>
  )
}
