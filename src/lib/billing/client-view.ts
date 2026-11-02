// Server-only: the client's Billing page data (ADR-041 Phase 5). Service-role reads AFTER the
// permission check — never import from a client component.
import 'server-only'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { billingLivemode } from '@/lib/admin/billing/queries'
import {
  BILLING_PROFILE_COLUMNS,
  BILLING_SUBSCRIPTION_COLUMNS,
  PROJECT_BILLING_COLUMNS,
  toFacts,
  toProfileView,
  toStatusView,
  type BillingProfileRow,
  type BillingSubscriptionRow,
  type ProjectBillingRow,
} from '@/lib/admin/billing/mapping'
import type { BillingProfileView, BillingStatusView } from '@/lib/admin/billing/types'
import { resolveProjectBilling } from '@/lib/billing/lifecycle'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { tenantOfProject } from '@/lib/people/ownership'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { billingAccess, type BillingAccess, type BillingSiteFacts } from './client-access'
import { listInvoices, type InvoiceSummary } from './stripe/service'

export type ClientBillingSite = BillingSiteFacts & {
  projectId: string
  slug: string
  name: string
  amountCents: number | null
  currency: string
  interval: 'month' | 'year' | null
  intervalCount: number
}

/** The client's billing details as the client sees them (all of them: the Owner edits them here). */
export type ClientBillingProfile = BillingProfileView

export type ClientBillingView = {
  livemode: boolean
  access: BillingAccess
  current: ClientBillingSite
  others: ClientBillingSite[]
  /** null = Abluo has not recorded billing details for the client yet. */
  profile: ClientBillingProfile | null
  /** This site's invoices from Stripe, newest first; null = could not be read right now. */
  invoices: InvoiceSummary[] | null
}

function siteOf(
  project: { id: string; slug: string; name: string },
  row: ProjectBillingRow | null,
  sub: BillingSubscriptionRow | null,
  now: Date,
): ClientBillingSite {
  const status: BillingStatusView = toStatusView(resolveProjectBilling(row ? toFacts(row, sub) : null, now))
  const paid = status.reason === 'paid'
  return {
    projectId: project.id,
    slug: project.slug,
    name: project.name,
    status,
    arrangement: row?.arrangement ?? null,
    paidUntil: paid ? (row?.arrangement === 'manual' ? row.manual_paid_through : (sub?.current_period_end ?? null)) : null,
    dueAt: row?.activation_due_at ?? null,
    paymentFailedAt: sub?.payment_failed_at ?? null,
    amountCents: row?.amount_cents ?? null,
    currency: row?.currency ?? 'eur',
    interval: row?.billing_interval ?? null,
    intervalCount: row?.interval_count ?? 1,
  }
}

/**
 * The Billing page of `projectSlug` for the signed-in person, or null when they may not see it
 * (no grant on the project, or neither `billing.manage` nor `billing.invoice.read` on its client)
 * — the caller answers with a 404 either way.
 */
export async function loadClientBillingView(
  ctx: TenantAuthorizationContext,
  projectSlug: string,
  now: Date = new Date(),
  deps: { listInvoices?: (projectId: string) => Promise<InvoiceSummary[]> } = {},
): Promise<ClientBillingView | null> {
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return null
  const livemode = billingLivemode()

  const view = await runAsTrustedSystemOperation('client billing page: billing reads for the signed-in client, after the billing permission check (ADR-041 Phase 5)', async (db) => {
    const tenant = await tenantOfProject(db, grant.projectId)
    if (!tenant) return null
    const access = billingAccess(ctx, tenant.tenantId)
    if (!access.canView) return null

    const { data: projectRows, error: projectsError } = await db.from('projects').select('id, slug, name').eq('tenant_id', tenant.tenantId).order('name')
    if (projectsError) throw new Error(`client billing: projects read failed: ${projectsError.message}`)
    const projects = ((projectRows ?? []) as { id: string; slug: string; name: string | null }[]).map((p) => ({ id: p.id, slug: p.slug, name: p.name?.trim() || p.slug }))
    const ids = projects.map((p) => p.id)

    const [billingRes, profileRes] = await Promise.all([
      db.from('project_billing').select(PROJECT_BILLING_COLUMNS).eq('livemode', livemode).in('project_id', ids),
      db.from('billing_profiles').select(BILLING_PROFILE_COLUMNS).eq('tenant_id', tenant.tenantId).eq('livemode', livemode).maybeSingle(),
    ])
    if (billingRes.error) throw new Error(`client billing: agreements read failed: ${billingRes.error.message}`)
    if (profileRes.error) throw new Error(`client billing: profile read failed: ${profileRes.error.message}`)

    const rows = new Map(((billingRes.data ?? []) as unknown as ProjectBillingRow[]).map((r) => [r.project_id, r]))
    const subIds = [...new Set([...rows.values()].map((r) => r.billing_subscription_id).filter((v): v is string => Boolean(v)))]
    const subs = new Map<string, BillingSubscriptionRow>()
    if (subIds.length) {
      const subRes = await db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).in('id', subIds)
      if (subRes.error) throw new Error(`client billing: subscriptions read failed: ${subRes.error.message}`)
      for (const s of (subRes.data ?? []) as unknown as BillingSubscriptionRow[]) subs.set(s.id, s)
    }

    const sites = projects.map((p) => {
      const row = rows.get(p.id) ?? null
      return siteOf(p, row, row?.billing_subscription_id ? (subs.get(row.billing_subscription_id) ?? null) : null, now)
    })
    const current = sites.find((s) => s.projectId === grant.projectId)
    if (!current) return null

    const profile = profileRes.data ? toProfileView(profileRes.data as BillingProfileRow) : null
    return {
      livemode,
      access,
      current,
      others: sites.filter((s) => s.projectId !== grant.projectId),
      profile: profile
        ? {
            ...profile,
            contactName: profile.customerType === 'business' ? profile.contactName : null,
            vatId: profile.customerType === 'individual' ? null : profile.vatId,
          }
        : null,
      invoices: null as InvoiceSummary[] | null,
    }
  })
  if (!view) return null
  // Invoices come from Stripe, only for people who may see the page (checked above); fail soft.
  if (view.access.canView) {
    try {
      view.invoices = await (deps.listInvoices ?? listInvoices)(grant.projectId)
    } catch (e) {
      console.error('[billing] invoices unavailable', e instanceof Error ? e.message : e)
      view.invoices = null
    }
  }
  return view
}
