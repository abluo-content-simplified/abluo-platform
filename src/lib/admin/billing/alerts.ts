// Server-only: service-role reads behind the admin gate. Never import from a client component.
/**
 * Billing risk alerts (ADR-041 D15, migration 059): disputes, refunds and early
 * fraud warnings. They are information for a billing admin — they never change
 * access. Both readers treat a missing `billing_alerts` table (059 not applied
 * yet) as "no alerts".
 */
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingLivemode } from './queries'

export type BillingAlertKind = 'dispute' | 'refund' | 'early_fraud_warning'
export type BillingAlertStatus = 'open' | 'acknowledged' | 'resolved'

export type BillingAlertView = {
  id: string
  kind: BillingAlertKind
  status: Exclude<BillingAlertStatus, 'resolved'>
  amountCents: number | null
  currency: string | null
  createdAt: string
  acknowledgedAt: string | null
}

/** Is this the "table does not exist" error (059 not applied)? Pure. */
export function isMissingAlertsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /billing_alerts/.test(error.message ?? '') && /(does not exist|schema cache|could not find)/i.test(error.message ?? '')
}

const KINDS: readonly string[] = ['dispute', 'refund', 'early_fraud_warning']

/** Open and acknowledged alerts of one project (directly, or through its subscription for bundles). Requires an Abluo admin; [] when none or 059 is missing. */
export async function loadProjectBillingAlerts(projectId: string): Promise<BillingAlertView[]> {
  const actor = await requireAbluoAdmin()
  if (!actor) return []
  const livemode = billingLivemode()
  const db = createAdminClient()
  try {
    const billing = await db.from('project_billing').select('billing_subscription_id').eq('project_id', projectId).eq('livemode', livemode).maybeSingle()
    const subscriptionId = billing.data?.billing_subscription_id ? String(billing.data.billing_subscription_id) : null
    const scope = subscriptionId ? `project_id.eq.${projectId},subscription_id.eq.${subscriptionId}` : `project_id.eq.${projectId}`
    const { data, error } = await db
      .from('billing_alerts')
      .select('id, kind, status, amount_cents, currency, created_at, acknowledged_at')
      .eq('livemode', livemode)
      .in('status', ['open', 'acknowledged'])
      .or(scope)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      if (!isMissingAlertsTable(error)) console.warn(`[admin/billing] alerts: ${error.message}`)
      return []
    }
    return (data ?? [])
      .filter((r) => KINDS.includes(String(r.kind)))
      .map((r) => ({
        id: String(r.id),
        kind: r.kind as BillingAlertKind,
        status: r.status === 'acknowledged' ? 'acknowledged' : 'open',
        amountCents: typeof r.amount_cents === 'number' ? r.amount_cents : null,
        currency: r.currency ? String(r.currency) : null,
        createdAt: String(r.created_at),
        acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
      }))
  } catch (e) {
    console.warn(`[admin/billing] alerts: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

export type OpenBillingAlert = { id: string; kind: BillingAlertKind; projectId: string | null }

/**
 * Every OPEN alert of this environment's mode with the project it belongs to
 * (directly or through the subscription). Admin Home. Throws on a real read
 * failure; returns [] when 059 is not applied.
 */
export async function loadOpenBillingAlerts(): Promise<OpenBillingAlert[]> {
  const livemode = billingLivemode()
  const db = createAdminClient()
  const { data, error } = await db
    .from('billing_alerts')
    .select('id, kind, project_id, subscription_id')
    .eq('livemode', livemode)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    if (isMissingAlertsTable(error)) return []
    throw new Error(`admin.home.billingAlerts: ${error.message}`)
  }
  const rows = data ?? []
  const viaSubscription = [...new Set(rows.filter((r) => !r.project_id && r.subscription_id).map((r) => String(r.subscription_id)))]
  const projectOf = new Map<string, string>()
  if (viaSubscription.length > 0) {
    const links = await db.from('project_billing').select('project_id, billing_subscription_id').eq('livemode', livemode).in('billing_subscription_id', viaSubscription)
    if (links.error) throw new Error(`admin.home.billingAlerts: ${links.error.message}`)
    for (const l of links.data ?? []) if (!projectOf.has(String(l.billing_subscription_id))) projectOf.set(String(l.billing_subscription_id), String(l.project_id))
  }
  return rows
    .filter((r) => KINDS.includes(String(r.kind)))
    .map((r) => ({
      id: String(r.id),
      kind: r.kind as BillingAlertKind,
      projectId: r.project_id ? String(r.project_id) : r.subscription_id ? (projectOf.get(String(r.subscription_id)) ?? null) : null,
    }))
}
