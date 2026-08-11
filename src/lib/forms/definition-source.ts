/**
 * Definition source — ADR-018 slice 3.
 *
 * Resolves a form's runtime `FormDefinition` from the PUBLISHED, tenant-owned
 * Sanity `formDefinition` document (authored in slice 2), replacing the slice-1
 * code descriptor as the live source of truth. A code fallback is retained as a
 * safety net: if no published definition exists for the tenant (or Sanity is
 * unreachable), we fall back to `resolveDefinition()` so the live submission
 * path never hard-fails on a content gap. The cutover is behaviour-preserving —
 * the published Early Access definition mirrors the code descriptor field-for-
 * field (same keys, required flags, options, validation).
 *
 * Two resolvers:
 *   - resolveActiveDefinition(formId, tenantSlug) — CREATE path. Reads the
 *     published definition, maps it to FormDefinition; the snapshot is then
 *     pinned onto the row at creation (Decision 4).
 *   - reconstructDefinitionFromSnapshot(snapshot) — STEP path. Rebuilds a
 *     FormDefinition from the row's pinned `definition_snapshot`, so later steps
 *     validate against exactly what the visitor started with (historical
 *     integrity), never a definition that may have changed mid-flow.
 */
import { sanityClient } from '@/lib/sanity/client'
import {
  resolveDefinition,
  type FormDefinition,
  type FormFieldDef,
  type FormFieldValidation,
  type FormStepDef,
} from '@/lib/forms/definitions'

// ── GROQ: published, tenant-owned, active definition by (formId, tenantSlug) ────
// No draft ever resolves at runtime (published-only), matching the ADR-018 §16
// "definitions are published content" intent and the routing no-fallback rule.
export const formDefinitionByKeyQuery = /* groq */ `
  *[_type == "formDefinition"
    && formId == $formId
    && tenantSlug == $tenantSlug
    && role == "active"
    && !(_id in path("drafts.**"))][0]{
    formId,
    version,
    notificationTopic,
    "requiresConsent": privacy.requireConsent,
    steps[]{
      key,
      fields[]{
        internalKey,
        type,
        required,
        contextMappable,
        validationPreset,
        "options": options[].value
      }
    }
  }
`

// Shape returned by the query above (loosely typed — Sanity returns unknowns).
interface SanityFormDefinition {
  formId?: string
  version?: number
  notificationTopic?: string
  requiresConsent?: boolean
  steps?: Array<{
    key?: string
    fields?: Array<{
      internalKey?: string
      type?: string
      required?: boolean
      contextMappable?: boolean
      validationPreset?: string
      options?: Array<string | null> | null
    }>
  }>
}

/** Maps the Studio `validationPreset` to the runtime `validate` union ('none'/null → undefined). */
function mapValidationPreset(preset: string | null | undefined): FormFieldValidation | undefined {
  return preset === 'email' || preset === 'url' ? preset : undefined
}

/**
 * Maps a published Sanity `formDefinition` document to the runtime
 * `FormDefinition`. Returns null if the document is missing its identity or has
 * no steps/fields — callers then fall back to the code descriptor.
 *
 * Input is intentionally loosely typed: GROQ returns untyped JSON where unset
 * fields come back as `null`. We narrow to `SanityFormDefinition` internally.
 */
export function mapSanityFormDefinition(input: Record<string, unknown> | null | undefined): FormDefinition | null {
  if (!input) return null
  const doc = input as SanityFormDefinition
  if (!doc.formId) return null

  const steps: FormStepDef[] = (doc.steps ?? [])
    .filter((s) => s && typeof s.key === 'string')
    .map((s) => ({
      key: s.key as string,
      fields: (s.fields ?? [])
        .filter((f) => f && typeof f.internalKey === 'string' && typeof f.type === 'string')
        .map((f): FormFieldDef => {
          const options = (f.options ?? []).filter((o): o is string => typeof o === 'string' && o.length > 0)
          const validate = mapValidationPreset(f.validationPreset)
          return {
            key: f.internalKey as string,
            type: f.type as string,
            required: !!f.required,
            ...(options.length > 0 ? { options } : {}),
            ...(validate ? { validate } : {}),
            ...(f.contextMappable ? { contextMappable: true } : {}),
          }
        }),
    }))

  if (steps.length === 0 || steps.every((s) => s.fields.length === 0)) return null

  return {
    formId: doc.formId,
    version: typeof doc.version === 'number' ? doc.version : 1,
    notificationTopic: doc.notificationTopic || doc.formId,
    requiresConsentAtFinalStep: !!doc.requiresConsent,
    steps,
  }
}

