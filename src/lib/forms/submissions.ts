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
import { getAppEnvironment } from '@/lib/notifications/environment'
import { runSpamChecks } from '@/lib/forms/spam'
import { sanitizeSourceObject, sanitizeScalar, MAX_SOURCE_VALUE_LENGTH } from '@/lib/forms/request-limits'
import { issueStepToken, tokensMatch, isTokenExpired } from '@/lib/forms/tokens'
import {
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
import { resolveActiveDefinition, reconstructDefinitionFromSnapshot } from '@/lib/forms/definition-source'
import { asSupabaseProjectSlug, toTenantSlug, unbrand, type SupabaseProjectSlug, type TenantSlug } from '@/lib/tenancy/ids'

const SPAM_OPTS = {
  table: 'form_submissions',
  ipColumn: 'submitter_ip',
  // Enables the per-project hourly cap: the per-IP cap alone does nothing
  // against a distributed attack, and every completed submission emails the
  // tenant's recipients.
  projectColumn: 'project_id',
} as const

// ── Result types (routes translate these to HTTP) ──────────────────────────────

export type SubmissionResult =
  | { ok: true; done: boolean; submissionId: string; completionToken?: string; nextStepKey?: string | null }
  | { ok: true; spam: true }
  | { ok: false; status: number; error: string; errors?: Record<string, string> }

export interface CreateSubmissionInput {
  /** The route's `[projectSlug]` segment — a PROJECT slug (`projects.slug`), never a tenant slug. */
  projectSlug: SupabaseProjectSlug
  formId: string
  locale?: string
  source?: Record<string, unknown>
  context?: Record<string, unknown>
  data?: Record<string, unknown>
  gdprConsent?: boolean
  ip: string
  /** Raw from the body — `undefined` (absent) is a MEANINGFUL value, see spam.ts. */
  honeypot?: unknown
  /** Raw from the body — validated in `evaluateTiming`, never coerced here. */
  openedAt?: unknown
}

export interface CompleteStepInput {
  /** The route's `[projectSlug]` segment — a PROJECT slug (`projects.slug`), never a tenant slug. */
  projectSlug: SupabaseProjectSlug
  formId: string
  submissionId: string
  completionToken?: string
  stepKey: string
  data?: Record<string, unknown>
  gdprConsent?: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * The fully resolved scope of a route's `[projectSlug]`: the project it names,
 * the tenant that owns it, and that TENANT's slug (the grain `formDefinition`
 * documents are filed under — a project's slug must never be used for that
 * lookup, see `resolveActiveDefinition`).
 */
export interface ProjectScope {
  tenantId: string
  projectId: string
  /** `tenants.slug` of the project's owner — NOT the route slug. */
  tenantSlug: TenantSlug
}

/**
 * Resolves a route `projects.slug` to its scope, or `null` when the slug names
 * NO project.
 *
 * "Unknown" is returned as `null` rather than as a scope full of nulls, and that
 * distinction is the entire point. The previous shape — `{ tenantId: null,
 * projectId: null }` — made an unresolvable slug indistinguishable from a
 * legitimately platform-level submission row (migration 016 allows
 * `project_id null`), so `completeStep`'s tenant-isolation guard compared
 * `null !== null`, passed, and let ANY unresolvable route slug finalize any
 * platform-level submission. A `null` scope cannot be compared against a row's
 * project id by accident: both call sites must handle it explicitly, and both
 * fail closed.
 */
async function resolveProjectScope(
  supabase: { from: (t: string) => any },
  projectSlug: SupabaseProjectSlug,
): Promise<ProjectScope | null> {
  const { data } = await supabase
    .from('projects')
    .select('id, tenant_id')
    .eq('slug', unbrand(projectSlug))
    .maybeSingle()

  const projectId = (data?.id as string | null) ?? null
  const tenantId = (data?.tenant_id as string | null) ?? null
  if (!projectId || !tenantId) return null

  // The owning tenant's slug. `projects.tenant_id` is NOT NULL with an FK
  // (migration 002), so a miss here means the row is unreadable, not that the
  // project is tenant-less — fail closed rather than guess a tenant.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .maybeSingle()

  const tenantSlug = toTenantSlug(tenant?.slug as string | null | undefined)
  if (!tenantSlug) {
    console.error(
      `[forms.resolveProjectScope] project "${unbrand(projectSlug)}" resolved to tenant ` +
        `${tenantId} but that tenant has no readable slug; refusing to scope the request.`,
    )
    return null
  }

  return { tenantId, projectId, tenantSlug }
}

/**
 * Resolves a project's canonical slug from its id. Returns null for a null id
 * (platform-level rows, migration 016) or an unknown id. Used so an emitted
 * event's `project_slug` derives from the SUBMISSION's project, never from the
 * route the request happened to arrive on.
 */
async function resolveProjectSlugById(
  supabase: { from: (t: string) => any },
  projectId: string | null,
): Promise<SupabaseProjectSlug | null> {
  if (!projectId) return null
  const { data } = await supabase
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle()
  const slug = (data?.slug as string | null) ?? null
  return slug ? asSupabaseProjectSlug(slug) : null
}

/** Sanitizes placement Context to only the definition's contextMappable field keys (§18). */
function sanitizeContext(def: FormDefinition, context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {}
  const mappable = new Set(
    def.steps.flatMap((s) => s.fields.filter((f) => f.contextMappable).map((f) => f.key)),
  )
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (!mappable.has(k)) continue
    // Keys were already whitelisted; bound the VALUES too, so a mappable key is
    // not itself an unbounded write channel into the stored JSONB.
    const clean = sanitizeScalar(v, MAX_SOURCE_VALUE_LENGTH)
    if (clean !== undefined) out[k] = clean
  }
  return out
}

