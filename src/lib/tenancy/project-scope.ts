/**
 * Project → Tenant scope resolution (EXPAND phase).
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * A Sanity `project` document is owned by a `client` (the tenant). Several
 * places in the codebase need "which tenant owns this project?" in order to
 * scope tenant-owned content — most importantly `formDefinition`, which is
 * filed under a `tenantSlug` field, NOT a projectSlug.
 *
 * Today that ownership is derived by stripping a `-main` suffix off the
 * project slug:
 *
 *     projectSlug.replace(/-main$/, '')
 *
 * in `src/lib/sanity/schema.ts` (the `formRef` reference filter) and
 * `src/lib/sanity/studio/ModuleList.tsx` (the Modules pane). It is a no-op for
 * any slug that does not carry the suffix, and it encodes a naming convention
 * as if it were an ownership guarantee.
 *
 * In the live production dataset the convention holds for four of five
 * projects by luck, and breaks for the fifth: project `nologo` is owned by
 * client `freeriders`. See KNOWN_TENANT_SCOPE_INCONSISTENCIES below.
 *
 * ── Why this file does not fix the bug ───────────────────────────────────────
 * The data currently agrees with the bug. `form-nologo-demo` carries
 * `tenantSlug: "nologo"` — a PROJECT slug stored in a field named tenantSlug.
 * Switching the derivation to the correct `clientRef->tenantSlug` before the
 * data moves would make No!Logo's Forms pane query `freeriders`, match
 * nothing, and silently empty the pane.
 *
 * So this module is the SAFE half of an expand → migrate → contract sequence:
 *
 *   EXPAND   (this file)  add a dual-read that can resolve tenancy correctly,
 *                         and warn loudly wherever the two disagree. Nothing
 *                         in the app calls it yet, so repo behaviour is
 *                         unchanged and this is safe to merge on its own.
 *   MIGRATE               backfill `project.tenantSlug`, repoint
 *                         `form-nologo-demo`. See ./MIGRATION.md.
 *   CONTRACT              delete the two regexes and read the stored field.
 *
 * `legacyTenantSlugFromProjectSlug()` is exported so a call site can move onto
 * this module during EXPAND with byte-for-byte identical behaviour, before the
 * data has moved.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Which of the three tiers actually produced the tenant slug.
 *
 *  - `stored`        — `project.tenantSlug`, the target state. This field does
 *                      NOT exist in the schema yet (see MIGRATION.md); the tier
 *                      is here so that adding it requires no code change.
 *  - `clientRef`     — resolved through `project.clientRef->tenantSlug`. This
 *                      is the TRUE ownership edge and the authority the backfill
 *                      copies from.
 *  - `legacy-suffix` — the `-main` strip. Unreliable; always warns.
 */
export type TenantSlugSource = 'stored' | 'clientRef' | 'legacy-suffix'

/** A project paired with the tenant that owns it, plus how we know. */
export interface ProjectScope {
  projectSlug: string
  tenantSlug: string
  source: TenantSlugSource
}

/**
 * Everything `deriveTenantSlug` can read.
 *
 * Both a nested `clientRef` (the shape a raw project document has after a
 * GROQ dereference) and a flattened `clientTenantSlug` (the shape most of our
 * projections produce) are accepted, so call sites do not have to reshape
 * their fetch to use this.
 */
export interface ProjectScopeInput {
  /** `project.projectSlug`. Required — it is the identity being scoped. */
  projectSlug: string | null | undefined
  /** Tier 1: `project.tenantSlug`. Does not exist in the schema yet. */
  tenantSlug?: string | null
  /** Tier 2, nested form: `project.clientRef->{ tenantSlug }`. */
  clientRef?: { tenantSlug?: string | null } | null
  /** Tier 2, flattened form: `"clientTenantSlug": clientRef->tenantSlug`. */
  clientTenantSlug?: string | null
}

// ─── Known inconsistency register ────────────────────────────────────────────

/** One project whose real owner disagrees with the legacy suffix strip. */
export interface TenantScopeInconsistency {
  /** `project.projectSlug`. */
  projectSlug: string
  /** The true owner, via `clientRef->tenantSlug`. */
  trueTenantSlug: string
  /** What `replace(/-main$/, '')` returns for this slug today. */
  legacyDerivedTenantSlug: string
  /** The `tenantSlug` value the tenant-owned documents are actually filed under today. */
  formsFiledUnderTenantSlug: string
  /** Sanity `_id`s that the MIGRATE phase has to repoint. */
  affectedDocumentIds: readonly string[]
  note: string
}

/**
 * The KNOWN INCONSISTENCY, recorded from the live `production` dataset
 * (project `3n7t84j3`) on 2026-08-29.
 *
 * Project `nologo` belongs to client `freeriders` (`client-freeriders`), but
 * the legacy suffix strip yields `nologo` — and the dataset has been written
 * to match the bug: `form-nologo-demo` carries `tenantSlug: "nologo"`.
 *
 * The two errors cancel out, which is exactly why the pane works today and
 * exactly why a naive "just use clientRef" fix breaks it. This constant exists
 * so the disagreement is discoverable in code review and so `deriveTenantSlug`
 * can shout about it at runtime.
 *
 * THIS TABLE MUST NOT CHANGE BEHAVIOUR. It drives warnings only. Nothing in
 * `deriveTenantSlug` branches on it to pick a different answer — a lookup
 * table that silently rewrites tenancy would be a second, worse version of the
 * bug it documents.
 *
 * Delete this entry in the CONTRACT phase, once `form-nologo-demo` has been
 * repointed to `freeriders` and verified.
 */
