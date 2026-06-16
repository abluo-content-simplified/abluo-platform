'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

interface SlideUpProps {
  children: ReactNode
  className?: string
  delay?: number
  duration?: number
  /** Easing — CSS cubic-bezier string or [x1,y1,x2,y2] array. Defaults to easingDecelerate. */
  ease?: string | number[]
  /** How many pixels to slide up from (default 40) */
  distance?: number
  once?: boolean
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
  ease = [0.0, 0.0, 0.2, 1],
  distance = 40,
  once = true,
}: SlideUpProps) {
  const variants: Variants = {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0 },
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-10% 0px' }}
      variants={variants}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transition={{ duration, delay, ease: ease as any }}
    >
      {children}
    </motion.div>
  )
}
