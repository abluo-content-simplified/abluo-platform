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
 * ── The project grain has THREE namespaces, not one (v1.0.31) ────────────────
 * `ProjectSlug` was itself a conflation. For ONE project, three stores disagree
 * about its name, and each store is the authority for its own:
 *
 *     project           Supabase          Sanity              URL segment
 *     ----------------- ----------------- ------------------- -------------------
 *     Livener           livener           livener-main        livener
 *     Studio Martegani  studiomartegani   studiomartegani-main studiomartegani
 *     the platform site abluo             abluo               abluo
 *     No!Logo           nologo            nologo              nologo
 *
 *     authority         projects.slug     project.projectSlug TENANT_TO_PROJECT
 *                                                             + domainMap (proxy.ts)
 *
 * The platform site used to be the second broken row here: its URL segment was
 * a longer name of the proxy's own (`./RENAME.md` §0 spells it out and tracks
 * the blame). Step 1 of that runbook renamed it, so the only store
 * still holding a name of its own is SANITY, for the two `-main` projects
 * (Steps 3-5). The brands stay three, because they are three AUTHORITIES, not
 * three current value sets: `UrlProjectSegment` is maintained by hand in
 * `src/proxy.ts` and nothing but a test stops it drifting from Supabase again —
 * which is precisely how the platform site's odd segment got here in the first
 * place.
 *
 * That is `SupabaseProjectSlug`, `SanityProjectSlug` and `UrlProjectSegment`.
 * They are three brands because they are three namespaces that can and do
 * disagree — not three shapes of one thing.
 *
 * This is not theoretical. `EarlyAccessContext.projectSlug` holds the SANITY
 * name (`livener-main`); the forms API resolves `.eq('slug', …)` against
 * SUPABASE (`livener`). Threading the context value into the endpoint — which
 * reads as obviously correct, and was proposed — 404s every live Early Access
 * submission. One `ProjectSlug` brand cannot object to that. Three can.
 *
 * ── There is NO conversion function between the three ────────────────────────
 * Crossing between these namespaces is a LOOKUP against real data
 * (`TENANT_TO_PROJECT` today; the generated route config after the contract
 * phase), never a cast and never a string transform. Every such lookup is a
 * named, greppable function that says which direction it goes:
 *
 *     lookupSanityProjectSlugByUrlSegment()      @/lib/sanity/client
 *     tryLookupSanityProjectSlugByUrlSegment()   @/lib/sanity/client
 *
 * If you find yourself writing `unbrand(a) as B`, you have written the
 * forbidden transform with an assertion instead of a regex. Add the lookup.
 *
 * ── How to use ───────────────────────────────────────────────────────────────
 * Brand ONCE at each trust boundary — where a slug enters the system from a
 * URL segment, a database row, a Sanity document or an env var — and let the
 * branded type flow inward from there. Do not brand in the middle of a call
 * chain to silence an error: that error is the finding. If `asProjectSlug()` is
 * being applied to something that came from a `[tenant]` route segment, the bug
 * is the route, not the missing cast.
 *
 *     // at the boundary — brand for the store the value CAME FROM
 *     const projectSlug = asSupabaseProjectSlug(row.slug)          // Supabase
 *     const sanitySlug  = asSanityProjectSlug(doc.projectSlug)     // Sanity
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
declare const SUPABASE_PROJECT_SLUG_BRAND: unique symbol
declare const SANITY_PROJECT_SLUG_BRAND: unique symbol
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
 * The identity of a single WEBSITE **as the DATABASE names it**.
 *
 * Authority: `projects.slug` in Supabase. Also what
 * `src/lib/tenancy/generated/route-config.ts` carries (it is generated FROM
 * that column) and therefore what `host-scope.ts` returns.
 *
 * This is the namespace the forms and notifications stack resolves against:
 * `resolveProjectScope()` does `.eq('slug', …)` on `projects`, and the
 * `/api/forms/[projectSlug]/…` route segment must carry THIS value.
 *
 * Values today: `livener`, `studiomartegani`, `nologo`, `hoffmann`, `amelie`,
 * `abluo`, `t42`.
 */
export type SupabaseProjectSlug = string & {
  readonly [SUPABASE_PROJECT_SLUG_BRAND]: true
}

