// Server-only: service-role reads/writes of a server-only table; never import from a client component.
/**
 * `project_provisioning_runs` (migration 037) — the record of every "New
 * project" run and its per-step progress. Server-only table (RLS on, no
 * grants to API roles); every caller has passed `requireAbluoAdmin()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingTableError } from '@/lib/admin/backlog-model'
import { PROVISION_STEPS, type ProvisionStepId, type ProvisioningRunView, type RunStatus, type StepState } from './model'
import type { ProvisioningPlan } from './plan'

export const RUNS_TABLE = 'project_provisioning_runs'

/** A run left `running` longer than this (a crashed request) may be claimed again. */
export const STALE_RUN_MS = 2 * 60 * 1000

export type RunRow = {
  id: string
  status: RunStatus
  tenant_mode: 'existing' | 'new'
  tenant_id: string
  tenant_slug: string
  project_id: string
  project_slug: string
  input: Record<string, unknown>
  plan: ProvisioningPlan
  steps: Partial<Record<ProvisionStepId, StepState>>
  current_step: string | null
  last_error: string | null
  attempts: number
  created_by: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type StoreError = 'not_set_up' | 'taken' | 'not_found' | 'failed'

type DbError = { code?: string | null; message?: string | null } | null

export function storeError(error: DbError): StoreError {
  if (isMissingTableError(error)) return 'not_set_up'
  if (error?.code === '23505') return 'taken'
  return 'failed'
}

const isStep = (s: string): s is ProvisionStepId => (PROVISION_STEPS as readonly string[]).includes(s)

/** Pure: a run row → what the wizard screen shows. */
export function rowToRunView(row: RunRow): ProvisioningRunView {
  const plan = row.plan
  // `input` is the validated wizard input plus `tenantName` (the client's name as read at start).
  const input = (row.input ?? {}) as { tenantName?: string; project?: { name?: string } }
  const tenantName = String(input.tenantName || row.tenant_slug)
  const steps: ProvisioningRunView['steps'] = {}
  for (const [k, v] of Object.entries(row.steps ?? {})) if (isStep(k) && v) steps[k] = v
  return {
    id: row.id,
    status: row.status,
    tenantMode: row.tenant_mode,
    tenantSlug: row.tenant_slug,
    tenantName,
    projectSlug: row.project_slug,
    projectName: String(plan?.supabase?.project?.row?.name ?? input.project?.name ?? row.project_slug),
    ownerEmail: plan?.invite?.email ?? null,
    steps,
    plannedSteps: (plan?.steps ?? []).filter(isStep),
    lastError: row.last_error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export async function loadRun(db: SupabaseClient, id: string): Promise<{ ok: true; row: RunRow } | { ok: false; error: StoreError }> {
  const { data, error } = await db.from(RUNS_TABLE).select('*').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: storeError(error) }
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, row: data as RunRow }
}

/** Runs that have not finished (newest first) — shown on the wizard page so an interrupted setup is never lost. */
export async function listUnfinishedRuns(db: SupabaseClient): Promise<{ ok: true; rows: RunRow[] } | { ok: false; error: StoreError }> {
  const { data, error } = await db
    .from(RUNS_TABLE)
    .select('*')
    .in('status', ['pending', 'running', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) return { ok: false, error: storeError(error) }
  return { ok: true, rows: (data ?? []) as RunRow[] }
}

/** True when a pending/running/completed run already holds this project slug. */
export async function slugHeldByRun(db: SupabaseClient, projectSlug: string): Promise<boolean | StoreError> {
  const { data, error } = await db.from(RUNS_TABLE).select('id').eq('project_slug', projectSlug).in('status', ['pending', 'running', 'completed']).limit(1)
  if (error) return storeError(error)
  return (data ?? []).length > 0
}

export async function insertRun(
  db: SupabaseClient,
  run: Pick<RunRow, 'tenant_mode' | 'tenant_id' | 'tenant_slug' | 'project_id' | 'project_slug' | 'input' | 'plan' | 'created_by'>
): Promise<{ ok: true; row: RunRow } | { ok: false; error: StoreError; message?: string }> {
  const { data, error } = await db.from(RUNS_TABLE).insert(run).select('*').single()
  if (error || !data) return { ok: false, error: storeError(error), message: error?.message ?? undefined }
  return { ok: true, row: data as RunRow }
}

/**
 * Atomically claims a run for execution: pending or failed → running, or a
 * `running` run whose request died (no update for STALE_RUN_MS). Two clicks on
 * Retry cannot execute the same run twice at once. Null → not claimable now.
 */
export async function claimRun(db: SupabaseClient, row: RunRow, now: Date): Promise<RunRow | null> {
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS).toISOString()
  const { data, error } = await db
    .from(RUNS_TABLE)
    .update({ status: 'running', attempts: (row.attempts ?? 0) + 1, last_error: null })
    .eq('id', row.id)
    .or(`status.in.(pending,failed),and(status.eq.running,updated_at.lt."${staleBefore}")`)
    .select('*')
    .maybeSingle()
  if (error || !data) return null
  return data as RunRow
}

export async function saveProgress(
  db: SupabaseClient,
  id: string,
  patch: Partial<Pick<RunRow, 'status' | 'steps' | 'current_step' | 'last_error' | 'completed_at'>>
): Promise<boolean> {
  const { error } = await db.from(RUNS_TABLE).update(patch).eq('id', id)
  if (error) console.warn(`provisioning: progress not saved for run ${id}: ${error.message}`)
  return !error
}
