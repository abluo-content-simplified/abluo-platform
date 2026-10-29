'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'

/**
 * "Abluo Support replied to your request." — a calm line at the top of every
 * dashboard page while the person has support requests with news (the same
 * count as the sidebar's Support badge). Not a modal; dismissible for this
 * visit; hidden on the Support pages themselves. Rendered by `[tenant]/layout.tsx`.
 */
export function SupportReplyNotice({ projectSlug, count, className = '' }: { projectSlug: string; count: number; className?: string }) {
  const t = useTranslations('clientDashboard.support.replyNotice')
  const pathname = usePathname() // locale-stripped, e.g. "/livener/support"
  const [dismissed, setDismissed] = useState(false)
  if (count <= 0 || dismissed) return null
  if (pathname === `/${projectSlug}/support` || pathname.startsWith(`/${projectSlug}/support/`)) return null
  return (
    <Notice
      tone="info"
      layout="row"
      className={className}
      action={
        <ButtonLink variant="primary" href={`/${projectSlug}/support`}>
          {t('open')}
        </ButtonLink>
      }
      onDismiss={() => setDismissed(true)}
      dismissLabel={t('dismiss')}
    >
      {t('message', { count })}
    </Notice>
  )
}
