/**
 * Submission service — ADR-018 slice 1.
 *
 * The two anonymous write paths (create + step-complete) as pure-ish service
 * functions the route handlers call. Both run under the service-role client via
 * `runAsTrustedSystemOperation` — anonymous visitors have no session, and RLS
 * has no anon policy on `form_submissions` (ADR-018 §16). Tenant/project are
 * resolved SERVER-SIDE from the route's `projectSlug` and never trusted from the
 * body (§18).
 *
 * The submission is the source of truth. On finalize we persist first, then
 * write the provider-agnostic `form.submitted` row to the `form_events` outbox
 * — Forms calls no delivery provider (ADR-018 Decision 9); ADR-019 delivers.
 */
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { runSpamChecks } from '@/lib/forms/spam'
import { issueStepToken, tokensMatch, isTokenExpired } from '@/lib/forms/tokens'
import {
  resolveDefinition,
  resolveDefinitionSnapshot,
  isMultiStep,
  firstStep,
  findStep,
  isFinalStep,
  nextStepKey,
  validateStep,
  whitelistStepValues,
  type FormDefinition,
} from '@/lib/forms/definitions'

const SPAM_OPTS = { table: 'form_submissions', ipColumn: 'submitter_ip' } as const

// ── Result types (routes translate these to HTTP) ──────────────────────────────

export type SubmissionResult =
  | { ok: true; done: boolean; submissionId: string; completionToken?: string; nextStepKey?: string | null }
  | { ok: true; spam: true }
  | { ok: false; status: number; error: string; errors?: Record<string, string> }

export interface CreateSubmissionInput {
  projectSlug: string
  formId: string
  locale?: string
  source?: Record<string, unknown>
  context?: Record<string, unknown>
  data?: Record<string, unknown>
  gdprConsent?: boolean
  ip: string
  honeypot?: string
  openedAt?: number
}

export interface CompleteStepInput {
  projectSlug: string
  formId: string
  submissionId: string
  completionToken?: string
  stepKey: string
  data?: Record<string, unknown>
  gdprConsent?: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Resolves { tenantId, projectId } from a projects.slug; both null if unknown (platform-level). */
async function resolveProjectScope(
  supabase: { from: (t: string) => any },
  projectSlug: string,
): Promise<{ tenantId: string | null; projectId: string | null }> {
  const { data } = await supabase
    .from('projects')
    .select('id, tenant_id')
    .eq('slug', projectSlug)
    .maybeSingle()
  return { tenantId: (data?.tenant_id as string) ?? null, projectId: (data?.id as string) ?? null }
}

/** Sanitizes placement Context to only the definition's contextMappable field keys (§18). */
function sanitizeContext(def: FormDefinition, context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {}
  const mappable = new Set(
    def.steps.flatMap((s) => s.fields.filter((f) => f.contextMappable).map((f) => f.key)),
  )
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (mappable.has(k)) out[k] = v
  }
  return out
}

// ── Create ──────────────────────────────────────────────────────────────────────

export async function createSubmission(input: CreateSubmissionInput): Promise<SubmissionResult> {
  const def = resolveDefinition(input.formId)
  if (!def) return { ok: false, status: 404, error: 'unknown form' }

  return runAsTrustedSystemOperation(
    'Anonymous public form submission (create) — the submitter is a website visitor with no ' +
      'session. Covers the per-IP rate-limit count, the projects slug lookup, the ' +
      'form_submissions INSERT, and (single-step forms) the form_events outbox INSERT.',
    async (supabase): Promise<SubmissionResult> => {
      // Spam (silent 200 on block — never reveal which check fired).
      const spam = await runSpamChecks(
        { honeypot: input.honeypot, openedAt: input.openedAt, ip: input.ip },
        supabase,
        SPAM_OPTS,
      )
      if (spam.blocked) return { ok: true, spam: true }

      const step = firstStep(def)
      const values = whitelistStepValues(def, step.key, input.data ?? {})
      const errors = validateStep(def, step.key, values)

      const finalOnCreate = isFinalStep(def, step.key) // single-step form
      if (finalOnCreate && def.requiresConsentAtFinalStep && input.gdprConsent !== true) {
        errors._consent = 'required'
      }
      if (Object.keys(errors).length > 0) {
        return { ok: false, status: 400, error: 'validation failed', errors }
      }

      const { tenantId, projectId } = await resolveProjectScope(supabase, input.projectSlug)
      const snapshot = resolveDefinitionSnapshot(def)
      const now = Date.now()

      const multi = isMultiStep(def)
      const token = multi && !finalOnCreate ? issueStepToken(now) : null
      const gdprConsent = finalOnCreate && input.gdprConsent === true

      const { data: inserted, error } = await supabase
        .from('form_submissions')
        .insert({
          tenant_id: tenantId,
          project_id: projectId,
          form_id: def.formId,
          form_version: def.version,
          definition_snapshot: snapshot,
          locale: input.locale ?? 'en',
          source: input.source ?? {},
          context: sanitizeContext(def, input.context),
          submission_data: values,
          status: 'new',
          completion_state: finalOnCreate ? 'complete' : 'partial',
          gdpr_consent: gdprConsent,
          gdpr_consent_at: gdprConsent ? new Date(now).toISOString() : null,
          step_token_hash: token?.hash ?? null,
          step_token_expires_at: token?.expiresAt ?? null,
          submitter_ip: input.ip,
        })
        .select('id')
        .single()

      if (error || !inserted) {
        console.error('[forms.createSubmission] insert error:', error?.code, error?.message)
        return { ok: false, status: 500, error: 'failed to save submission' }
      }

      if (finalOnCreate) {
        await emitSubmittedEvent(supabase, {
          tenantId, projectId, def, submissionId: inserted.id as string, locale: input.locale ?? 'en',
        })
        return { ok: true, done: true, submissionId: inserted.id as string }
      }

      return {
        ok: true,
        done: false,
        submissionId: inserted.id as string,
        completionToken: token!.token,
        nextStepKey: nextStepKey(def, step.key),
      }
    },
  )
}

