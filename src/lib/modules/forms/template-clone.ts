// ── template-clone.ts ─────────────────────────────────────────────────────────
//
// Turning a platform form template into a tenant-owned form.
//
// This lives outside ModuleList.tsx so it can be tested without pulling the
// Studio (and therefore `sanity`) into the test graph, and because the rule it
// encodes — a cloned form belongs to exactly one tenant — is the kind of thing
// that must not be able to drift silently. A clone that kept the template's
// identity, or landed without a tenant, would be a form no submission route
// could resolve.

/** Sanity's own metadata keys — everything else on a template is content. */
const SANITY_METADATA_KEYS = ['_id', '_rev', '_createdAt', '_updatedAt', '_system'] as const

/**
 * Produce a formId not already taken within the tenant.
 *
 * formId is the stable route key ("never change once live"), so two forms in
 * one tenant sharing one would make the submission endpoint ambiguous. The
 * numeric suffix is stripped before searching so cloning "contact-2" yields
 * "contact-3" rather than "contact-2-2".
 */
export function uniqueFormId(base: string, taken: Set<string>): string {
  const root = base.replace(/-\d+$/, '') || 'form'
  if (!taken.has(root)) return root
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${root}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${root}-${Date.now()}`
}

/**
 * Strip a template's identity so the remainder can become a tenant-owned form.
 *
 * Field-agnostic by design, exactly like ExportDesignSystemAction: only Sanity's
 * metadata keys are removed, so any field added to formDefinition later is
 * carried into clones with no change here.
 */
export function formFromTemplate(
  template: Record<string, unknown>,
  tenantSlug: string,
  projectSlug: string | undefined,
  formId: string
): { _type: string } & Record<string, unknown> {
  const draft: Record<string, unknown> = { ...template }
  for (const key of SANITY_METADATA_KEYS) delete draft[key]

  draft._type = 'formDefinition'
  draft.role = 'active'
  draft.tenantSlug = tenantSlug
  draft.formId = formId
  // Version restarts at 1: the clone is a new form with its own submission
  // history, not a continuation of the template's (ADR-018 Decision 4).
  draft.version = 1
  if (projectSlug) draft.projectSlug = projectSlug

  const name = typeof template.internalName === 'string' ? template.internalName : 'Form'
  draft.internalName = `${name} (${tenantSlug})`

  return draft as { _type: string } & Record<string, unknown>
}