/**
 * Whitelists the attribution `source` JSONB the same way `sanitizeContext`
 * whitelists Context (§18). It lives at the SERVICE layer, not in the route, so
 * every caller of `createSubmission` gets it — the route used to spread
 * `body.source` wholesale into the stored row, which made it an arbitrary-JSON
 * write primitive for any anonymous visitor.
 */
function sanitizeSource(source: Record<string, unknown> | undefined): Record<string, unknown> {
  return sanitizeSourceObject(source)
}

/** Locale is a stored string column; bound it so it cannot be a write channel. */
function boundedLocale(locale: string | undefined): string {
  if (typeof locale !== 'string' || locale.trim() === '') return 'en'
  return locale.slice(0, 16)
}

// ── Create ──────────────────────────────────────────────────────────────────────

export async function createSubmission(input: CreateSubmissionInput): Promise<SubmissionResult> {
  return runAsTrustedSystemOperation(
    'Anonymous public form submission (create) — the submitter is a website visitor with no ' +
      'session. Covers the projects/tenants slug lookup, the per-IP rate-limit count, the ' +
      'form_submissions INSERT, and (single-step forms) the form_events outbox INSERT.',
    async (supabase): Promise<SubmissionResult> => {
      // Scope FIRST, and fail closed. An unrecognised route slug used to fall
      // through to a platform-level write (tenant_id/project_id null) from an
      // arbitrary URL; those rows are then indistinguishable from legitimate
      // platform-level rows and were finalizable from any other unresolvable
      // slug. A slug that names no project is now simply not a place to submit.
      const scope = await resolveProjectScope(supabase, input.projectSlug)
      if (!scope) return { ok: false, status: 404, error: 'unknown project' }

      // Spam (silent 200 on block — never reveal which check fired).
      const spam = await runSpamChecks(
        {
          honeypot: input.honeypot,
          openedAt: input.openedAt,
          ip: input.ip,
          // Server-resolved (never from the body) — scopes the per-project cap.
          projectId: scope.projectId,
        },
        supabase,
        SPAM_OPTS,
      )
      if (spam.blocked) return { ok: true, spam: true }

      // Definitions are TENANT-owned (ADR-018 Decision 1): the lookup key is the
      // owning tenant's slug, resolved from the project above — never the
      // route's project slug, which only coincided with it while every tenant
      // had exactly one project.
      const def = await resolveActiveDefinition(input.formId, scope.tenantSlug)
      if (!def) return { ok: false, status: 404, error: 'unknown form' }

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

      const { tenantId, projectId } = scope
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
          locale: boundedLocale(input.locale),
          source: sanitizeSource(input.source),
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
          tenantId, projectId, projectSlug: input.projectSlug,
          formId: def.formId, version: def.version, notificationTopic: def.notificationTopic,
          submissionId: inserted.id as string, locale: input.locale ?? 'en',
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
  // The definition is reconstructed from the row's pinned snapshot below, so
  // later steps validate against exactly what the visitor started with (ADR-018).
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
      if (row.form_id !== input.formId) return { ok: false, status: 404, error: 'not found' }

      // Tenant isolation (§18): the route's projectSlug MUST resolve to the same
      // project the submission was created under. Without this, a submission
      // started on tenant A's route can be finalized via tenant B's route, and
      // its content is then delivered to tenant B's recipients. 404 (not 403) so
      // we never reveal that the submission exists.
      // An unresolvable route slug is a hard reject, NOT a null-vs-null match:
      // before this, a slug naming no project produced `routeProjectId === null`
      // and a platform-level row produced `rowProjectId === null`, so the guard
      // compared null !== null, passed, and let any invented slug finalize any
      // platform-level submission. Unknown scope now fails closed, with the same
      // generic 404 an unknown submission gets.
      const scope = await resolveProjectScope(supabase, input.projectSlug)
      if (!scope) return { ok: false, status: 404, error: 'not found' }
      const rowProjectId = (row.project_id as string | null) ?? null
      // A genuinely platform-level row (project_id null, migration 016) never
      // matches a resolved route project either — it simply cannot be advanced
      // through a project-scoped route.
      if (scope.projectId !== rowProjectId) return { ok: false, status: 404, error: 'not found' }
      if (row.completion_state !== 'partial') return { ok: false, status: 409, error: 'already complete' }
      if (
        !tokensMatch(input.completionToken, row.step_token_hash) ||
        isTokenExpired(row.step_token_expires_at)
      ) {
        return { ok: false, status: 401, error: 'invalid or expired token' }
      }

      // Reconstruct the definition from the row's pinned snapshot and validate
      // this step against it — historical integrity, never a live definition.
      const def = reconstructDefinitionFromSnapshot(
        row.definition_snapshot as Parameters<typeof reconstructDefinitionFromSnapshot>[0],
      )
      if (!findStep(def, input.stepKey)) return { ok: false, status: 400, error: 'unknown step' }

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
        // Live definition only for its notification topic; identity (formId/
        // version) comes from the pinned row so the event matches the historical
        // submission, not a definition that may have changed.
        const liveDef = await resolveActiveDefinition(input.formId, scope.tenantSlug)
        // The event's slug derives from the ROW's project, never from the route.
        // (They are already proven equal by the tenant-isolation guard above; the
        // lookup keeps the event correct even if that guard is ever relaxed.) A
        // The guard above proved `rowProjectId === scope.projectId` and that it
        // is non-null, so this lookup always resolves; the route slug remains as
        // a belt-and-braces fallback (it may be an alias of the same project).
        const eventProjectSlug =
          (await resolveProjectSlugById(supabase, rowProjectId)) ?? input.projectSlug
        await emitSubmittedEvent(supabase, {
          tenantId: (row.tenant_id as string) ?? null,
          projectId: rowProjectId,
          projectSlug: eventProjectSlug,
          formId: row.form_id as string,
          version: row.form_version as number,
          notificationTopic: liveDef?.notificationTopic ?? (row.form_id as string),
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
  args: {
    tenantId: string | null
    projectId: string | null
    projectSlug: string
    formId: string
    version: number
    notificationTopic: string
    submissionId: string
    locale: string
  },
): Promise<void> {
  const { error } = await supabase.from('form_events').insert({
    event_type: 'form.submitted',
    tenant_id: args.tenantId,
    project_id: args.projectId,
    form_id: args.formId,
    form_version: args.version,
    submission_id: args.submissionId,
    project_slug: args.projectSlug,
    environment: getAppEnvironment(),
    topic: args.notificationTopic,
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
