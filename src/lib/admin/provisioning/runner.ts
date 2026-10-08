// Server-only: writes Supabase (service role) and Sanity (write token); never import from a client component.
/**
 * Executes a provisioning run: the stored plan's steps in order, each one
 * idempotent, progress saved after every step. A failure stops the run at that
 * step (status `failed`); "Retry" claims the run again and resumes at the
 * first step not done. Nothing is ever deleted — a retry only creates what is
 * still missing.
 *
 * Idempotency per step:
 *   • Supabase rows — read by the planned id first; present → verified
 *     (slug/tenant must match, else `conflict`) and done; absent → insert.
 *     A unique violation (someone took the slug meanwhile) → `conflict`.
 *   • Sanity documents — deterministic ids; read first; present → verified
 *     (type and owner must match, else `conflict`) and done; absent →
 *     `createIfNotExists`. Documents are written PUBLISHED, in dependency
 *     order (Sanity refuses a reference to a document that does not exist
 *     yet, even inside one transaction).
 *   • Owner invitation — runs once; its id is kept in the step result. A retry
 *     after a failure creates a fresh invitation (createInvitation cancels the
 *     pending one for the same person and client).
 *
 * Callers MUST have passed `requireAbluoAdmin()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProvisionStepId, StepState } from './model'
import type { ProvisioningPlan } from './plan'
import { claimRun, loadRun, saveProgress, type RunRow, type StoreError } from './store'

export type SanityWriter = {
  getDocument: (id: string) => Promise<Record<string, unknown> | undefined | null>
  createIfNotExists: (doc: Record<string, unknown> & { _id: string; _type: string }) => Promise<unknown>
}

export type InviteOwner = (
  invite: NonNullable<ProvisioningPlan['invite']>,
  tenantId: string
) => Promise<{ ok: true; invitationId: string; emailSent: boolean } | { ok: false; error: string }>

export type RunnerDeps = {
  db: SupabaseClient
  sanity: SanityWriter
  inviteOwner: InviteOwner
  now?: () => Date
}

type Outcome = { ok: true; result?: Record<string, unknown> } | { ok: false; error: string; message?: string }

const fail = (error: string, message?: string): Outcome => ({ ok: false, error, message })
const done = (result?: Record<string, unknown>): Outcome => ({ ok: true, result })

async function ensureSupabaseRow(
  db: SupabaseClient,
  table: 'tenants' | 'projects',
  row: Record<string, unknown> & { id: string },
  same: (existing: Record<string, unknown>) => boolean
): Promise<Outcome> {
  const { data: existing, error: readError } = await db.from(table).select('*').eq('id', row.id).maybeSingle()
  if (readError) return fail('failed', readError.message)
  if (existing) return same(existing as Record<string, unknown>) ? done({ existed: true }) : fail('conflict', `${table} ${row.id} exists with different data`)
  const { error } = await db.from(table).insert(row)
  if (error) return error.code === '23505' ? fail('conflict', error.message) : fail('failed', error.message)
  return done()
}

async function ensureSanityDoc(
  sanity: SanityWriter,
  doc: Record<string, unknown> & { _id: string; _type: string },
  ownerKey: 'projectSlug' | 'tenantId'
): Promise<Outcome> {
  const existing = await sanity.getDocument(doc._id)
  if (existing) {
    const same = existing._type === doc._type && existing[ownerKey] === doc[ownerKey]
    return same ? done({ existed: true }) : fail('conflict', `Sanity document ${doc._id} exists for another ${ownerKey === 'tenantId' ? 'client' : 'project'}`)
  }
  await sanity.createIfNotExists(doc)
  return done()
}

/** One step. Exported for tests. */
export async function executeStep(step: ProvisionStepId, plan: ProvisioningPlan, deps: RunnerDeps): Promise<Outcome> {
  const { db, sanity } = deps
  switch (step) {
    case 'supabase.tenant': {
      const t = plan.supabase.tenant
      if (t.mode === 'existing') {
        const { data, error } = await db.from('tenants').select('id').eq('id', t.id).maybeSingle()
        if (error) return fail('failed', error.message)
        return data ? done({ existed: true }) : fail('not_found', `client ${t.id} not found`)
      }
      return ensureSupabaseRow(db, 'tenants', t.row, (e) => e.slug === t.row.slug)
    }
    case 'supabase.project': {
      const r = plan.supabase.project.row
      return ensureSupabaseRow(db, 'projects', r, (e) => e.slug === r.slug && e.tenant_id === r.tenant_id)
    }
    case 'sanity.client': {
      const c = plan.sanity.client
      if (c.mode === 'existing') {
        const existing = await sanity.getDocument(c.id)
        if (!existing) return fail('not_found', `Sanity client document ${c.id} not found`)
        return existing.tenantId === plan.tenantId ? done({ existed: true }) : fail('conflict', `Sanity client document ${c.id} belongs to another client`)
      }
      return ensureSanityDoc(sanity, c.doc, 'tenantId')
    }
    case 'sanity.designSystem':
      return ensureSanityDoc(sanity, plan.sanity.designSystem, 'projectSlug')
    case 'sanity.project':
      return ensureSanityDoc(sanity, plan.sanity.project, 'projectSlug')
    case 'sanity.siteConfig':
      return ensureSanityDoc(sanity, plan.sanity.siteConfig, 'projectSlug')
    case 'sanity.homePage':
      return ensureSanityDoc(sanity, plan.sanity.homePage, 'projectSlug')
    case 'invite.owner': {
      if (!plan.invite) return done({ skipped: true })
      const r = await deps.inviteOwner(plan.invite, plan.tenantId)
      return r.ok ? done({ invitationId: r.invitationId, emailSent: r.emailSent }) : fail(r.error, `invitation not created: ${r.error}`)
    }
  }
}

