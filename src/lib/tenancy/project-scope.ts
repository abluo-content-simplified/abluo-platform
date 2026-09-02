/**
 * Project → Tenant scope resolution (CONTRACT phase — complete).
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * A Sanity `project` document is owned by a `client` (the tenant). Several
 * places in the codebase need "which tenant owns this project?" in order to
 * scope tenant-owned content — most importantly `formDefinition`, which is
 * filed under a `tenantSlug` field, NOT a projectSlug.
 *
 * Getting from a project to its tenant is a LOOKUP against ownership data. It
 * used to be a string transformation — a regex stripping a trailing "-main"
 * off the project slug — in `src/lib/sanity/schema.ts` (the `formRef` reference filter) and
 * `src/lib/sanity/studio/ModuleList.tsx` (the Modules pane). That encoded a
 * naming convention as if it were an ownership guarantee. It held for four of
 * the five live projects by luck and broke the fifth: project `nologo` is owned
 * by client `freeriders`. Both regexes are now gone, and so is the tier that
 * reproduced them here — see `./MIGRATION.md`, Stage 5.
 *
 * ── The two tiers that remain ────────────────────────────────────────────────
 *   1. `project.tenantSlug`      — the stored field, backfilled in Stage 2 and
 *                                  written by `ProjectLinker` on every link.
 *   2. `project.clientRef->tenantSlug` — the ownership edge the backfill copies
 *                                  from; the fallback for a project whose
 *                                  stored field has not been written yet.
 *
 * There is no third tier. A project that resolves to neither returns `null`,
 * and `null` MUST mean "select nothing" at every call site — never "select
 * everything". Guessing a tenant from a slug is the defect this module exists
 * to have removed.
 */

import type { ProjectSlug, TenantSlug } from './ids'
import { toProjectSlug, toTenantSlug } from './ids'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Which of the two tiers actually produced the tenant slug.
 *
 *  - `stored`    — `project.tenantSlug`, the target state and the authority.
 *  - `clientRef` — resolved through `project.clientRef->tenantSlug`, the true
 *                  ownership edge, for projects the backfill has not reached.
 */
export type TenantSlugSource = 'stored' | 'clientRef'

/** A project paired with the tenant that owns it, plus how we know. */
export interface ProjectScope {
  projectSlug: ProjectSlug
  tenantSlug: TenantSlug
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
  /** Tier 1: `project.tenantSlug`. */
  tenantSlug?: string | null
  /** Tier 2, nested form: `project.clientRef->{ tenantSlug }`. */
  clientRef?: { tenantSlug?: string | null } | null
  /** Tier 2, flattened form: `"clientTenantSlug": clientRef->tenantSlug`. */
  clientTenantSlug?: string | null
}

// ─── Known inconsistency register ────────────────────────────────────────────

/** One project whose stored/derived tenancy is known to disagree with reality. */
export interface TenantScopeInconsistency {
  /** `project.projectSlug`. */
  projectSlug: string
  /** The true owner, via `clientRef->tenantSlug`. */
  trueTenantSlug: string
  /** The `tenantSlug` value the tenant-owned documents are actually filed under. */
  formsFiledUnderTenantSlug: string
  /** Sanity `_id`s a remediation would have to repoint. */
  affectedDocumentIds: readonly string[]
  note: string
}

/**
 * EMPTY, deliberately.
 *
 * The single historical entry — project `nologo` owned by client `freeriders`,
 * with `form-nologo-demo` mis-filed under `tenantSlug: "nologo"` — was resolved
 * by the migration (`./MIGRATION.md` Stages 2–3) and removed here in Stage 5.
 *
 * The type and the register are KEPT on purpose. The next divergence between a
 * project's recorded tenancy and where its tenant-owned documents actually sit
 * needs somewhere to land that is discoverable in review, and re-deriving this
 * shape under time pressure is how the last one went unrecorded for months.
 *
 * THIS TABLE MUST NOT CHANGE BEHAVIOUR. Nothing in `deriveTenantSlug` branches
 * on it to pick a different answer — a lookup table that silently rewrites
 * tenancy would be a second, worse version of the bug it documents.
 */
export const KNOWN_TENANT_SCOPE_INCONSISTENCIES: readonly TenantScopeInconsistency[] = [] as const

/** Look up a project in the inconsistency register. `undefined` when clean. */
export function findKnownInconsistency(
  projectSlug: string
): TenantScopeInconsistency | undefined {
  return KNOWN_TENANT_SCOPE_INCONSISTENCIES.find((e) => e.projectSlug === projectSlug)
}

// ─── Warning de-duplication ──────────────────────────────────────────────────

// Once per slug per process. These panes re-render constantly; an un-throttled
// warn would bury the console and teach everyone to ignore it.
const warnedUnresolved = new Set<string>()

/**
 * TEST ONLY. Clears the once-per-slug warning memo.
 *
 * Not for application code — resetting this in the app would restore the
 * console flooding the memo exists to prevent.
 */
export function __resetTenantScopeWarnings(): void {
  warnedUnresolved.clear()
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Resolve the tenant that owns a project.
 *
 * Priority: stored `project.tenantSlug` → `clientRef->tenantSlug`. The winning
 * tier is reported back as `source` so callers, dashboards and tests can see
 * which one fired without re-deriving it.
 *
 * Returns `null` when there is no `projectSlug` to scope, and when a project
 * has no resolvable tenant at all. Callers MUST treat `null` as "select
 * nothing", never as "select everything" — the `formRef` filters do this with
 * a sentinel `_id` match, and `ModuleList` refuses to render its Forms list.
 *
 * An unresolvable project warns once per slug: it is a real data fault (a
 * project linked to no client, or to a client with no `tenantSlug`) and it
 * makes tenant-owned content invisible on that website until it is fixed.
 */
export function deriveTenantSlug(input: ProjectScopeInput): ProjectScope | null {
  const projectSlug = toProjectSlug(input.projectSlug)
  if (!projectSlug) return null

  const stored = toTenantSlug(input.tenantSlug)
  if (stored) return { projectSlug, tenantSlug: stored, source: 'stored' }

  const viaClientRef =
    toTenantSlug(input.clientTenantSlug) ?? toTenantSlug(input.clientRef?.tenantSlug)
  if (viaClientRef) return { projectSlug, tenantSlug: viaClientRef, source: 'clientRef' }

  if (!warnedUnresolved.has(projectSlug)) {
    warnedUnresolved.add(projectSlug)
    console.warn(
      `[tenancy] No tenant could be resolved for project "${projectSlug}": it has no stored ` +
        `tenantSlug and no clientRef->tenantSlug. Tenant-owned content (formDefinition) will ` +
        `select NOTHING for this project rather than being guessed from its slug. Link the ` +
        `project to a client in Project Settings; see src/lib/tenancy/MIGRATION.md.`
    )
  }
  return null
}
