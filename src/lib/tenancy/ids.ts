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
 * ── The project grain has TWO namespaces, not three (v1.0.36) ───────────────
 * `ProjectSlug` was once a conflation of THREE: for one project, Supabase,
 * Sanity and the URL each held a name of its own, and each store was the
 * authority for its own spelling. Two of those three have since been made to
 * agree:
 *
 *     project           Supabase          Sanity              URL segment
 *     ----------------- ----------------- ------------------- -------------------
 *     Livener           livener           livener             livener
 *     Studio Martegani  studiomartegani   studiomartegani     studiomartegani
 *     the platform site abluo             abluo               abluo
 *     No!Logo           nologo            nologo              nologo
 *
 *     authority         projects.slug     project.projectSlug domainMap (proxy.ts)
 *
 * Step 1 of `./RENAME.md` renamed the platform site's URL segment; Step 4
 * renamed the 39 Sanity documents that said `livener-main` /
 * `studiomartegani-main`, and Step 5 deleted the translation map that existed
 * only to bridge them. Supabase and Sanity now hold ONE name per project, so
 * `SupabaseProjectSlug` and `SanityProjectSlug` are ONE brand — {@link
 * ProjectSlug} — and the two old names remain only as aliases of it.
 *
 * `UrlProjectSegment` stays a SEPARATE brand, and not because the values
 * differ today (they do not — every segment equals its `projects.slug`) but
 * because it is a separately-maintained AUTHORITY: `domainMap` /
 * `resolveDefaultLocale` in `src/proxy.ts` are hand-written, nothing derives
 * them from `projects.slug`, and nothing but `__tests__/host-scope.test.ts`
 * notices when they drift. They HAVE drifted — that is exactly how the
 * platform site got a URL segment of its own for two months. It collapses into
 * `ProjectSlug` at Step 6, when the proxy reads the generated route table.
 *
 * This is not theoretical. `EarlyAccessContext.projectSlug` used to hold
 * Sanity's `livener-main` while the forms API resolved `.eq('slug', …)`
 * against Supabase's `livener`; threading the context value into the endpoint
 * — which reads as obviously correct, and was proposed — 404'd every live
 * Early Access submission. That particular gap is closed by the data now
 * agreeing, not by the type system; what the remaining brand still objects to
 * is the URL segment, whose agreement rests on a hand-maintained map.
 *
 * ── There is NO conversion function between the two ─────────────────────────
 * Crossing between these namespaces is a LOOKUP against real data (the
 * generated route config, after Step 6), never a cast and never a string
 * transform. Until Step 6 lands there is no lookup table left to consult —
 * `TENANT_TO_PROJECT` was deleted with Step 5 — so the one remaining crossing
 * is an identity assertion, deliberately confined to ONE named, greppable
 * function so it stays countable:
 *
 *     projectScopeSlugFromUrlSegment()   @/lib/forms/render-mapping
 *
 * Do not add a second. If you find yourself writing `unbrand(a) as B`, you
 * have written the forbidden transform with an assertion instead of a regex.
 *
 * ── How to use ───────────────────────────────────────────────────────────────
 * Brand ONCE at each trust boundary — where a slug enters the system from a
 * URL segment, a database row, a Sanity document or an env var — and let the
 * branded type flow inward from there. Do not brand in the middle of a call
 * chain to silence an error: that error is the finding. If `asProjectSlug()` is
 * being applied to something that came from a `[tenant]` route segment, the bug
 * is the route, not the missing cast.
 *
 *     // at the boundary — brand for the grain the value IS
 *     const projectSlug = asProjectSlug(row.slug)                  // Supabase
 *     const projectSlug = asProjectSlug(doc.projectSlug)           // Sanity
 *     const segment     = asUrlProjectSegment(params.tenant)       // the URL
 *     const tenantSlug  = asTenantSlug(client.tenantSlug)          // Sanity
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
declare const URL_PROJECT_SEGMENT_BRAND: unique symbol

/**
 * The URL/ownership identity of a CUSTOMER. One tenant owns N projects.
 *
 * Authority: `tenants.slug` in Supabase, mirrored onto Sanity `client.tenantSlug`
 * and (since v1.0.29) copied down to `project.tenantSlug`.
 *
 * Tenant-owned content is filed under this: `formDefinition.tenantSlug` above
 * all. Two projects of one tenant SHARE their tenant's forms.
 *
 * There is ONE tenant namespace, so there is one brand. If a second store ever
 * disagrees about a tenant's name, split this the way `ProjectSlug` was split.
 */
export type TenantSlug = string & { readonly [TENANT_SLUG_BRAND]: true }

/**
 * The identity of a single WEBSITE. ONE name, in every store.
 *
 * Authority: `projects.slug` in Supabase. Sanity's `projectSlug` field — on
 * `project` documents and on every project-scoped document type (`page`,
 * `post`, `event`, `siteConfig`, …) — now carries the SAME value, which is
 * what `./RENAME.md` Step 4 made true and Step 5 relies on. It is also what
 * `src/lib/tenancy/generated/route-config.ts` carries (it is generated FROM
 * that column) and therefore what `host-scope.ts` returns.
 *
 * This is the namespace the forms and notifications stack resolves against:
 * `resolveProjectScope()` does `.eq('slug', …)` on `projects`, and the
 * `/api/forms/[projectSlug]/…` route segment carries THIS value. It is also
 * what `$projectSlug` is bound to in every GROQ query and what
 * `tenant-scoped-sanity.ts` compares a dereferenced document against — those
 * used to be two different namespaces, and that gap was the direct cause of
 * the client dashboard's empty Posts list.
 *
 * Values today: `livener`, `studiomartegani`, `nologo`, `hoffmann`, `amelie`,
 * `abluo`, `t42`.
 */
