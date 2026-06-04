'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

interface SlideUpProps {
  children: ReactNode
  className?: string
  delay?: number
  duration?: number
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
      transition={{ duration, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}
