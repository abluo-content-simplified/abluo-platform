'use client'

import { useTranslations } from 'next-intl'
import { PageShell } from '@/components/app/ui/PageShell'
import { CAT_BUTTON } from '@/components/client/catalogue/catalogue-ui'

/** Spec §10.5 — error: surfaced, not swallowed, with a retry. */
export default function CatalogueError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('catalogue.dashboard.common')
  return (
    <PageShell>
      <div role="alert" className="rounded-2xl border border-border px-6 py-10">
        <p className="font-medium text-foreground">{t('loadFailed')}</p>
        <button type="button" onClick={reset} className={`mt-3 ${CAT_BUTTON}`}>
          {t('retry')}
        </button>
      </div>
    </PageShell>
  )
}
