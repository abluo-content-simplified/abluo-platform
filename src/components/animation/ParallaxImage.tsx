'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'
import type { ReactNode } from 'react'

interface ParallaxImageProps {
  children: ReactNode
  className?: string
  /** Parallax strength: how many px the inner element moves relative to scroll.
   *  Positive = moves up as you scroll down (classic parallax).
   *  Default: 60px */
  strength?: number
}

/**
 * ParallaxImage — wraps an image (or any element) with a subtle scroll parallax.
 * The container clips overflow; the inner element moves at a slower rate than the page.
 *
 * Usage:
 *   <ParallaxImage className="h-96 rounded-2xl overflow-hidden">
 *     <Image src={...} fill className="object-cover" alt="..." />
 *   </ParallaxImage>
 */
export function ParallaxImage({ children, className, strength = 60 }: ParallaxImageProps) {
  const ref = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })

  // Map scroll progress 0→1 to -strength/2 → strength/2 (centered around 0)
  const y = useTransform(scrollYProgress, [0, 1], [-strength / 2, strength / 2])

  return (
    <div ref={ref} className={className} style={{ overflow: 'hidden' }}>
      <motion.div style={{ y, height: `calc(100% + ${strength}px)`, width: '100%' }}>
        {children}
      </motion.div>
    </div>
  )
}
