'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { GalleryViewItem } from '@/lib/gallery/view'
import { resolveEasing } from '@/lib/motion/easing'

// ── Lightbox (ADR-022 §5) ─────────────────────────────────────────────────────
// One shared viewer for every gallery layout, in sections and in blog posts.
//
// - Next / previous with the buttons, the arrow keys and a horizontal swipe;
//   Escape, the close button or a click on the backdrop closes it.
// - Focus moves into the dialog, is kept there while it is open, and returns to
//   the thumbnail that opened it.
// - Rendered through a portal: tiles sit inside motion wrappers that carry a
//   transform, and a transformed ancestor would trap a position:fixed overlay.
// - The page behind does not scroll while it is open.
// - The full-size photo loads only when opened; its neighbours are preloaded.
//
// The backdrop is near-black on every site, whatever the theme: a photo viewer
// is judged against black, and a light theme's background would wash out the
// photos. It is the one colour here that does not come from the design system.

export interface LightboxLabels {
  dialog: string
  close: string
  previous: string
  next: string
  counter: (n: number, total: number) => string
}

interface LightboxProps {
  items: GalleryViewItem[]
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  labels: LightboxLabels
  /** Seconds. */
  duration: number
  ease: unknown
}

const SWIPE_THRESHOLD_PX = 50
const noopSubscribe = () => () => {}

export function Lightbox({ items, index, onIndexChange, onClose, labels, duration, ease }: LightboxProps) {
  // true in the browser, false during server rendering — the portal target
  // (document.body) only exists client-side.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  const open = index !== null && items.length > 0
  const total = items.length
  const current = open ? items[Math.min(Math.max(index, 0), total - 1)] : null

  const go = useCallback(
    (dir: 1 | -1) => {
      if (index === null || total < 2) return
      onIndexChange((index + dir + total) % total)
    },
    [index, total, onIndexChange]
  )

  // Focus in on open, back to the opener on close; lock page scroll.
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  // Keyboard: Escape, arrows, and a focus trap for Tab.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
        if (!focusable || focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, go, onClose])

  // Preload the neighbours so next/previous feel instant.
  useEffect(() => {
    if (!open || index === null || total < 2) return
    for (const n of [index + 1, index - 1]) {
      const item = items[(n + total) % total]
      if (item?.fullSrc) {
        const img = new Image()
        img.src = item.fullSrc
      }
    }
  }, [open, index, items, total])

  if (!mounted) return null

  const resolvedEase = resolveEasing(ease, [0.0, 0.0, 0.2, 1])
  const buttonClass =
    'flex h-11 w-11 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

  return createPortal(
    <AnimatePresence>
      {open && current && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={labels.dialog}
          className="fixed inset-0 z-[1000] flex flex-col bg-black/95"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: resolvedEase as never }}
          onPointerDown={(e) => {
            pointerStart.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerUp={(e) => {
            const start = pointerStart.current
            pointerStart.current = null
            if (!start) return
            const dx = e.clientX - start.x
            const dy = e.clientY - start.y
            if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
          }}
        >
          <div className="flex items-center justify-between px-3 pt-3 text-sm text-white/80 md:px-5 md:pt-5">
            <span aria-live="polite">{labels.counter((index ?? 0) + 1, total)}</span>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={labels.close} className={buttonClass}>
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 md:px-16"
            onClick={(e) => {
              // A click on the backdrop — not on the photo or a button — closes.
              if (e.target === e.currentTarget) onClose()
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={current.key}
                src={current.fullSrc}
                srcSet={current.fullSrcSet}
                sizes="100vw"
                alt={current.alt}
                className="max-h-full max-w-full select-none object-contain"
                draggable={false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration * 0.8, ease: resolvedEase as never }}
              />
            </AnimatePresence>

            {total > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label={labels.previous} className={`${buttonClass} absolute left-2 top-1/2 -translate-y-1/2 md:left-4`}>
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <button type="button" onClick={() => go(1)} aria-label={labels.next} className={`${buttonClass} absolute right-2 top-1/2 -translate-y-1/2 md:right-4`}>
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </>
            )}
          </div>

          <div className="min-h-[3.5rem] px-4 pb-4 pt-3 text-center text-sm leading-relaxed text-white/80 md:pb-6">
            {current.caption ?? current.title ?? ''}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
