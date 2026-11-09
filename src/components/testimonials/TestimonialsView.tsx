'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { TestimonialCardView } from '@/lib/modules/testimonials/view'
import { resolveEasing } from '@/lib/motion/easing'
import { Stars } from './Stars'

// ── TestimonialsView (client) — ADR-048 D5 ────────────────────────────────────
// Cards in a carousel or a grid, and the window ("Read more") that shows one
// testimonial in full on the same page: no navigation, no URL.
//
// Everything printed arrives already worded (TestimonialCardView); this file
// only lays it out and handles interaction.
//
// Carousel: native horizontal scroll with scroll-snap, so touch swipe and
// trackpads work without code. Previous / next buttons sit left and right and
// are disabled at the ends; arrow keys work while the track has focus. No
// autoplay. Slides are named "2 of 5".
//
// Window: a portal dialog (a transformed ancestor would trap position:fixed,
// as in the gallery Lightbox). Focus moves in, Tab stays inside, Escape or the
// close button or a click outside closes it, focus returns to the "Read more"
// button, and the page behind does not scroll.

export interface TestimonialsViewLabels {
  readMore: string
  close: string
  previous: string
  next: string
  carouselLabel: string
  dialogFallback: string
  /** "2 of 5" for slide n of total — pre-filled for every slide. */
  slideLabels: string[]
}

interface Props {
  items: TestimonialCardView[]
  layout: 'carousel' | 'grid'
  labels: TestimonialsViewLabels
  /** Seconds (durationFast). */
  duration: number
  ease: unknown
}

const noopSubscribe = () => () => {}

function Meta({ t }: { t: TestimonialCardView }) {
  const bits = [t.context, t.age].filter(Boolean) as string[]
  return (
    <div className="pt-4">
      {t.name && (
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t.name}
        </p>
      )}
      {bits.length > 0 && (
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {bits.join(' · ')}
        </p>
      )}
      {t.rating && t.ratingLabel && (
        <div className="mt-1.5">
          <Stars rating={t.rating} label={t.ratingLabel} />
        </div>
      )}
      {(t.dateText || t.source) && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t.dateText && <time dateTime={t.dateIso ?? undefined}>{t.dateText}</time>}
          {t.dateText && t.source && ' · '}
          {t.source &&
            (t.source.href ? (
              <a href={t.source.href} target="_blank" rel="noopener noreferrer" className="relative z-10 underline underline-offset-2">
                {t.source.text}
              </a>
            ) : (
              <span>{t.source.text}</span>
            ))}
        </p>
      )}
      {t.languageNote && (
        <p className="mt-1.5 text-xs italic" style={{ color: 'var(--color-text-muted)' }}>
          {t.languageNote}
        </p>
      )}
    </div>
  )
}

function Card({ t, labels, onOpen }: { t: TestimonialCardView; labels: TestimonialsViewLabels; onOpen: (t: TestimonialCardView, opener: HTMLElement) => void }) {
  // Every card has the same build so the cards line up: heading, three lines of
  // the testimonial, then name and details, and "Read more" always last, so it
  // sits on the same line in every card of a row (cards stretch to equal height).
  // The whole card opens the window: the "Read more" button's ::after covers
  // the card, so there is one focus target and one click target (Tom, 2026-11-09).
  // Links inside the card (source) sit above that layer and stay clickable.
  return (
    <article
      className="relative flex h-full cursor-pointer flex-col rounded-lg p-6 transition-colors md:p-7"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      lang={t.lang}
    >
      {t.title && (
        <h3 className="m-0 mb-2 text-base font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
          {t.title}
        </h3>
      )}
      <blockquote className="m-0">
        <p className="line-clamp-3 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {t.excerpt}
        </p>
      </blockquote>
      <div className="mt-auto">
        <Meta t={t} />
        <button
          type="button"
          aria-label={t.readMoreLabel}
          onClick={(e) => onOpen(t, e.currentTarget)}
          className="mt-4 self-start text-sm font-medium underline underline-offset-4 after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[color:var(--color-primary)]"
          style={{ color: 'var(--color-primary)', outlineColor: 'var(--color-primary)' }}
        >
          {labels.readMore}
        </button>
      </div>
    </article>
  )
}

