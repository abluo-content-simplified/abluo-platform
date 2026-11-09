'use client'

import { useLocale } from 'next-intl'
import { getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { PageShell } from '@/components/app/ui/PageShell'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'

/** Error: surfaced, not swallowed, with a retry. */
export default function DigitalCardsError({ reset }: { error: Error; reset: () => void }) {
  const m = getDigitalCardsMessages(useLocale())
  return (
    <PageShell>
      <Notice tone="error" title={m.screen.loadFailed} action={<Button onClick={reset}>{m.screen.retry}</Button>} />
    </PageShell>
  )
}
