// Server-only. Billing status of projects for the authorization context (ADR-041 D8).
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

/**
 * Billing status of each given project for this environment's mode (service
 * role, project ids in → statuses out). Projects without a billing record are
 * absent. Throws on read error — callers fail OPEN (ADR-041 D8). Grants nothing.
 */
export async function loadProjectBillingStatuses(projectIds: readonly string[], now: Date = new Date()): Promise<Map<string, ProjectBillingStatus>> {
  const out = new Map<string, ProjectBillingStatus>()
  const ids = [...new Set(projectIds)]
  if (ids.length === 0) return out
  const livemode = billingLivemode()
  return runAsTrustedSystemOperation('billing: project billing status for the authorization context (ADR-041 D8)', async (db) => {
    const { data, error } = await db.from('project_billing').select(PROJECT_BILLING_COLUMNS).eq('livemode', livemode).in('project_id', ids)
    if (error) throw new Error(`billing: status read failed: ${error.message}`)
    const rows = (data ?? []) as unknown as ProjectBillingRow[]
    const subIds = [...new Set(rows.map((r) => r.billing_subscription_id).filter((v): v is string => Boolean(v)))]
    const subs = new Map<string, BillingSubscriptionRow>()
    if (subIds.length) {
      const subRes = await db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).in('id', subIds)
      if (subRes.error) throw new Error(`billing: subscription read failed: ${subRes.error.message}`)
      for (const s of (subRes.data ?? []) as unknown as BillingSubscriptionRow[]) subs.set(s.id, s)
    }
    for (const row of rows) {
      out.set(row.project_id, resolveProjectBilling(toFacts(row, row.billing_subscription_id ? (subs.get(row.billing_subscription_id) ?? null) : null), now))
    }
    return out
  })
}
