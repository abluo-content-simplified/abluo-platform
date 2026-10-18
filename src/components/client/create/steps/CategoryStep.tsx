'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import { StepHeading } from '@/components/client/create/StepHeading'

/**
 * "What's this post about?" — multi-select chips (canvas: pill, ✓ + action colours when chosen) from the blog's categories.
 * With the shared TermPicker (ADR-033 Amendment J): people who may manage categories can type a new one and have it chosen at once.
 */
export function CategoryStep({ draft, site, update, addCategory }: StepProps) {
  const t = useTranslations('clientDashboard.create.category')
  return (
    <section aria-labelledby="category-step-title">
      <StepHeading id="category-step-title" title={t('title')} helper={t('helper')} />
      <div className="mt-8">
        {site.categoryTerms ? (
          <TermPicker
            projectSlug={site.projectSlug}
            module="blog"
            kind="category"
            label={t('title')}
            terms={site.categoryTerms}
            value={draft.categories}
            onChange={(next) => update({ categories: next })}
            defaultLocale={site.defaultLocale}
            canAdd={site.canAddCategory === true}
            onCreated={addCategory}
          />
        ) : (
          <ToggleChips
            label={t('title')}
            options={site.categories}
            value={draft.categories}
            onChange={(next) => update({ categories: next })}
          />
        )}
      </div>
    </section>
  )
}
