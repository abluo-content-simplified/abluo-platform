// Server-only: service-role reads behind the admin gate. Never import from a client component.
import { requireAbluoAdmin } from '@/lib/api/auth'
import { readAccounts } from '@/lib/api/admin-dashboard/shared'
import { resolveAccessEnvironment } from '@/lib/access/environment'
import { resolveProjectBilling } from '@/lib/billing/lifecycle'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBillingAdmin } from './access'
import {
  BILLING_PROFILE_COLUMNS,
  BILLING_SUBSCRIPTION_COLUMNS,
  PROJECT_BILLING_COLUMNS,
  summarise,
  toAgreementView,
  toFacts,
  toProfileView,
  toStatusView,
  toSubscriptionView,
  type BillingProfileRow,
  type BillingSubscriptionRow,
  type ProjectBillingRow,
} from './mapping'
import type { ProjectBillingSummary, ProjectBillingView } from './types'

/** Is this environment's billing data live (production) or test data? ADR-041 D6. */
export function billingLivemode(): boolean {
  return resolveAccessEnvironment() === 'production'
}

/** Full billing view of one project for the admin project page. null = project not found. Requires an Abluo admin. */
export async function loadProjectBilling(projectId: string): Promise<ProjectBillingView | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const livemode = billingLivemode()
  const db = createAdminClient()

  const { data: project, error: projectError } = await db.from('projects').select('id, tenant_id').eq('id', projectId).maybeSingle()
  if (projectError) throw new Error(`billing: project read failed: ${projectError.message}`)
  if (!project?.tenant_id) return null
  const tenantId = project.tenant_id as string

  const [billingRes, profileRes, othersRes, auditRes, profileAuditRes] = await Promise.all([
    db.from('project_billing').select(PROJECT_BILLING_COLUMNS).eq('project_id', projectId).eq('livemode', livemode).maybeSingle(),
    db.from('billing_profiles').select(BILLING_PROFILE_COLUMNS).eq('tenant_id', tenantId).eq('livemode', livemode).maybeSingle(),
    db.from('projects').select('id, name, slug').eq('tenant_id', tenantId).neq('id', projectId).order('name'),
    db
      .from('admin_audit_log')
      .select('action, occurred_at, actor_id')
      .eq('project_id', projectId)
      .like('action', 'billing.%')
      .order('occurred_at', { ascending: false })
      .limit(1),
    // The client's billing details are shared by its projects: a profile change counts as a change here too.
    db
      .from('admin_audit_log')
      .select('action, occurred_at, actor_id')
      .eq('action', 'billing.profile.set')
      .eq('detail->>tenantId', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(1),
  ])
  if (billingRes.error) throw new Error(`billing: agreement read failed: ${billingRes.error.message}`)
  if (profileRes.error) throw new Error(`billing: profile read failed: ${profileRes.error.message}`)
  if (othersRes.error) throw new Error(`billing: projects read failed: ${othersRes.error.message}`)

  const row = (billingRes.data as ProjectBillingRow | null) ?? null
  let sub: BillingSubscriptionRow | null = null
  if (row?.billing_subscription_id) {
    const { data, error } = await db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).eq('id', row.billing_subscription_id).maybeSingle()
    if (error) throw new Error(`billing: subscription read failed: ${error.message}`)
    sub = (data as BillingSubscriptionRow | null) ?? null
  }

  // Audit is context only: a failed read leaves the line out rather than the page down.
  type AuditRow = { action: string; occurred_at: string; actor_id: string | null }
  const candidates = [auditRes, profileAuditRes].flatMap((r) => (r.error ? [] : ((r.data ?? []) as AuditRow[]).slice(0, 1)))
  const last = candidates.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0]
  let lastChange: ProjectBillingView['lastChange'] = null
  if (last) {
    const actorEmail = last.actor_id ? ((await readAccounts(db, [last.actor_id])).get(last.actor_id)?.email || null) : null
    lastChange = { action: last.action, at: new Date(last.occurred_at).toISOString(), actorEmail }
  }

  return {
    projectId,
    tenantId,
    livemode,
    status: toStatusView(resolveProjectBilling(row ? toFacts(row, sub) : null, new Date())),
    agreement: row ? toAgreementView(row) : null,
    subscription: sub ? toSubscriptionView(sub) : null,
    profile: profileRes.data ? toProfileView(profileRes.data as BillingProfileRow) : null,
    otherProjects: ((othersRes.data ?? []) as { id: string; name: string; slug: string }[]).map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    lastChange,
    canEdit: (await requireBillingAdmin()) !== null,
  }
}

/** Billing summary per project id, for the Projects list and Admin Home. Projects without a record are absent. Caller is already admin-gated. */
export async function loadBillingSummaries(now: Date = new Date()): Promise<Map<string, ProjectBillingSummary>> {
  const out = new Map<string, ProjectBillingSummary>()
  const livemode = billingLivemode()
  const db = createAdminClient()
  // Two reads in total, however many projects: agreements + the (small) set of subscriptions of this mode.
  const [rowsRes, subsRes] = await Promise.all([
    db.from('project_billing').select(PROJECT_BILLING_COLUMNS).eq('livemode', livemode),
    db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).eq('livemode', livemode),
  ])
  if (rowsRes.error || subsRes.error) {
    // Not swallowed: callers (Projects list, Admin Home) mark their billing attention incomplete.
    throw new Error(`billing: summaries not loaded: ${(rowsRes.error ?? subsRes.error)?.message}`)
  }
  const subs = new Map(((subsRes.data ?? []) as BillingSubscriptionRow[]).map((s) => [s.id, s]))
  for (const row of (rowsRes.data ?? []) as ProjectBillingRow[]) {
    out.set(row.project_id, summarise(row, row.billing_subscription_id ? (subs.get(row.billing_subscription_id) ?? null) : null, now))
  }
  return out
}