/**
 * CREATE-path resolver. Reads the published tenant-owned definition; on any miss
 * (no published doc for the tenant, or a Sanity error) falls back to the code
 * descriptor so the live path never hard-fails on a content gap.
 *
 * `tenantSlug` is the route's path scope (e.g. "livener") — the same value the
 * submission service resolves tenant/project from, and the key the definition is
 * owned by (ADR-018 Decision 1). It is server-derived, never trusted from the body.
 */
export async function resolveActiveDefinition(
  formId: string,
  tenantSlug: string,
): Promise<FormDefinition | null> {
  try {
    const doc = await sanityClient.fetch<Record<string, unknown> | null>(formDefinitionByKeyQuery, {
      formId,
      tenantSlug,
    })
    const mapped = mapSanityFormDefinition(doc)
    if (mapped) return mapped
  } catch (err) {
    console.error('[forms.resolveActiveDefinition] Sanity fetch failed:', err)
  }
  const code = resolveDefinition(formId)
  if (code) {
    console.warn(
      `[forms.resolveActiveDefinition] no published formDefinition for formId="${formId}" ` +
        `tenant="${tenantSlug}"; using code descriptor fallback.`,
    )
  }
  return code
}

// ── STEP-path: reconstruct a FormDefinition from the row's pinned snapshot ──────

/** The interpretation-subset shape written by resolveDefinitionSnapshot(). */
interface DefinitionSnapshot {
  formId?: string
  version?: number
  requiresConsentAtFinalStep?: boolean
  steps?: Array<{
    key?: string
    fields?: Array<{
      key?: string
      type?: string
      required?: boolean
      options?: string[]
      validate?: string
    }>
  }>
}

/**
 * Rebuilds a FormDefinition from a submission row's pinned `definition_snapshot`.
 * Later steps validate against THIS — the definition as it was at submission
 * creation — never a live definition that may have changed mid-flow (ADR-018:
 * "validates later steps against the row's snapshot").
 *
 * `notificationTopic` is not part of the snapshot (operational routing is
 * resolved live, ADR-018 snapshot boundary) — it defaults to formId here and is
 * only used as an identity placeholder; the finalize emit resolves the live
 * topic separately. `requiresConsentAtFinalStep` defaults to `true` for legacy
 * slice-1 rows whose snapshot predates the flag (the only such form, Early
 * Access, does require consent — a safe default).
 */
export function reconstructDefinitionFromSnapshot(input: Record<string, unknown> | null | undefined): FormDefinition {
  const snapshot = (input ?? {}) as DefinitionSnapshot
  const formId = snapshot?.formId ?? 'unknown'
  return {
    formId,
    version: typeof snapshot?.version === 'number' ? snapshot.version : 1,
    notificationTopic: formId,
    requiresConsentAtFinalStep: snapshot?.requiresConsentAtFinalStep ?? true,
    steps: (snapshot?.steps ?? [])
      .filter((s) => s && typeof s.key === 'string')
      .map((s) => ({
        key: s.key as string,
        fields: (s.fields ?? [])
          .filter((f) => f && typeof f.key === 'string' && typeof f.type === 'string')
          .map((f): FormFieldDef => {
            const validate = f.validate === 'email' || f.validate === 'url' ? f.validate : undefined
            return {
              key: f.key as string,
              type: f.type as string,
              required: !!f.required,
              ...(Array.isArray(f.options) && f.options.length > 0 ? { options: f.options } : {}),
              ...(validate ? { validate } : {}),
            }
          }),
      })),
  }
}
