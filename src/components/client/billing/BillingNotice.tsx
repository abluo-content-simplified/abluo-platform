import { getTranslations } from 'next-intl/server'
import { ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import type { ProjectBillingStatus } from '@/lib/billing/lifecycle'

/**
 * Payment reminder / pause notice at the top of every dashboard page of a
 * billed project (ADR-041 D8). Only rendered when the grant carries `billing`
 * (BILLING_ENFORCEMENT observe/on). The pay link is for people who can
 * manage billing; everyone else is pointed to the owner. Server component.
 */
export async function BillingNotice({
  projectSlug,
  billing,
  canPay,
  className = '',
}: {
  projectSlug: string
  billing: Pick<ProjectBillingStatus, 'state' | 'daysLeft'> | undefined
  canPay: boolean
  className?: string
}) {
  if (!billing || billing.state === 'ok') return null
  const t = await getTranslations('clientDashboard.billingNotice')
  const message = billing.state === 'reminder' ? t('reminder', { days: Math.max(0, billing.daysLeft ?? 0) }) : t('paused')
  return (
    <Notice
      tone={billing.state === 'reminder' ? 'info' : 'error'}
      layout="row"
      className={className}
      action={
        canPay ? (
          <ButtonLink variant="primary" href={`/${projectSlug}/billing`}>
            {t('payNow')}
          </ButtonLink>
        ) : undefined
      }
    >
      {message}
      {canPay ? null : ` ${t('contactOwner')}`}
    </Notice>
  )
}
