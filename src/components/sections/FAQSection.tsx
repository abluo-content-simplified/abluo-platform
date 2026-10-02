'use client'

import { useId, useState } from 'react'
import { motion } from 'motion/react'
import type { FAQSection, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

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
  const id = useId()
  const buttonId = `${id}-question`
  const panelId = `${id}-answer`

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }} className="last:border-0">
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-6 py-6 text-left"
        aria-expanded={open}
        aria-controls={panelId}
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

      {/*
        Accordion body — ALWAYS in the DOM, collapsed to height 0 when closed.

        The answer used to mount only when opened (AnimatePresence), so the
        server HTML carried the questions but none of the answers: crawlers and
        AI fetchers never saw them, and the FAQPage JSON-LD described text that
        was not on the page. Now the answer is server-rendered and the motion
        tokens animate height + opacity between the two states.

        Closed panels are `inert` + aria-hidden so they are skipped by keyboard
        and assistive tech exactly as when they were unmounted.
      */}
      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
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
    </div>
  )
}

export function FAQSection({ section, surface, designSystem }: Props) {
  const { eyebrow, title, headlineAccent, items } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for section entrance, durationFast for accordion interaction
  const m = designSystem?.motion
  const entranceDuration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const itemDuration = m?.durationFast !== undefined ? m.durationFast / 1000 : 0.12
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  if (!items?.length) return null

  return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <div className="max-w-[680px]">
        {/* Section header — SlideUp, consistent with all other sections */}
        <SlideUp duration={entranceDuration} ease={ease} delay={0}>
          {eyebrow && (
            <EyebrowLabel
              eyebrow={eyebrow}
              designSystem={designSystem}
              defaultAccent="none"
              className="mb-4"
            />
          )}
          {title && (
            <h2
              className="mb-12 [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {renderHeadline(title, headlineAccent)}
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
