'use client'

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { DialogFrame } from './DialogFrame'

/**
 * A full-screen picture viewer for the dashboards (the website galleries have
 * their own Lightbox on the site design system; this one uses the app layer).
 * It opens over the page — no navigation — and fits the picture to the screen.
 *
 *   • Several images: previous / next buttons, ← → keys, swipe on a phone, and
 *     a counter ("2 of 3", worded by `labels.counter`).
 *   • Esc, the close button or a click on the dark area closes it. The native
 *     modal <dialog> traps focus and returns it to the opener.
 *   • `actions` (per image) sits in the top bar: the admin puts Delete there,
 *     the client only on pictures they may delete.
 *
 * The parent owns `index`; when images are removed it should keep `index`
 * inside the list (this component clamps for display and closes on empty).
 * No text of its own: everything arrives through `labels` and `images[].alt`.
 */
export type ImageViewerImage = {
  key: string
  src: string
  alt: string
  actions?: ReactNode
}

export type ImageViewerLabels = {
  /** Accessible name of the overlay, e.g. "Screenshot". */
  dialog: string
  close: string
  previous: string
  next: string
  counter: (n: number, total: number) => string
}

const SWIPE_PX = 50

export function ImageViewer({
  open,
  images,
  index,
  onIndexChange,
  onClose,
  labels,
}: {
  open: boolean
  images: ImageViewerImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  labels: ImageViewerLabels
}) {
  const titleId = useId()
  const total = images.length
  const at = Math.min(Math.max(index, 0), Math.max(total - 1, 0))
  const current = images[at]
  const start = useRef<{ x: number; y: number } | null>(null)

  const go = useCallback(
    (dir: 1 | -1) => {
      if (total < 2) return
      onIndexChange((at + dir + total) % total)
    },
    [at, total, onIndexChange],
  )

  // Nothing left to show (e.g. the last picture was deleted): close.
  useEffect(() => {
    if (open && total === 0) onClose()
  }, [open, total, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys meant for a dialog stacked above the viewer (a confirmation).
      const t = e.target
      if (t instanceof HTMLElement && t.closest('dialog') && !t.closest('[data-image-viewer]')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, go])

  // Preload the neighbours.
  useEffect(() => {
    if (!open || total < 2) return
    for (const n of [at + 1, at - 1]) {
      const img = new Image()
      img.src = images[(n + total) % total].src
    }
  }, [open, at, total, images])

  const round =
    'flex size-11 items-center justify-center rounded-full bg-popover text-popover-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

  return (
    <DialogFrame
      open={open && total > 0}
      onClose={onClose}
      labelledBy={titleId}
      animate={false}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-overlay p-0 text-popover-foreground backdrop:bg-overlay"
    >
      {current ? (
        <div
          data-image-viewer=""
          className="flex h-dvh w-screen flex-col"
          onPointerDown={(e) => {
            start.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerUp={(e) => {
            const s = start.current
            start.current = null
            if (!s) return
            const dx = e.clientX - s.x
            const dy = e.clientY - s.y
            if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          }}
        >
          <div className="flex items-start justify-between gap-3 px-3 pt-3 md:px-5 md:pt-5">
            <h2 id={titleId} aria-live="polite" className="mt-1.5 rounded-full bg-popover px-3 py-1.5 text-sm font-medium text-popover-foreground empty:hidden">
              <span className="sr-only">{labels.dialog}: </span>
              {total > 1 ? labels.counter(at + 1, total) : null}
            </h2>
            <div className="flex items-start gap-2">
              {current.actions ? <div className="rounded-xl bg-popover text-popover-foreground">{current.actions}</div> : null}
              <button type="button" onClick={onClose} aria-label={labels.close} className={round}>
                <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-16"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose()
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
            <img key={current.key} src={current.src} alt={current.alt} draggable={false} className="max-h-full max-w-full rounded-lg object-contain select-none" />
            {total > 1 ? (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={labels.previous} className={`${round} absolute top-1/2 left-2 -translate-y-1/2  md:left-4`}>
                  <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button type="button" onClick={() => go(1)} aria-label={labels.next} className={`${round} absolute top-1/2 right-2 -translate-y-1/2  md:right-4`}>
                  <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </DialogFrame>
  )
}
