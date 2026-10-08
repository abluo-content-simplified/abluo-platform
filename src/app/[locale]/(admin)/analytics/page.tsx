import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { PortfolioBrowser } from '@/components/admin/analytics/PortfolioBrowser'
import { getAdminPortfolio } from '@/lib/admin/analytics'

export const dynamic = 'force-dynamic'

/**
 * Admin → Analytics (ADR-030 §5.2): every live and preview site in one list —
 * visitors (7 and 28 days), trend, search clicks, top channel, contact
 * requests and the data status — fed by the daily snapshots (migration 036),
 * never by live Google calls. Gated by the (admin) layout AND
 * requireAbluoAdmin() inside getAdminPortfolio; the view is audited.
 */
export default async function AdminAnalyticsPage() {
  const portfolio = await getAdminPortfolio({ audit: true })
  if (!portfolio) notFound()
  const t = await getTranslations('admin.analytics')

  return (
    <PageShell>
      <div className="space-y-1">
        <PageHeader title={t('title')} />
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {!portfolio.ready ? (
        <EmptyState title={t('notReadyTitle')} body={t('notReadyBody')} />
      ) : portfolio.rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <PortfolioBrowser rows={portfolio.rows} />
      )}
    </PageShell>
  )
}
