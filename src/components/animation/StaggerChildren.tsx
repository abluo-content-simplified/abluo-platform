'use client'

import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

interface StaggerChildrenProps {
  children: ReactNode
  className?: string
  /** Delay between each child (seconds) */
  staggerDelay?: number
  /** Initial delay before first child (seconds) */
  delay?: number
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
  distance = 32,
  duration = 0.55,
  once = true,
}: StaggerChildrenProps) {
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
    visible: { opacity: 1, y: 0, transition: { duration, ease: [0.4, 0, 0.2, 1] } },
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
