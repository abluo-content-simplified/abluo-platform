'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'

/** "What's this post about?" — multi-select chips (canvas: pill, ✓ + action colours when chosen) from the blog's categories. */
export function CategoryStep({ draft, site, update }: StepProps) {
  const t = useTranslations('clientDashboard.create.category')
  const selected = new Set(draft.categories)
  const toggle = (value: string) => {
    const next = selected.has(value) ? draft.categories.filter((c) => c !== value) : [...draft.categories, value]
    update({ categories: next })
  }
  return (
    <section aria-labelledby="category-step-title">
      <StepHeading id="category-step-title" title={t('title')} helper={t('helper')} />
      <div role="group" aria-label={t('title')} className="mt-8 flex flex-wrap items-start gap-2">
        {site.categories.map((c) => {
          const on = selected.has(c.value)
          return (
            <button
              key={c.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(c.value)}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none ${
                on ? 'border-action bg-action text-action-foreground' : 'border-border bg-card text-foreground hover:bg-hover'
              }`}
            >
              {on ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
              {c.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
