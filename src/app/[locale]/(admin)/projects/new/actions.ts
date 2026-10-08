'use server'

/**
 * Admin "New project" wizard — server actions. Each one calls
 * `requireAbluoAdmin()` (abluo_admin + two-factor, the same decision as the
 * `(admin)` layout gate) BEFORE anything else, and records what it did in the
 * internal admin audit log. Results are small codes the screen maps to
 * localized text (`admin.newProject.errors.*`). See
 * docs/engineering/new-project-wizard.md.
 */
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireAbluoAdmin, type AuthenticatedActor } from '@/lib/api/auth'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { recordAdminAudit } from '@/lib/admin/audit'
import { createInvitation } from '@/lib/invitations/service'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanityServerReadClient, sanityWriteClient } from '@/lib/sanity/server-clients'
import { isUuid, ownerInviteOrigin, validateWizardInput, type ProvisioningRunView, type WizardErrors } from '@/lib/admin/provisioning/model'
import { checkAvailability, checkSlugs, resolvePlanContext } from '@/lib/admin/provisioning/options'
import { planProvisioning } from '@/lib/admin/provisioning/plan'
import { runProvisioning, type RunnerDeps } from '@/lib/admin/provisioning/runner'
import { insertRun, rowToRunView, type RunRow } from '@/lib/admin/provisioning/store'

export type WizardActionError = 'forbidden' | 'invalid' | 'not_set_up' | 'taken' | 'busy' | 'not_found' | 'failed'

export type CheckResult = { ok: true; errors: WizardErrors } | { ok: false; error: WizardActionError }
export type RunActionResult = { ok: true; run: ProvisioningRunView } | { ok: false; error: WizardActionError; fields?: WizardErrors; run?: ProvisioningRunView }

async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
    return host ? `${proto}://${host}` : null // restricted to Abluo hosts by invitationOrigin()
  } catch {
    return null
  }
}

async function runnerDeps(): Promise<RunnerDeps> {
  const [ctx, origin] = await Promise.all([getTenantAuthorizationContext(), requestOrigin()])
  return {
    db: createAdminClient(),
    sanity: {
      getDocument: (id) => sanityWriteClient.getDocument(id) as Promise<Record<string, unknown> | undefined>,
      createIfNotExists: (doc) => sanityWriteClient.createIfNotExists(doc),
    },
    inviteOwner: async (invite, tenantId) => {
      if (!ctx) return { ok: false, error: 'forbidden' }
      const r = await createInvitation(ctx, {
        target: { scope: 'tenant', tenantId },
        email: invite.email,
        role: invite.role,
        locale: invite.locale,
        requestOrigin: ownerInviteOrigin(origin),
        // This request passed requireAbluoAdmin() (Super Admin, 2FA): only Super Admin creates a client's first Owner (ADR-028 §4).
        adminAssured: true,
      })
      return r.ok ? { ok: true, invitationId: r.id, emailSent: r.emailSent } : { ok: false, error: r.error }
    },
  }
}

async function auditOutcome(actor: AuthenticatedActor, row: RunRow) {
  const projectRowExists = row.steps?.['supabase.project']?.status === 'done'
  await recordAdminAudit({
    actorId: actor.userId,
    action: row.status === 'completed' ? 'project.provision.complete' : 'project.provision.fail',
    projectId: projectRowExists ? row.project_id : null,
    detail: { runId: row.id, projectSlug: row.project_slug, ...(row.status === 'completed' ? {} : { step: row.current_step }) },
  })
}

/** "Next" on the client and project steps: format, reserved words and uniqueness (Supabase + Sanity). */
export async function checkWizardSlugsAction(input: { clientSlug?: string | null; projectSlug?: string | null; tenantId?: string | null }): Promise<CheckResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const tenantId = isUuid(input?.tenantId) ? input.tenantId : null
  const clientSlug = typeof input?.clientSlug === 'string' ? input.clientSlug : null
  const projectSlug = typeof input?.projectSlug === 'string' ? input.projectSlug : null
  await recordAdminAudit({ actorId: actor.userId, action: 'project.provision.check', detail: { clientSlug, projectSlug } })
  const r = await checkSlugs(createAdminClient(), sanityServerReadClient, { clientSlug, projectSlug, tenantId })
  return r.ok ? r : { ok: false, error: 'failed' }
}

/** "Create" on the review step: validate, check, plan, record the run, execute it. */
export async function startProvisioningAction(raw: unknown): Promise<RunActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }

  const v = validateWizardInput(raw)
  if (!v.ok) return { ok: false, error: 'invalid', fields: v.errors }
  const input = v.value
  const db = createAdminClient()

  const available = await checkAvailability(db, sanityServerReadClient, input)
  if (!available.ok) return 'errors' in available ? { ok: false, error: 'invalid', fields: available.errors } : { ok: false, error: 'failed' }

  const resolved = await resolvePlanContext(db, sanityServerReadClient, input, randomUUID)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const plan = planProvisioning(input, resolved.ctx)

  const inserted = await insertRun(db, {
    tenant_mode: input.client.mode,
    tenant_id: plan.tenantId,
    tenant_slug: plan.tenantSlug,
    project_id: plan.projectId,
    project_slug: plan.projectSlug,
    input: { ...input, tenantName: resolved.ctx.tenant.name },
    plan,
    created_by: actor.userId,
  })
  if (!inserted.ok) return inserted.error === 'taken' ? { ok: false, error: 'invalid', fields: { projectSlug: 'taken' } } : { ok: false, error: inserted.error }

  await recordAdminAudit({
    actorId: actor.userId,
    action: 'project.provision.start',
    detail: { runId: inserted.row.id, projectSlug: plan.projectSlug, tenantSlug: plan.tenantSlug, tenantMode: input.client.mode, designSystemId: input.designSystemId },
  })

  const result = await runProvisioning(inserted.row.id, await runnerDeps())
  revalidatePath('/[locale]/projects', 'page')
  if (!result.ok) return { ok: false, error: result.error, run: result.row ? rowToRunView(result.row) : rowToRunView(inserted.row) }
  await auditOutcome(actor, result.row)
  return { ok: true, run: rowToRunView(result.row) }
}

/** "Retry" on a failed (or interrupted) run: resumes at the first step not done. */
export async function retryProvisioningAction(runId: unknown): Promise<RunActionResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (!isUuid(runId)) return { ok: false, error: 'not_found' }
  await recordAdminAudit({ actorId: actor.userId, action: 'project.provision.retry', detail: { runId } })

  const result = await runProvisioning(runId, await runnerDeps())
  revalidatePath('/[locale]/projects', 'page')
  if (!result.ok) return { ok: false, error: result.error, run: result.row ? rowToRunView(result.row) : undefined }
  await auditOutcome(actor, result.row)
  return { ok: true, run: rowToRunView(result.row) }
}
