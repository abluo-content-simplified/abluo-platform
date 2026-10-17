'use client'

import { useTranslations } from 'next-intl'
import { PageShell } from '@/components/app/ui/PageShell'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'

/** Spec §10.5 — error: surfaced, not swallowed, with a retry. */
export default function CatalogueError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('catalogue.dashboard.common')
  return (
    <PageShell>
      <Notice tone="error" title={t('loadFailed')} action={<Button onClick={reset}>{t('retry')}</Button>} />
    </PageShell>
  )
}
