'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'

/** "What's this post about?" — multi-select chips from the blog's configured categories. */
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
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-2">
        {site.categories.map((c) => {
          const on = selected.has(c.value)
          return (
            <li key={c.value}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.value)}
                className={`flex min-h-16 w-full items-center rounded-2xl border-2 px-4 py-3 text-left text-[17px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  on ? 'border-foreground bg-selected-tint text-foreground' : 'border-border bg-background text-foreground hover:bg-hover'
                }`}
              >
                {c.label}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