// ── Complete a step ───────────────────────────────────────────────────────────

export async function completeStep(input: CompleteStepInput): Promise<SubmissionResult> {
  const def = resolveDefinition(input.formId)
  if (!def) return { ok: false, status: 404, error: 'unknown form' }
  if (!findStep(def, input.stepKey)) return { ok: false, status: 400, error: 'unknown step' }
  if (!/^[0-9a-f-]{36}$/.test(input.submissionId)) return { ok: false, status: 400, error: 'invalid id' }

  return runAsTrustedSystemOperation(
    'Anonymous public form submission (step completion) — the submitter is a website visitor ' +
      'with no session, advancing a partial submission with a single-use rotating token. Covers ' +
      'the form_submissions SELECT + UPDATE and (on finalize) the form_events outbox INSERT.',
    async (supabase): Promise<SubmissionResult> => {
      const { data: row, error: fetchErr } = await supabase
        .from('form_submissions')
        .select('id, form_id, completion_state, step_token_hash, step_token_expires_at, submission_data, definition_snapshot, form_version, tenant_id, project_id, locale')
        .eq('id', input.submissionId)
        .maybeSingle()

      if (fetchErr) {
        console.error('[forms.completeStep] fetch error:', fetchErr.code, fetchErr.message)
        return { ok: false, status: 500, error: 'failed to load submission' }
      }
      if (!row) return { ok: false, status: 404, error: 'not found' }

      // Guard: right form, still partial, token matches, not expired.
      if (row.form_id !== def.formId) return { ok: false, status: 404, error: 'not found' }
      if (row.completion_state !== 'partial') return { ok: false, status: 409, error: 'already complete' }
      if (
        !tokensMatch(input.completionToken, row.step_token_hash) ||
        isTokenExpired(row.step_token_expires_at)
      ) {
        return { ok: false, status: 401, error: 'invalid or expired token' }
      }

      const values = whitelistStepValues(def, input.stepKey, input.data ?? {})
      const errors = validateStep(def, input.stepKey, values)

      const finalStep = isFinalStep(def, input.stepKey)
      if (finalStep && def.requiresConsentAtFinalStep && input.gdprConsent !== true) {
        errors._consent = 'required'
      }
      if (Object.keys(errors).length > 0) {
        return { ok: false, status: 400, error: 'validation failed', errors }
      }

      const mergedData = { ...(row.submission_data as Record<string, unknown>), ...values }
      const now = Date.now()

      // Rotate on a non-final step; clear the token + finalize on the last step.
      const rotated = finalStep ? null : issueStepToken(now)
      const gdprConsent = finalStep && input.gdprConsent === true

      const updatePayload: Record<string, unknown> = {
        submission_data: mergedData,
        completion_state: finalStep ? 'complete' : 'partial',
        step_token_hash: rotated?.hash ?? null,
        step_token_expires_at: rotated?.expiresAt ?? null,
      }
      if (gdprConsent) {
        updatePayload.gdpr_consent = true
        updatePayload.gdpr_consent_at = new Date(now).toISOString()
      }

      // Guard the UPDATE on still-partial to make double-finalize race-safe.
      const { data: updated, error: updErr } = await supabase
        .from('form_submissions')
        .update(updatePayload)
        .eq('id', input.submissionId)
        .eq('completion_state', 'partial')
        .select('id')

      if (updErr) {
        console.error('[forms.completeStep] update error:', updErr.code, updErr.message)
        return { ok: false, status: 500, error: 'failed to update submission' }
      }
      if (!updated || updated.length === 0) {
        // Lost the race — someone finalized between our SELECT and UPDATE.
        return { ok: false, status: 409, error: 'already complete' }
      }

      if (finalStep) {
        await emitSubmittedEvent(supabase, {
          tenantId: (row.tenant_id as string) ?? null,
          projectId: (row.project_id as string) ?? null,
          def,
          submissionId: input.submissionId,
          locale: (row.locale as string) ?? 'en',
        })
        return { ok: true, done: true, submissionId: input.submissionId }
      }

      return {
        ok: true,
        done: false,
        submissionId: input.submissionId,
        completionToken: rotated!.token,
        nextStepKey: nextStepKey(def, input.stepKey),
      }
    },
  )
}

// ── Outbox emit (ADR-018 Decision 9 → ADR-019 consumes) ────────────────────────

async function emitSubmittedEvent(
  supabase: { from: (t: string) => any },
  args: { tenantId: string | null; projectId: string | null; def: FormDefinition; submissionId: string; locale: string },
): Promise<void> {
  const { error } = await supabase.from('form_events').insert({
    event_type: 'form.submitted',
    tenant_id: args.tenantId,
    project_id: args.projectId,
    form_id: args.def.formId,
    form_version: args.def.version,
    submission_id: args.submissionId,
    topic: args.def.notificationTopic ?? args.def.formId,
    locale: args.locale,
    payload: {}, // provider-agnostic; ADR-019 consumer joins the submission for content
    status: 'pending',
  })
  // A failed outbox write must never lose the (already-persisted) submission.
  // Log and continue — the submission is the source of truth.
  if (error) {
    console.error('[forms.emitSubmittedEvent] outbox insert error:', error.code, error.message)
  }
}
