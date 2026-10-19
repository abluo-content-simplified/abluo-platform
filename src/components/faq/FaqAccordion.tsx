'use client'

import { useId, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'

// ── FaqAccordion (client) ─────────────────────────────────────────────────────
// The FAQ accordion presentation, unchanged from the FAQ section (ADR-037 D6):
// one button per question, the answer panel ALWAYS in the server HTML and
// collapsed to height 0 when closed. Answers arrive as server-rendered nodes
// (restricted rich text from FaqPlacement), so this file never renders text of
// its own and needs no dictionary.

export interface FaqAccordionItem {
  key: string
  question: string
  answer: ReactNode
}

interface Props {
  items: FaqAccordionItem[]
  /** Duration in seconds for accordion open/close and icon rotation (durationFast). */
  itemDuration: number
  ease: string | number[]
}

function FaqAccordionRow({ question, answer, itemDuration, ease }: Omit<FaqAccordionItem, 'key'> & Omit<Props, 'items'>) {
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
        <span className="text-base font-medium leading-snug" style={{ color: 'var(--color-text-primary)' }}>
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
        Accordion body — ALWAYS in the DOM, collapsed to height 0 when closed,
        so crawlers, AI fetchers and the FAQPage JSON-LD see the same answers.
        Closed panels are `inert` + aria-hidden, skipped by keyboard and
        assistive tech exactly as if they were unmounted.
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
        <div className="pb-6 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {answer}
        </div>
      </motion.div>
    </div>
  )
}

export function FaqAccordion({ items, itemDuration, ease }: Props) {
  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      {items.map((item) => (
        <FaqAccordionRow key={item.key} question={item.question} answer={item.answer} itemDuration={itemDuration} ease={ease} />
      ))}
    </div>
  )
}
