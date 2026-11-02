import { getTranslations } from 'next-intl/server'
import { requireBillingAdmin } from '@/lib/admin/billing/access'
import { loadProjectBillingAlerts } from '@/lib/admin/billing/alerts'
import { BillingAlertsList } from './BillingAlertsList'

/**
 * Open and acknowledged billing risk alerts of one project (ADR-041 D15):
 * disputes, refunds, early fraud warnings. Mounted in the Billing card.
 * Server component; renders NOTHING when there are no alerts, when the table
 * (migration 059) is missing, or when the read fails — it must never break the
 * card. Acknowledge / Resolve are offered only to accounts holding billing.admin
 * (the server actions re-check). Alerts never change access.
 */
export async function BillingAlertsPanel({ projectId }: { projectId: string }) {
  const alerts = await loadProjectBillingAlerts(projectId)
  if (alerts.length === 0) return null
  const [t, actor] = await Promise.all([getTranslations('admin.billing.alerts'), requireBillingAdmin()])
  return (
    <section aria-labelledby="billing-alerts-heading" className="flex flex-col gap-3">
      <BillingAlertsList alerts={alerts} canAct={actor !== null} heading={t('heading')} />
    </section>
  )
}
