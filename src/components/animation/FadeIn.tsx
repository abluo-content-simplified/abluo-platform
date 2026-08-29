'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { resolveEasing } from '@/lib/motion/easing'

/** The historical FadeIn easing. Every tenant with `motion: null` lands here. */
const DEFAULT_EASE: number[] = [0.4, 0, 0.2, 1]

interface FadeInProps {
  children: ReactNode
  className?: string
  /** Delay in seconds before the animation starts */
  delay?: number
  /** Duration in seconds */
  duration?: number
  /**
   * Easing. Accepts a CSS `cubic-bezier(...)` string, a `[x1,y1,x2,y2]` array,
   * or one of motion's named easings. Anything motion cannot consume is
   * silently replaced by the default rather than throwing.
   * Defaults to easingStandard.
   */
  ease?: unknown
  /** Animate once (default) or every time it enters the viewport */
  once?: boolean
}

const variants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

/**
 * FadeIn — fades content in when it enters the viewport.
 *
 * Usage:
 *   <FadeIn delay={0.1}>
 *     <p>Some content</p>
 *   </FadeIn>
 */
export function FadeIn({
  children,
  className,
  delay = 0,
  duration = 0.5,
  ease = DEFAULT_EASE,
  once = true,
}: FadeInProps) {
  // Defensive: never let an unparseable easing reach motion — it throws and
  // takes the entire wrapped subtree down with it.
  const resolvedEase = resolveEasing(ease, DEFAULT_EASE)

  return (
    <motion.div
      className={className}
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
