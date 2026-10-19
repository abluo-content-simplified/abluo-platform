'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'

/**
 * "Publish the FAQ set too" (ADR-037 D9) — shown on the post's publish step
 * (and above Update post) when the post shows FAQ sets that were never
 * published. Ticked, publishing the post publishes those sets first; unticked,
 * Publish stays disabled and the footer says why. Without faq.set.write the
 * choice is disabled and says who can publish the set.
 */
export function FaqPublishChoice({
  sets,
  checked,
  onChange,
  canWrite,
  className = '',
}: {
  sets: readonly { id: string; name: string }[]
  checked: boolean
  onChange: (checked: boolean) => void
  canWrite: boolean
  className?: string
}) {
  const t = useTranslations('clientDashboard.faq.post.publish')
  const ui = useLocale()
  if (sets.length === 0) return null
  const names = new Intl.ListFormat(ui, { type: 'conjunction' }).format(sets.map((s) => s.name))
  return (
    <CheckboxCard
      className={className}
      label={t('label', { count: sets.length })}
      description={canWrite ? t('help', { count: sets.length, names }) : t('noPermission', { count: sets.length, names })}
      checked={checked && canWrite}
      disabled={!canWrite}
      onChange={onChange}
    />
  )
}
