import { getTranslations } from 'next-intl/server'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { loadProjectBilling } from '@/lib/admin/billing/queries'
import type { ProjectBillingView } from '@/lib/admin/billing/types'
import { BillingCardView } from './BillingCardView'

/**
 * "Billing" on the admin project page (ADR-041 Phase 2): the agreed terms, the
 * computed state and the client's billing contact. Server component: loads the
 * view (requireAbluoAdmin runs inside) and never breaks the page — a failed
 * load shows a calm notice in place of the card.
 */
export async function BillingCard({ projectId }: { projectId: string }) {
  const t = await getTranslations('admin.billing')
  let view: ProjectBillingView | null = null
  let failed = false
  try {
    view = await loadProjectBilling(projectId)
  } catch (e) {
    failed = true
    console.warn(`[admin/billing] card: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!failed && !view) return null
  return failed || !view ? (
    <section id="billing" aria-labelledby="billing-heading" className="flex scroll-mt-6 flex-col gap-3">
      <SectionHeading id="billing-heading" title={t('heading')} />
      <Notice tone="error">{t('loadError')}</Notice>
    </section>
  ) : (
    <BillingCardView view={view} />
  )
}