export const KNOWN_TENANT_SCOPE_INCONSISTENCIES: readonly TenantScopeInconsistency[] = [
  {
    projectSlug: 'nologo',
    trueTenantSlug: 'freeriders',
    legacyDerivedTenantSlug: 'nologo',
    formsFiledUnderTenantSlug: 'nologo',
    affectedDocumentIds: ['project-nologo', 'form-nologo-demo'],
    note:
      'Project "nologo" (_id project-nologo) is owned by client "Freeriders" ' +
      '(_id client-freeriders, tenantSlug "freeriders"), but its slug carries no ' +
      '"-main" suffix, so the legacy strip returns "nologo". form-nologo-demo was ' +
      'then filed under tenantSlug "nologo" to match, making a project slug ' +
      'masquerade as a tenant slug. Repoint the form to "freeriders" BEFORE the ' +
      'CONTRACT phase deletes the regexes, or No!Logo\'s Forms pane goes empty. ' +
      'See src/lib/tenancy/MIGRATION.md.',
  },
] as const

/** Look up a project in the inconsistency register. `undefined` when clean. */
export function findKnownInconsistency(
  projectSlug: string
): TenantScopeInconsistency | undefined {
  return KNOWN_TENANT_SCOPE_INCONSISTENCIES.find((e) => e.projectSlug === projectSlug)
}

// ─── Legacy derivation ───────────────────────────────────────────────────────

/**
 * The derivation as it exists in the repo today, verbatim.
 *
 * Exported so a call site can adopt this module during EXPAND without any
 * behaviour change at all. Every use of it is a debt marked for deletion in
 * the CONTRACT phase.
 */
export function legacyTenantSlugFromProjectSlug(projectSlug: string): string {
  return projectSlug.replace(/-main$/, '')
}

// ─── Warning de-duplication ──────────────────────────────────────────────────

// Once per slug per process. These panes re-render constantly; an un-throttled
// warn would bury the console and teach everyone to ignore it.
const warnedLegacy = new Set<string>()
const warnedDisagreement = new Set<string>()

/**
 * TEST ONLY. Clears the once-per-slug warning memo.
 *
 * Not for application code — resetting this in the app would restore the
 * console flooding the memo exists to prevent.
 */
export function __resetTenantScopeWarnings(): void {
  warnedLegacy.clear()
  warnedDisagreement.clear()
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Resolve the tenant that owns a project, three-tier dual-read.
 *
 * Priority: stored `project.tenantSlug` → `clientRef->tenantSlug` → legacy
 * `-main` strip. The winning tier is reported back as `source` so callers,
 * dashboards and tests can see which one fired without re-deriving it.
 *
 * Warnings (never behaviour changes):
 *  - tier 3 warns once per slug that the derivation is unreliable;
 *  - a project whose `clientRef` tenant disagrees with the legacy strip gets a
 *    distinct, louder warning once per slug, whichever tier won — that
 *    disagreement is the precise condition that will break tenant-owned
 *    content when the regexes are deleted.
 *
 * Returns `null` when there is no `projectSlug` to scope. Callers must treat
 * `null` as "select nothing", never as "select everything" — the existing
 * `formRef` filter already does this with a sentinel `_id` match.
 */
export function deriveTenantSlug(input: ProjectScopeInput): ProjectScope | null {
  const projectSlug = input.projectSlug
  if (!projectSlug) return null

  const stored = nonEmpty(input.tenantSlug)
  const viaClientRef = nonEmpty(input.clientTenantSlug) ?? nonEmpty(input.clientRef?.tenantSlug)
  const viaLegacy = legacyTenantSlugFromProjectSlug(projectSlug)

  // Warn on disagreement independently of which tier wins: the mismatch is a
  // property of the data, not of how this particular call happened to resolve.
  if (viaClientRef && viaClientRef !== viaLegacy && !warnedDisagreement.has(projectSlug)) {
    warnedDisagreement.add(projectSlug)
    const known = findKnownInconsistency(projectSlug)
    console.warn(
      `[tenancy] TENANT SCOPE DISAGREEMENT for project "${projectSlug}": ` +
        `clientRef->tenantSlug is "${viaClientRef}" but the legacy -main strip gives "${viaLegacy}". ` +
        `Tenant-owned documents (formDefinition.tenantSlug) filed under "${viaLegacy}" will ` +
        `disappear from this project once the legacy derivation is removed. ` +
        (known
          ? `This is a KNOWN inconsistency: ${known.note}`
          : `This project is NOT in KNOWN_TENANT_SCOPE_INCONSISTENCIES — a new divergence has ` +
            `appeared in the dataset. Add it there and to src/lib/tenancy/MIGRATION.md before migrating.`)
    )
  }

  if (stored) return { projectSlug, tenantSlug: stored, source: 'stored' }
  if (viaClientRef) return { projectSlug, tenantSlug: viaClientRef, source: 'clientRef' }

  if (!warnedLegacy.has(projectSlug)) {
    warnedLegacy.add(projectSlug)
    console.warn(
      `[tenancy] Falling back to the legacy "-main" suffix strip for project ` +
        `"${projectSlug}" (no stored tenantSlug, no clientRef->tenantSlug). ` +
        `Derived tenant "${viaLegacy}" is UNRELIABLE — it is a naming convention, ` +
        `not an ownership record. Backfill project.tenantSlug; see src/lib/tenancy/MIGRATION.md.`
    )
  }
  return { projectSlug, tenantSlug: viaLegacy, source: 'legacy-suffix' }
}

/** Trim, and treat blank as absent — Sanity string fields are often `''`. */
function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
