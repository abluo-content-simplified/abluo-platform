'use client'

import { useTranslations } from 'next-intl'
import { Pill } from '@/components/app/ui/list/cells'
import { billingPillModel } from '@/components/app/ui/billing-status-model'
import type { BillingStatusView } from '@/lib/admin/billing/types'

/** A project's billing state as one small pill (admin Billing card, Projects list, Admin Home). */
export function BillingStatusPill({ status, billed = true, testData = false, className }: { status: BillingStatusView | null; billed?: boolean; testData?: boolean; className?: string }) {
  const t = useTranslations('app.billingStatus')
  const model = billingPillModel(status, billed)
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`} data-billing-state={status?.state ?? 'none'}>
      <Pill tone={model.tone}>{t(model.key, model.values)}</Pill>
      {testData ? <Pill tone="outline">{t('testData')}</Pill> : null}
    </span>
  )
}
