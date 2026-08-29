'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { resolveEasing } from '@/lib/motion/easing'

/** The historical StaggerChildren easing. */
const DEFAULT_EASE: number[] = [0.4, 0, 0.2, 1]

interface StaggerChildrenProps {
  children: ReactNode
  className?: string
  /** Delay between each child (seconds) */
  staggerDelay?: number
  /** Initial delay before first child (seconds) */
  delay?: number
  /**
   * Easing. Accepts a CSS `cubic-bezier(...)` string, a `[x1,y1,x2,y2]` array,
   * or one of motion's named easings; anything else degrades to the default.
   */
  ease?: unknown
  /** Distance each child slides up from */
  distance?: number
  duration?: number
  once?: boolean
}

/**
 * StaggerChildren — animates direct children in sequence (slide up + fade in).
 * Perfect for card grids, feature lists, nav items.
 *
 * Usage:
 *   <StaggerChildren staggerDelay={0.1}>
 *     <Card />
 *     <Card />
 *     <Card />
 *   </StaggerChildren>
 */
export function StaggerChildren({
  children,
  className,
  staggerDelay = 0.1,
  delay = 0,
  ease = DEFAULT_EASE,
  distance = 32,
  duration = 0.55,
  once = true,
}: StaggerChildrenProps) {
  // Defensive: same guarantee as SlideUp/FadeIn — a bad easing degrades, never throws.
  const resolvedEase = resolveEasing(ease, DEFAULT_EASE)

  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        delayChildren: delay,
        staggerChildren: staggerDelay,
      },
    },
  }

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: distance },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visible: { opacity: 1, y: 0, transition: { duration, ease: resolvedEase as any } },
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '-5% 0px' }}
      variants={containerVariants}
    >
      {Array.isArray(children)
        ? children.map((child, i) => (
            <motion.div key={i} variants={itemVariants}>
              {child}
            </motion.div>
          ))
        : <motion.div variants={itemVariants}>{children}</motion.div>}
    </motion.div>
  )
}
