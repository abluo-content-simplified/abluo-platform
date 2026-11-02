// Server-only: the payment nudge for the signed-in person (Home card + Billing nav badge).
import 'server-only'
import { cache } from 'react'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { billingLivemode } from '@/lib/admin/billing/queries'
import {
  BILLING_SUBSCRIPTION_COLUMNS,
  PROJECT_BILLING_COLUMNS,
  toFacts,
  type BillingSubscriptionRow,
  type ProjectBillingRow,
} from '@/lib/admin/billing/mapping'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { resolveProjectBilling, type ProjectBillingStatus } from './lifecycle'
import { billingAccess, billingAttention, hasAnyBillingGrant, tenantIdOfGrant, type BillingAttention } from './client-access'
import { projectTenantId } from './project-tenant'

type ProjectBillingFacts = { status: ProjectBillingStatus; arrangement: ProjectBillingRow['arrangement']; dueAt: string | null }

/**
 * One project's billing status, arrangement and first due date — once per
 * request (layout and Home share it). null when the project is not billed,
 * and on ANY read error (fail open: no nudge).
 */
const loadProjectBillingFacts = cache(async (projectId: string): Promise<ProjectBillingFacts | null> => {
  try {
    const livemode = billingLivemode()
    return await runAsTrustedSystemOperation('billing: payment nudge for the signed-in owner (Home card, Billing nav badge)', async (db) => {
      const { data, error } = await db.from('project_billing').select(PROJECT_BILLING_COLUMNS).eq('livemode', livemode).eq('project_id', projectId).maybeSingle()
      if (error || !data) return null
      const row = data as unknown as ProjectBillingRow
      let sub: BillingSubscriptionRow | null = null
      if (row.billing_subscription_id) {
        const subRes = await db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).eq('id', row.billing_subscription_id).maybeSingle()
        if (subRes.error) return null
        sub = (subRes.data as unknown as BillingSubscriptionRow | null) ?? null
      }
      return { status: resolveProjectBilling(toFacts(row, sub), new Date()), arrangement: row.arrangement, dueAt: row.activation_due_at }
    })
  } catch {
    return null
  }
})

/**
 * The payment nudge for this person on this project, or null. Only people who
 * can manage the client's billing (Owner, not in a support visit) are ever
 * nudged, so nothing is read for anyone else. `tenantId`: the project's
 * client when the caller already resolved it.
 */
export async function loadBillingAttention(
  ctx: TenantAuthorizationContext,
  grant: { projectId: string; membershipId: string },
  tenantId?: string | null,
): Promise<BillingAttention | null> {
  if (ctx.support || !hasAnyBillingGrant(ctx)) return null
  const tenant = tenantId ?? tenantIdOfGrant(grant) ?? (await projectTenantId(grant.projectId))
  if (!tenant) return null
  const access = billingAccess(ctx, tenant)
  if (!access.canManage) return null
  const facts = await loadProjectBillingFacts(grant.projectId)
  if (!facts) return null
  return billingAttention({ status: facts.status, arrangement: facts.arrangement, dueAt: facts.dueAt }, access, new Date())
}