function Carousel({ items, labels, onOpen }: { items: TestimonialCardView[]; labels: TestimonialsViewLabels; onOpen: (t: TestimonialCardView, opener: HTMLElement) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const update = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    update()
    const el = trackRef.current
    if (!el) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [update, items.length])

  const go = useCallback((dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    const slide = el.firstElementChild as HTMLElement | null
    const step = slide ? slide.offsetWidth + 24 : el.clientWidth
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  const btn =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-30 sm:h-11 sm:w-11'
  const btnStyle = { color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', outlineColor: 'var(--color-primary)' }

  return (
    <div role="region" aria-roledescription="carousel" aria-label={labels.carouselLabel} className="flex items-center gap-2 sm:gap-4">
      <button type="button" className={btn} style={btnStyle} aria-label={labels.previous} disabled={atStart} onClick={() => go(-1)}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.5 4.5L7 10l5.5 5.5" />
        </svg>
      </button>
      <div
        ref={trackRef}
        tabIndex={0}
        onScroll={update}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            go(1)
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            go(-1)
          }
        }}
        className="flex min-w-0 flex-1 snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-4"
        style={{ outlineColor: 'var(--color-primary)' }}
      >
        {items.map((t, i) => (
          <div
            key={t.id}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slideLabels[i]}
            className="min-w-0 shrink-0 basis-full snap-start sm:basis-[calc((100%-1.5rem)/2)] lg:basis-[calc((100%-3rem)/3)]"
          >
            <Card t={t} labels={labels} onOpen={onOpen} />
          </div>
        ))}
      </div>
      <button type="button" className={btn} style={btnStyle} aria-label={labels.next} disabled={atEnd} onClick={() => go(1)}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 4.5L13 10l-5.5 5.5" />
        </svg>
      </button>
    </div>
  )
}

function Dialog({ item, opener, labels, onClose, duration, ease }: { item: TestimonialCardView | null; opener: HTMLElement | null; labels: TestimonialsViewLabels; onClose: () => void; duration: number; ease: unknown }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const open = item !== null

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [open, opener])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')
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
  }, [open, onClose])

  if (!mounted) return null
  const resolvedEase = resolveEasing(ease, [0.0, 0.0, 0.2, 1])
  const titleId = item ? `testimonial-title-${item.id}` : undefined

  return createPortal(
    <AnimatePresence>
      {item && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration, ease: resolvedEase as never }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            lang={item.lang}
            className="relative max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-t-xl p-6 sm:rounded-xl sm:p-8"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}
          >
            <button
              ref={closeRef}
              type="button"
              aria-label={labels.close}
              onClick={onClose}
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ color: 'var(--color-text-secondary)', outlineColor: 'var(--color-primary)' }}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
            <h3 id={titleId} className="sr-only">
              {item.name ?? labels.dialogFallback}
            </h3>
            {item.title && (
              <p className="m-0 mt-4 pr-8 text-lg font-semibold leading-snug">
                {item.title}
              </p>
            )}
            <blockquote className="m-0 mt-4 space-y-4 pr-8 text-base leading-relaxed">
              {item.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </blockquote>
            <Meta t={item} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function TestimonialsView({ items, layout, labels, duration, ease }: Props) {
  const [open, setOpen] = useState<{ item: TestimonialCardView; opener: HTMLElement } | null>(null)
  const onOpen = useCallback((item: TestimonialCardView, opener: HTMLElement) => setOpen({ item, opener }), [])
  const onClose = useCallback(() => setOpen(null), [])

  return (
    <>
      {layout === 'grid' ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <li key={t.id} className="min-w-0">
              <Card t={t} labels={labels} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : (
        <Carousel items={items} labels={labels} onOpen={onOpen} />
      )}
      <Dialog item={open?.item ?? null} opener={open?.opener ?? null} labels={labels} onClose={onClose} duration={duration} ease={ease} />
    </>
  )
}
