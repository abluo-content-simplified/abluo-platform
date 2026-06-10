'use client'

import { useState } from 'react'
import type { FAQSection } from '@/lib/sanity/types'

interface Props {
  section: FAQSection
}

function FAQItem({ question, answer }: { question?: string; answer?: string }) {
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
        <span
          className={`mt-0.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}
          style={{ color: 'var(--color-text-muted)' }}
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && (
        <p
          className="pb-6 text-sm leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {answer}
        </p>
      )}
    </div>
  )
}

export function FAQSection({ section }: Props) {
  const { eyebrow, title, items } = section

  if (!items?.length) return null

  return (
    <section
      className="px-6 py-24 md:px-16 lg:px-24"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="mx-auto w-full max-w-3xl">
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
        <div style={{ borderTop: '1px solid var(--color-border)' }}>
          {items.map((item) => (
            <FAQItem key={item._key} question={item.question} answer={item.answer} />
          ))}
        </div>
      </div>
    </section>
  )
}
