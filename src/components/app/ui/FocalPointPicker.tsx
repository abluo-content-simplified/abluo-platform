'use client'

import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

/** Focal point in fractions of the ORIGINAL image (Sanity hotspot centre). */
export type FocalPoint = { x: number; y: number }

export type FocalPreviewKey = 'wide' | 'card' | 'square' | 'tall'

export type FocalPointPickerLabels = {
  title: string
  helper: string
  /** Screen-reader hint for the arrow keys. */
  keys: string
  /** Accessible name of the dot. */
  label: string
  /** "x% from the left, y% from the top". */
  valueText: (x: number, y: number) => string
  previews: string
  preview: Record<FocalPreviewKey, string>
}

export type FocalPointPickerProps = {
  /** Sanity CDN URL of the ORIGINAL image (no query). */
  url: string
  alt: string
  /** null = not set yet (the dot shows in the centre, dimmed). */
  point: FocalPoint | null
  /** Every move (pointer or keys); rounded to 4 decimals, clamped to 0..1. */
  onChange: (p: FocalPoint) => void
  /** Pointer released or dot blurred — a good moment to save. */
  onCommit: () => void
  /** Small save status under the photo ("Saving…" / "Saved"). */
  status?: string
  statusError?: boolean
  labels: FocalPointPickerLabels
  showHeading?: boolean
  /** Cap the photo at ~40% of the screen height (centred) — for step-by-step cards. */
  compact?: boolean
}

const PREVIEWS = [
  { key: 'wide', className: 'aspect-video' },
  { key: 'card', className: 'aspect-[4/3]' },
  { key: 'square', className: 'aspect-square' },
  { key: 'tall', className: 'aspect-[9/16]' },
] as const

/**
 * The cover with a draggable focal dot (ADR-022 §4a: the point is stored as
 * the Media Library asset's hotspot and every crop keeps it in view). Click
 * or tap to place, drag to move, arrow keys move 1% (10% with Shift). Below,
 * live crops at the shapes the website uses — object-fit: cover with
 * object-position from the point, exactly like `focalObjectPosition`.
 */
export function FocalPointPicker({
  url,
  alt,
  point,
  onChange,
  onCommit,
  status = '',
  statusError = false,
  labels,
  showHeading = true,
  compact = false,
}: FocalPointPickerProps) {
  const helpId = useId()
  const frameRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const shown = point ?? { x: 0.5, y: 0.5 }
  const pct = (n: number) => Math.round(n * 100)
  const position = `${pct(shown.x)}% ${pct(shown.y)}%`

  const fromPointer = (e: ReactPointerEvent) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return
    onChange(roundPoint({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }))
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (e.key === 'Home') {
      e.preventDefault()
      return onChange({ x: 0.5, y: 0.5 })
    }
    if (!move) return
    e.preventDefault()
    onChange(roundPoint({ x: shown.x + move[0], y: shown.y + move[1] }))
  }

  return (
    <div>
      {showHeading && <p className="text-[0.9375rem] font-medium text-foreground">{labels.title}</p>}
      <p id={helpId} className={`${showHeading ? 'mt-1' : ''} mb-3 text-sm leading-6 text-muted-foreground`}>
        {labels.helper} <span className="sr-only">{labels.keys}</span>
      </p>
      <div
        ref={frameRef}
        className={`relative cursor-crosshair touch-none overflow-hidden rounded-2xl border border-border bg-muted select-none ${compact ? 'mx-auto w-fit max-w-full' : ''}`}
        onPointerDown={(e) => {
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e)
        }}
        onPointerMove={(e) => draggingRef.current && fromPointer(e)}
        onPointerUp={() => {
          draggingRef.current = false
          onCommit()
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN URL, sized by the CDN */}
        <img src={`${url}?w=1200&auto=format`} alt={alt} width="1200" height="800" draggable={false} className={compact ? 'block h-auto max-h-[40vh] w-auto max-w-full' : 'block h-auto w-full'} />
        <div
          role="slider"
          tabIndex={0}
          aria-label={labels.label}
          aria-describedby={helpId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct(shown.x)}
          aria-valuetext={labels.valueText(pct(shown.x), pct(shown.y))}
          onKeyDown={onKeyDown}
          onBlur={onCommit}
          className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
        >
          <span
            className={`block size-6 rounded-full border-[3px] border-background bg-action shadow-md ${point ? '' : 'opacity-70'}`}
            aria-hidden="true"
          />
        </div>
      </div>
      <p role="status" className={`mt-1 min-h-4 text-xs ${statusError ? 'text-destructive' : 'text-muted-foreground'}`}>
        {status}
      </p>

      <p className="mt-2 text-sm font-medium text-foreground">{labels.previews}</p>
      <ul className="mt-2 flex items-end gap-3 overflow-x-auto pb-1">
        {PREVIEWS.map((p) => (
          <li key={p.key} className="shrink-0">
            <div className={`h-20 overflow-hidden rounded-lg border border-border bg-muted ${p.className}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
              <img
                src={`${url}?w=480&auto=format`}
                alt=""
                width="160"
                height="90"
                draggable={false}
                className="size-full object-cover"
                style={{ objectPosition: position }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{labels.preview[p.key]}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function roundPoint(p: FocalPoint): FocalPoint {
  const c = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000
  return { x: c(p.x), y: c(p.y) }
}
