'use client'

import { motion, type Variants } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { resolveEasing } from '@/lib/motion/easing'

/** The historical SlideUp easing. Every tenant with `motion: null` lands here. */
const DEFAULT_EASE: number[] = [0.0, 0.0, 0.2, 1]

interface SlideUpProps {
  children: ReactNode
  className?: string
  delay?: number
  duration?: number
  /**
   * Easing. Accepts a CSS `cubic-bezier(...)` string, a `[x1,y1,x2,y2]` array,
   * or one of motion's named easings. Anything motion cannot consume is
   * silently replaced by the default rather than throwing.
   * Defaults to easingDecelerate.
   */
  ease?: unknown
  /** How many pixels to slide up from (default 40) */
  distance?: number
  once?: boolean
  /**
   * Inline styles for the motion wrapper.
   *
   * SlideUp sits BETWEEN a grid container and its child, so the wrapper — not
   * the child — is the grid item. Anything the parent grid needs to say about
   * one item (`gridColumn`, `gridRow`) has to land here or it addresses an
   * element that is not participating in the grid at all. Kept minimal on
   * purpose: layout placement, not decoration.
   */
  style?: CSSProperties
}

/**
 * SlideUp — slides content up and fades in when it enters the viewport.
 * Matches the Webflow scroll-trigger entrance pattern used on Livener.
 *
 * Usage:
 *   <SlideUp delay={0.15}>
 *     <h2>Livener launches at MIR</h2>
 *   </SlideUp>
 */
export function SlideUp({
  children,
  className,
  delay = 0,
  duration = 0.6,
  ease = DEFAULT_EASE,
  distance = 40,
  once = true,
  style,
}: SlideUpProps) {
  // Defensive: a caller that passes a raw design-system token (or anything
  // malformed) must not be able to crash the page — motion throws on
  // `cubic-bezier(...)` strings, which would blank the whole section.
  const resolvedEase = resolveEasing(ease, DEFAULT_EASE)

  const variants: Variants = {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0 },
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-10% 0px' }}
      variants={variants}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transition={{ duration, delay, ease: resolvedEase as any }}
    >
      {children}
    </motion.div>
  )
}
