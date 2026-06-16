'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

interface FadeInProps {
  children: ReactNode
  className?: string
  /** Delay in seconds before the animation starts */
  delay?: number
  /** Duration in seconds */
  duration?: number
  /** Easing — CSS cubic-bezier string or [x1,y1,x2,y2] array. Defaults to easingStandard. */
  ease?: string | number[]
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
  ease = [0.4, 0, 0.2, 1],
  once = true,
}: FadeInProps) {
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