export type ProjectSlug = string & {
  readonly [PROJECT_SLUG_BRAND]: true
}

/**
 * @deprecated Alias of {@link ProjectSlug}, kept because ~100 call sites name
 * the store rather than the grain. There is no separate Supabase namespace any
 * more — Supabase is simply the AUTHORITY for the one name.
 */
export type SupabaseProjectSlug = ProjectSlug

/**
 * @deprecated Alias of {@link ProjectSlug}. Sanity no longer has a name of its
 * own for a project (`./RENAME.md` Step 4). Prefer `ProjectSlug` in new code.
 */
export type SanityProjectSlug = ProjectSlug

/**
 * The identity of a single WEBSITE **as the URL names it**.
 *
 * Authority: the `[tenant]` dynamic segment of the public website route
 * (`/[locale]/[tenant]/…`), whose legal values are the ones `domainMap` and
 * `resolveTenant()` in `src/proxy.ts` rewrite a host to, plus the closed
 * allow-list `KNOWN_PROJECT_SEGMENTS` (`src/lib/sanity/client.ts`) that the
 * route boundary 404s against.
 *
 * The segment is NAMED `tenant` and is NOT one: for `nologo` it carries a
 * project slug whose tenant is `freeriders`, so it is not a `tenants.slug`.
 * Neither is it a Supabase project slug BY CONSTRUCTION — it only happens to
 * equal one for every project alive today. Its values are typed by hand into
 * `domainMap`/`resolveDefaultLocale` in `src/proxy.ts`; nothing derives them
 * from `projects.slug` and nothing but `__tests__/host-scope.test.ts` notices
 * when they drift. They HAVE drifted: `abluo.app` rewrote to a segment that was
 * not `projects.slug` for two months (fixed by Step 1 of `./RENAME.md`, which
 * names it). Hence its own brand — an independently-maintained namespace
 * whose authority is `src/proxy.ts`, not either store. It collapses into
 * `ProjectSlug` only at Step 6, when the proxy reads the generated route table
 * instead of a hand-written map.
 *
 * Values today: `livener`, `studiomartegani`, `nologo`, `abluo` — each equal to
 * its `projects.slug`. `hoffmann` and `amelie` are live projects with NO
 * segment at all (absent from every proxy map; divergence (B) in
 * `./host-scope.ts`).
 */
export type UrlProjectSegment = string & {
  readonly [URL_PROJECT_SEGMENT_BRAND]: true
}

/**
 * Either of the two project-grain namespaces. Use ONLY for things that are
 * genuinely namespace-agnostic — `unbrand`, a log formatter. A parameter typed
 * as this has given up exactly the safety this module exists to provide.
 */
export type AnyProjectSlug = ProjectSlug | UrlProjectSegment

// ─── Constructors ────────────────────────────────────────────────────────────

/**
 * Brands a raw string as a tenant slug. Identity at runtime.
 *
 * Call this only at a trust boundary, and only where the value provably IS a
 * tenant slug — a `tenants.slug` column, `client.tenantSlug`, or the resolved
 * `project.tenantSlug`. See the module header on why mid-chain casts are a
 * smell rather than a fix.
 *
 * ⚠️ The `[tenant]` route segment is NOT a tenant slug. If you are reaching for
 * `asTenantSlug(params.tenant)`, you want {@link asUrlProjectSegment}.
 */
export function asTenantSlug(raw: string): TenantSlug {
  return raw as TenantSlug
}

/**
 * Brands a raw string as a project slug. Identity at runtime.
 *
 * Boundaries: a `projects.slug` column read, a `route-config.ts` row, a Sanity
 * document's own `projectSlug` field, and the `[projectSlug]` segment of
 * `/api/forms/…`. All four are the SAME namespace since `./RENAME.md` Step 4.
 */
export function asProjectSlug(raw: string): ProjectSlug {
  return raw as ProjectSlug
}

/** @deprecated Alias of {@link asProjectSlug}. */
export const asSupabaseProjectSlug = asProjectSlug

/**
 * Brands a raw string as a `[tenant]` URL segment. Identity at runtime.
 *
 * Boundaries: `params.tenant` in the `(website)/[tenant]` route group, and the
 * value `resolveTenant()` in `src/proxy.ts` produces.
 */
export function asUrlProjectSegment(raw: string): UrlProjectSegment {
  return raw as UrlProjectSegment
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

/** @deprecated Alias of {@link toProjectSlug}. */
export const toSupabaseProjectSlug = toProjectSlug

/** Nullable counterpart of {@link asUrlProjectSegment}. Empty/whitespace → null. */
export function toUrlProjectSegment(
  raw: string | null | undefined
): UrlProjectSegment | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? (trimmed as UrlProjectSegment) : null
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
 * It is deliberately NOT a conversion between any two brands. There is no such
 * function, and there must not be — not tenant↔project, and not project↔URL
 * segment. Getting from a project to its tenant is a LOOKUP against ownership
 * data (`deriveTenantSlug` in `./project-scope`). Getting from a URL segment to
 * a project slug has no lookup left to make since Step 5 deleted the bridge,
 * and until Step 6 restores one (the generated route config) it survives as a
 * single named assertion, `projectScopeSlugFromUrlSegment` in
 * `@/lib/forms/render-mapping` — one call site, greppable, and the whole
 * reason `UrlProjectSegment` still has a brand of its own.
 * `projectSlug.replace(/-main$/, '')` was the forbidden cast spelled as a
 * regex; a second, unnamed `unbrand(x) as ProjectSlug` is the same cast
 * spelled as an assertion, and is equally forbidden.
 */
export function unbrand(slug: TenantSlug | AnyProjectSlug): string {
  return slug
}