export type RunResult = { ok: true; row: RunRow } | { ok: false; error: StoreError | 'busy'; row?: RunRow }

/**
 * Claims the run and executes every step not yet done. Returns the run as
 * saved (completed, or failed at one step).
 */
export async function runProvisioning(runId: string, deps: RunnerDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date())
  const loaded = await loadRun(deps.db, runId)
  if (!loaded.ok) return loaded
  if (loaded.row.status === 'completed') return { ok: true, row: loaded.row }
  const claimed = await claimRun(deps.db, loaded.row, now())
  if (!claimed) return { ok: false, error: 'busy', row: loaded.row }

  const plan = claimed.plan
  const steps: Partial<Record<ProvisionStepId, StepState>> = { ...(claimed.steps ?? {}) }
  for (const step of plan.steps) {
    const prev = steps[step]
    if (prev?.status === 'done' || prev?.status === 'skipped') continue
    await saveProgress(deps.db, runId, { current_step: step })

    let outcome: Outcome
    try {
      outcome = await executeStep(step, plan, deps)
    } catch (e) {
      outcome = fail('failed', e instanceof Error ? e.message : String(e))
    }
    const at = now().toISOString()
    if (!outcome.ok) {
      steps[step] = { status: 'failed', at, error: outcome.error, ...(outcome.message ? { message: outcome.message.slice(0, 1000) } : {}) }
      const lastError = `${step}: ${outcome.message ?? outcome.error}`.slice(0, 2000)
      await saveProgress(deps.db, runId, { status: 'failed', steps, current_step: step, last_error: lastError })
      return { ok: true, row: { ...claimed, status: 'failed', steps, current_step: step, last_error: lastError } }
    }
    steps[step] = { status: outcome.result?.skipped ? 'skipped' : 'done', at, ...(outcome.result ? { result: outcome.result } : {}) }
    if (!(await saveProgress(deps.db, runId, { steps }))) {
      // The step happened but its record did not: stop here; the retry re-verifies it (idempotent) and moves on.
      await saveProgress(deps.db, runId, { status: 'failed', last_error: `${step}: progress not saved` })
      return { ok: false, error: 'failed', row: { ...claimed, status: 'failed', steps } }
    }
  }

  const completedAt = now().toISOString()
  await saveProgress(deps.db, runId, { status: 'completed', steps, current_step: null, last_error: null, completed_at: completedAt })
  return { ok: true, row: { ...claimed, status: 'completed', steps, current_step: null, last_error: null, completed_at: completedAt } }
}
