'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { FAQSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from './SectionContainer'

interface Props {
  section: FAQSection
  surface: SurfaceType
  designSystem: DesignSystem | null
}

interface FAQItemProps {
  question?: string
  answer?: string
  /** Duration in seconds for accordion open/close and icon rotation */
  itemDuration: number
  ease: string | number[]
}

function FAQItem({ question, answer, itemDuration, ease }: FAQItemProps) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }} className="last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-6 py-6 text-left"
        aria-expanded={open}
      >
        <span
          className="text-base font-medium leading-snug"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {question}
        </span>

        {/* Icon — animated rotation via motion tokens */}
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transition={{ duration: itemDuration, ease: ease as any }}
          className="mt-0.5 shrink-0"
          style={{ color: 'var(--color-text-muted)', display: 'flex' }}
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </motion.span>
      </button>

      {/* Accordion body — AnimatePresence for height + opacity via motion tokens */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transition={{ duration: itemDuration, ease: ease as any }}
            style={{ overflow: 'hidden' }}
          >
            <p
              className="pb-6 text-sm leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function FAQSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, items } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for section entrance, durationFast for accordion interaction
  const m = designSystem?.motion
  const entranceDuration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const itemDuration = m?.durationFast !== undefined ? m.durationFast / 1000 : 0.12
  const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]

  if (!items?.length) return null

  return (
      <SectionContainer style={surfaceStyles}>
        <div className="max-w-[680px]">
        {/* Section header — SlideUp, consistent with all other sections */}
        <SlideUp duration={entranceDuration} ease={ease} delay={0}>
          {eyebrow && (
            <p
              className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h2
              className="mb-12 text-3xl font-semibold leading-snug tracking-tight md:text-4xl"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
            >
              {title}
            </h2>
          )}
        </SlideUp>

        {/* FAQ list — SlideUp with slight delay after header */}
        <SlideUp duration={entranceDuration} ease={ease} delay={0.1}>
          <div style={{ borderTop: '1px solid var(--color-border)' }}>
            {items.map((item) => (
              <FAQItem
                key={item._key}
                question={item.question}
                answer={item.answer}
                itemDuration={itemDuration}
                ease={ease}
              />
            ))}
          </div>
        </SlideUp>
        </div>
      </SectionContainer>

  )
}
