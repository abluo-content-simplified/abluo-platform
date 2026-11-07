'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { PageShell } from '@/components/app/ui/PageShell'

/** Error: surfaced, not swallowed, with a retry. */
export default function BookingsError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('clientDashboard.bookings.list')
  return (
    <PageShell>
      <Notice tone="error" title={t('loadFailed')} action={<Button onClick={reset}>{t('retry')}</Button>} />
    </PageShell>
  )
}
