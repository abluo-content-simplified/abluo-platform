'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { StepHeading } from '@/components/client/create/StepHeading'

/** "What's this post about?" — multi-select chips (canvas: pill, ✓ + action colours when chosen) from the blog's categories. */
export function CategoryStep({ draft, site, update }: StepProps) {
  const t = useTranslations('clientDashboard.create.category')
  return (
    <section aria-labelledby="category-step-title">
      <StepHeading id="category-step-title" title={t('title')} helper={t('helper')} />
      <div className="mt-8">
        <ToggleChips
          label={t('title')}
          options={site.categories}
          value={draft.categories}
          onChange={(next) => update({ categories: next })}
        />
      </div>
    </section>
  )
}
