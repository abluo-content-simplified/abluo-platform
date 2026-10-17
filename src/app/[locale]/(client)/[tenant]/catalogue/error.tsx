'use client'

import { useTranslations } from 'next-intl'
import { PageShell } from '@/components/app/ui/PageShell'
import { Button } from '@/components/app/ui/Button'

/** Spec §10.5 — error: surfaced, not swallowed, with a retry. */
export default function CatalogueError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('catalogue.dashboard.common')
  return (
    <PageShell>
      <div role="alert" className="rounded-2xl border border-border px-6 py-10">
        <p className="font-medium text-foreground">{t('loadFailed')}</p>
        <Button className="mt-3" onClick={reset}>
          {t('retry')}
        </Button>
      </div>
    </PageShell>
  )
}
