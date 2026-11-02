import { getTranslations } from 'next-intl/server'
import { ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import type { BillingAttention } from '@/lib/billing/client-access'

/**
 * Home: a calm "a payment is waiting" card for the person who pays (Tom,
 * 2026-11-02), with a link to Billing. Only rendered with a `billingAttention`
 * nudge, and not when the enforcement banner (BillingNotice) already says it.
 * Server component.
 */
export async function BillingAttentionCard({ projectSlug, attention }: { projectSlug: string; attention: BillingAttention }) {
  const t = await getTranslations('clientDashboard.billing.attention')
  const days = Math.max(0, attention.daysLeft ?? 0)
  const body =
    attention.kind === 'payNow' ? t('body.payNow', { days }) : attention.kind === 'paymentDue' ? t('body.paymentDue', { days }) : t('body.paused')
  return (
    <Notice
      tone={attention.kind === 'paused' ? 'error' : 'info'}
      title={t(`title.${attention.kind}`)}
      action={
        <ButtonLink variant="primary" href={`/${projectSlug}/billing`}>
          {t('goToBilling')}
        </ButtonLink>
      }
    >
      {body}
    </Notice>
  )
}