/**
 * The identity of a single WEBSITE **as the CMS names it**.
 *
 * Authority: the `projectSlug` field on Sanity `project` documents, and the
 * `projectSlug` field every project-scoped document type carries so it can be
 * filtered (`page`, `post`, `event`, `siteConfig`, …). It is what
 * `$projectSlug` is bound to in every GROQ query, and what
 * `tenant-scoped-sanity.ts` compares a dereferenced document against.
 *
 * ⚠️ NOT the same namespace as {@link SupabaseProjectSlug}. Sanity says
 * `livener-main` where Supabase says `livener`. Getting from one to the other
 * is a LOOKUP (see `lookupSanityProjectSlugByUrlSegment` in
 * `src/lib/sanity/client.ts`), never `.replace(/-main$/, '')`.
 */
export type SanityProjectSlug = string & {
  readonly [SANITY_PROJECT_SLUG_BRAND]: true
}

/**
 * The identity of a single WEBSITE **as the URL names it**.
 *
 * Authority: the `[tenant]` dynamic segment of the public website route
 * (`/[locale]/[tenant]/…`), whose legal values are exactly the keys of
 * `TENANT_TO_PROJECT` (`src/lib/sanity/client.ts`) plus the values `domainMap`
 * and `resolveTenant()` in `src/proxy.ts` rewrite a host to.
 *
 * The segment is NAMED `tenant` and is NOT one: for `nologo` it carries a
 * project slug whose tenant is `freeriders`, so it is not a `tenants.slug`.
 * Neither is it a Supabase project slug BY CONSTRUCTION — it only happens to
 * equal one for every project alive today. Its values are typed by hand into
 * `domainMap`/`resolveDefaultLocale` in `src/proxy.ts`; nothing derives them
 * from `projects.slug` and nothing but `__tests__/host-scope.test.ts` notices
 * when they drift. They HAVE drifted: `abluo.app` rewrote to a segment that was
 * not `projects.slug` for two months (fixed by Step 1 of `./RENAME.md`, which
 * names it). Hence its own brand — a third, independently-maintained
 * namespace whose authority is `src/proxy.ts`, not either store. It collapses
 * into `SupabaseProjectSlug` only at Step 6, when the proxy reads the
 * generated route table instead of a hand-written map.
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
 * Any of the three project-grain namespaces. Use ONLY for things that are
 * genuinely namespace-agnostic — `unbrand`, a log formatter. A parameter typed
 * as this has given up exactly the safety this module exists to provide.
 */
export type AnyProjectSlug = SupabaseProjectSlug | SanityProjectSlug | UrlProjectSegment

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
 * Brands a raw string as a Supabase `projects.slug`. Identity at runtime.
 *
 * Boundaries: a `projects.slug` column read, a `route-config.ts` row, the
 * `[projectSlug]` segment of `/api/forms/…` (that route resolves against
 * Supabase, so the segment is contractually a Supabase slug).
 */
export function asSupabaseProjectSlug(raw: string): SupabaseProjectSlug {
  return raw as SupabaseProjectSlug
}

/**
 * Brands a raw string as a Sanity `project.projectSlug`. Identity at runtime.
 *
 * Boundaries: a Sanity document's own `projectSlug` field, and the RESULT of
 * `lookupSanityProjectSlugByUrlSegment()`.
 */
export function asSanityProjectSlug(raw: string): SanityProjectSlug {
  return raw as SanityProjectSlug
}

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

/** Nullable counterpart of {@link asSupabaseProjectSlug}. Empty/whitespace → null. */
export function toSupabaseProjectSlug(
  raw: string | null | undefined
): SupabaseProjectSlug | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? (trimmed as SupabaseProjectSlug) : null
}

/** Nullable counterpart of {@link asSanityProjectSlug}. Empty/whitespace → null. */
export function toSanityProjectSlug(
  raw: string | null | undefined
): SanityProjectSlug | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? (trimmed as SanityProjectSlug) : null
}

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
 * function, and there must not be — not tenant↔project, and not between the
 * three project namespaces. Getting from a project to its tenant is a LOOKUP
 * against ownership data (`deriveTenantSlug` in `./project-scope`); getting
 * from a URL segment to Sanity's name for the same project is a LOOKUP against
 * the bridge (`lookupSanityProjectSlugByUrlSegment` in `@/lib/sanity/client`).
 * Never a cast and never a string transformation.
 * `projectSlug.replace(/-main$/, '')` was exactly that forbidden cast, spelled
 * as a regex; `unbrand(x) as SupabaseProjectSlug` is the same cast spelled as
 * an assertion, and is equally forbidden.
 */
export function unbrand(slug: TenantSlug | AnyProjectSlug): string {
  return slug
}
