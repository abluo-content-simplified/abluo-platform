import { notFound, redirect } from 'next/navigation'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { loadClientBillingView } from '@/lib/billing/client-view'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { BillingScreen } from '@/components/client/billing/BillingScreen'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Billing (ADR-041 Phase 5; Tom approved 2026-11-02). Opens for people holding
 * `billing.manage` (the Owner) or `billing.invoice.read` on the site's client; anyone else gets a
 * 404, exactly like a page that does not exist. These are tenant-scope permissions, which billing
 * locks never strip — this page is the "Pay Now" destination of the payment notice.
 */
export const dynamic = 'force-dynamic'

async function BillingPageInner({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ checkout?: string | string[] }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/billing`)
  if (!resolveProjectGrant(ctx.projects, projectSlug)) notFound()

  const view = await span('loadClientBillingView', () => loadClientBillingView(ctx, projectSlug))
  if (!view) notFound()

  const raw = (await searchParams).checkout
  const value = Array.isArray(raw) ? raw[0] : raw
  const checkout = value === 'success' || value === 'cancel' ? value : null

  return (
    <PageShell>
      <BillingScreen projectSlug={projectSlug} view={view} checkout={checkout} />
      {perfBeacon()}
    </PageShell>
  )
}

export default function BillingPage(props: Parameters<typeof BillingPageInner>[0]) {
  return traced('billing.page', () => BillingPageInner(props))
}
