/**
 * Branded tenant and project identifiers.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * A TENANT (a customer) owns N PROJECTS (websites). `freeriders` is a tenant;
 * `nologo`, `t42` and `bike-delivery` are projects belonging to it. The two are
 * different things at different grains.
 *
 * Every cross-tenant defect found in the 2026-08-28 audit, the 2026-08-29
 * remediation plan and the 2026-08-31 one-to-N review has the same shape: a
 * `string` holding a TENANT slug was passed to a parameter that meant a PROJECT
 * slug, or the reverse. A representative sample:
 *
 *   - `submissionEndpoint(tenantSlug, …)` builds `/api/forms/{tenantSlug}/…`,
 *     and the route segment that receives it is named `[projectSlug]`.
 *   - `resolveRecipients()` feeds a Supabase PROJECT slug into
 *     `tryTenantToProjectSlug()`, a map keyed by TENANT slug.
 *   - `formDefinitionTenantOwned` stamps `params.projectSlug` into a field
 *     named `tenantSlug` — the mechanism that mis-filed `form-nologo-demo`.
 *   - `sitemap.ts` iterates per PROJECT but emits the TENANT slug as the path.
 *
 * None of these is a typo. Each is a correct-looking assignment between two
 * values of the same type. The compiler had no way to object, so review and
 * tests were the only defence, and both missed all four.
 *
 * These brands remove that whole class. A `TenantSlug` cannot be passed where a
 * `ProjectSlug` is wanted, and the error appears at the call site, at compile
 * time, in every future edit — including in code nobody thought to review.
 *
 * ── Why the accidents were invisible until now ───────────────────────────────
 * All five live projects belong to single-project tenants, and Supabase seeded
 * `projects.slug` with the TENANT slug (`002_projects.sql`: `'livener'`,
 * `'studiomartegani'`). The two namespaces were born identical, so passing one
 * for the other produced correct behaviour everywhere. The mistakes were real
 * from the first commit; only the data hid them. The moment `freeriders` owns a
 * second project the values diverge and the defects surface all at once — see
 * `docs`/memory `one-to-n-tenant-projects`.
 *
 * ── How to use ───────────────────────────────────────────────────────────────
 * Brand ONCE at each trust boundary — where a slug enters the system from a
 * URL segment, a database row, a Sanity document or an env var — and let the
 * branded type flow inward from there. Do not brand in the middle of a call
 * chain to silence an error: that error is the finding. If `asProjectSlug()` is
 * being applied to something that came from a `[tenant]` route segment, the bug
 * is the route, not the missing cast.
 *
 *     // at the boundary
 *     const projectSlug = asProjectSlug(row.slug)         // from Supabase
 *     const tenantSlug  = asTenantSlug(client.tenantSlug) // from Sanity
 *
 *     // inward, no casts
 *     await resolveActiveDefinition(formId, projectSlug)
 *
 * ── Runtime cost ─────────────────────────────────────────────────────────────
 * None. A brand is a compile-time-only intersection with a phantom property;
 * `asTenantSlug(s)` is an identity function that erases to `s`. These values ARE
 * strings at runtime and serialise, compare and interpolate exactly as before.
 * Nothing here changes behaviour — this module is types plus identity functions.
 */

// ─── The brands ──────────────────────────────────────────────────────────────

/**
 * Phantom properties. `unique symbol` + `declare const` means these never exist
 * at runtime and cannot be forged from outside this module, so the only way to
 * obtain a branded value is through the constructors below (or an explicit
 * `as`, which is greppable and reviewable).
 */
declare const TENANT_SLUG_BRAND: unique symbol
declare const PROJECT_SLUG_BRAND: unique symbol

/**
 * The URL/ownership identity of a CUSTOMER. One tenant owns N projects.
 *
 * Authority: `tenants.slug` in Supabase, mirrored onto Sanity `client.tenantSlug`
 * and (since v1.0.29) copied down to `project.tenantSlug`.
 *
 * Tenant-owned content is filed under this: `formDefinition.tenantSlug` above
 * all. Two projects of one tenant SHARE their tenant's forms.
 */
export type TenantSlug = string & { readonly [TENANT_SLUG_BRAND]: true }

/**
 * The identity of a single WEBSITE. Belongs to exactly one tenant.
 *
 * Authority: `projects.slug` in Supabase and `project.projectSlug` in Sanity.
 * ⚠️ These two namespaces are NOT the same today — Supabase has `livener` where
 * Sanity has `livener-main`. `TENANT_TO_PROJECT` (`src/lib/sanity/client.ts`)
 * is the current translation and is scheduled for deletion; until it is gone,
 * a `ProjectSlug` says which GRAIN a value is at, not which STORE it came from.
 *
 * Project-scoped content — pages, posts, events, siteConfig, submissions — is
 * filed under this. It must never be shared between projects.
 */
export type ProjectSlug = string & { readonly [PROJECT_SLUG_BRAND]: true }

// ─── Constructors ────────────────────────────────────────────────────────────

/**
 * Brands a raw string as a tenant slug. Identity at runtime.
 *
 * Call this only at a trust boundary, and only where the value provably IS a
 * tenant slug — a `tenants.slug` column, `client.tenantSlug`, or the resolved
 * `project.tenantSlug`. See the module header on why mid-chain casts are a
 * smell rather than a fix.
 */
export function asTenantSlug(raw: string): TenantSlug {
  return raw as TenantSlug
}

/**
 * Brands a raw string as a project slug. Identity at runtime.
 *
 * Call this only at a trust boundary — a `projects.slug` column, a
 * `project.projectSlug` field, or a host→project resolution.
 */
export function asProjectSlug(raw: string): ProjectSlug {
  return raw as ProjectSlug
}

// ─── Nullable boundary helpers ───────────────────────────────────────────────

/**
 * Brands a value that may be absent, treating empty and whitespace-only as
 * absent. Use at boundaries where the source is genuinely optional — an unset
 * Sanity field, a nullable column — so that "missing" stays distinguishable
 * from "present but blank".
 *
 * `deriveTenantSlug()` in `./project-scope` applies the same empty-is-absent
 * rule, deliberately: a blank tier-1 value must fall through to `clientRef`
 * rather than out-ranking it.
 */
export function toTenantSlug(raw: string | null | undefined): TenantSlug | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? (trimmed as TenantSlug) : null
}

/** Nullable counterpart of {@link asProjectSlug}. Empty/whitespace → null. */
export function toProjectSlug(raw: string | null | undefined): ProjectSlug | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? (trimmed as ProjectSlug) : null
}

// ─── Escape hatch ────────────────────────────────────────────────────────────

/**
 * Drops a brand back to a plain string.
 *
 * Needed only where a value crosses OUT to an untyped surface — a GROQ param
 * bag, a Supabase filter, a URL template, a log line. Prefer letting structural
 * assignability do this implicitly (a `TenantSlug` already IS assignable to
 * `string`); this exists for the cases where an explicit widening reads more
 * clearly than a bare pass-through.
 *
 * It is deliberately NOT a conversion between the two brands. There is no such
 * function, and there must not be: getting from a project to its tenant is a
 * LOOKUP against ownership data (`deriveTenantSlug` in `./project-scope`), never
 * a cast and never a string transformation. `projectSlug.replace(/-main$/, '')`
 * was exactly that forbidden cast, spelled as a regex.
 */
export function unbrand(slug: TenantSlug | ProjectSlug): string {
  return slug
}
