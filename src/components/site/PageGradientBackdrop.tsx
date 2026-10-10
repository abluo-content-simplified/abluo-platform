'use client'

import { useEffect, useState } from 'react'
import { motion, motionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { MAX_PAGE_BLOBS, type PageGradientMotion } from '@/lib/sanity/gradients'

/**
 * PageGradientBackdrop — draws the design system's Page Background Gradient
 * behind the whole page, and (optionally) moves it.
 *
 * Colours, positions and sizes all come from CSS variables emitted by the
 * tenant layout (pageGradientCssVars), so light/dark switching needs no
 * re-render. The design system only chooses WHICH motion (pageGradientMotion);
 * how it moves — the timing below — is choreography and lives here, per the
 * platform rule that animation belongs to components, never to content.
 *
 *   drift   each blob wanders on its own slow loop (≈ 50–80 s per cycle)
 *   scroll  blobs move slower than the page as it scrolls — a sense of depth;
 *           lower blobs move a little more than upper ones
 *
 * Reduced motion → always still. Coarse pointers (phones, tablets) → drift
 * only, because scroll-linked layers are where low-end phones stutter.
 *
 * The layer is absolutely positioned in <body> (which PAGE_GRADIENT_BODY_RULE
 * makes relative + isolated), so it is exactly as tall as the page, sits behind
 * all content, never takes pointer events, and is hidden from assistive tech.
 */

// Choreography — per blob: drift offset (vw / % of page height) and duration (s).
const DRIFT = [
  { x: 6, y: 4, d: 58 },
  { x: -7, y: 5, d: 71 },
  { x: 5, y: -6, d: 64 },
  { x: -5, y: -4, d: 79 },
] as const
/** How far (px) each blob lags behind over a full scroll of the page. */
const SCROLL_LAG = [80, 140, 200, 260] as const
/** Stand-in progress when scroll depth is off, so hooks run unconditionally. */
const ZERO = motionValue(0)

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarse(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return coarse
}

function Blob({ i, drift, progress }: { i: number; drift: boolean; progress: MotionValue<number> | null }) {
  const scrollY = useTransform(progress ?? ZERO, [0, 1], [0, SCROLL_LAG[i]])
  const d = DRIFT[i]
  return (
    // Outer: placement + scroll lag. Inner: the colour + drift loop.
    <motion.div
      style={{
        position: 'absolute',
        left: `calc(var(--page-blob-${i}-x) - 70%)`,
        top: `calc(var(--page-blob-${i}-y) - var(--page-blob-${i}-h))`,
        width: '140%',
        height: `calc(var(--page-blob-${i}-h) * 2)`,
        y: progress ? scrollY : 0,
      }}
    >
      <motion.div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(closest-side, var(--page-blob-${i}-color) 0%, transparent 70%)`,
          willChange: drift ? 'transform' : undefined,
        }}
        animate={drift ? { x: ['0vw', `${d.x}vw`], y: ['0%', `${d.y}%`] } : undefined}
        transition={drift ? { duration: d.d, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } : undefined}
      />
    </motion.div>
  )
}

export function PageGradientBackdrop({ motion: mode }: { motion: PageGradientMotion }) {
  const reduced = useReducedMotion() ?? false
  const coarse = useCoarsePointer()
  const { scrollYProgress } = useScroll()

  const drift = !reduced && (mode === 'drift' || mode === 'driftScroll')
  const scroll = !reduced && !coarse && (mode === 'scroll' || mode === 'driftScroll')
  const progress = scroll ? scrollYProgress : null
  // The flat layer (linear / radial styles) gets a gentle version of the same.
  const flatY = useTransform(scrollYProgress, [0, 1], [0, 120])

  return (
    <div
      aria-hidden="true"
      data-page-gradient=""
      style={{ position: 'absolute', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <motion.div
        style={{
          position: 'absolute',
          inset: '-6% 0',
          backgroundImage: 'var(--page-gradient)',
          backgroundSize: '100% 100%',
          y: scroll ? flatY : 0,
        }}
        animate={drift ? { scale: [1, 1.06] } : undefined}
        transition={drift ? { duration: 70, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' } : undefined}
      />
      {Array.from({ length: MAX_PAGE_BLOBS }, (_, i) => (
        <Blob key={i} i={i} drift={drift} progress={progress} />
      ))}
    </div>
  )
}
