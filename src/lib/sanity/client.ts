import { createClient } from '@sanity/client'
import {
  asSanityProjectSlug,
  unbrand,
  type AnyProjectSlug,
  type SanityProjectSlug,
  type TenantSlug,
  type UrlProjectSegment,
} from '@/lib/tenancy/ids'
import { DS_FIELDS_SELECTION } from '@/lib/sanity/queries'
import { SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_VERSION } from '@/lib/sanity/config'

/**
 * Optional server-side read token for a PRIVATE Sanity dataset.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * When `SANITY_API_READ_TOKEN` is UNSET this module behaves exactly as it did
 * before the variable existed: `createClient` receives no `token` key at all,
 * so every request is anonymous and every result is byte-for-byte what a
 * public dataset returns today. That is deliberate and load-bearing — this
 * code is designed to be deployed to all environments BEFORE either dataset's
 * ACL is flipped from `public` to `private`. Token first, ACL second.
 *
 * ── Why it is NOT `NEXT_PUBLIC_` ────────────────────────────────────────────
 * A `NEXT_PUBLIC_` token would be inlined into the browser bundle by Next's
 * DefinePlugin and would hand every visitor read access to every tenant's
 * content, including drafts — strictly worse than the public dataset we are
 * trying to close. The name must stay server-only.
 *
 * ── Bundle safety ───────────────────────────────────────────────────────────
 * `src/lib/sanity/image.ts` imports `sanityClient` and is imported by several
 * `'use client'` components, so THIS MODULE IS CURRENTLY REACHABLE FROM THE
 * BROWSER BUNDLE. The secret value is still not shipped: Next only substitutes
 * `NEXT_PUBLIC_*` reads on the client, and every other `process.env.X` read
 * resolves against an empty shim object — it becomes `undefined`, never the
 * literal. So the token is absent (not leaked) in the browser.
 *
 * That is a bundler guarantee, not a structural one, and it is too subtle to
 * rely on. The structural fix is one line in `src/lib/sanity/image.ts`:
 * configure the URL builder from `@/lib/sanity/config` instead of from this
 * client (see that file's doc comment). Once that lands, no client component
 * reaches this module. DONE 2026-08-31: `image.ts` was decoupled — it now
 * builds URLs from `@/lib/sanity/config`, which carries no token.
 *
 * That structural separation is enforced by
 * `__tests__/client-bundle-boundary.test.ts`, which fails if any 'use client'
 * component reaches this module again.
 *
 * A compile-time guard (`import 'server-only'`) would be stronger still, but
 * the package is not a dependency of this repo and importing it breaks every
 * vitest suite that loads this module (it throws outside the react-server
 * condition). To adopt it: `npm i server-only`, alias it to a no-op in
 * vitest.config, then add the import here.
 */
const sanityReadToken = process.env.SANITY_API_READ_TOKEN

export const sanityClient = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  apiVersion: SANITY_API_VERSION,
  // CDN disabled: the CDN caches empty GROQ results when a query field (projectSlug)
  // didn't exist at cache-warm time. Direct API always reflects the current dataset.
  useCdn: false,
  // Spread, not `token: sanityReadToken` — passing an explicit `undefined` is
  // not the same shape as omitting the key, and only omission is guaranteed to
  // be indistinguishable from today's anonymous client.
  ...(sanityReadToken ? { token: sanityReadToken } : {}),
})

/**
 * True when a server-side read token is configured in this process.
 * Exported for diagnostics and tests only — never for branching request logic.
 */
export const hasSanityReadToken = Boolean(sanityReadToken)

// ─── THE BRIDGE: URL segment → Sanity projectSlug ────────────────────────────
/**
 * The hand-written translation between two of the platform's three
 * project-grain namespaces (see `src/lib/tenancy/ids.ts`):
 *
 *   KEY   — `UrlProjectSegment`: the `[tenant]` route segment, whose authority
 *           is `domainMap`/`resolveTenant()` in `src/proxy.ts`.
 *   VALUE — `SanityProjectSlug`: the `projectSlug` field on Sanity documents.
 *
 * NEITHER SIDE IS A SUPABASE `projects.slug`, and neither side is a
 * `tenants.slug`. Read the rows: `nologo` is a project slug whose tenant is
 * `freeriders`, and the VALUES `livener-main` / `studiomartegani-main` are
 * Sanity names that exist in no other store. The historic name of this map is
 * therefore wrong on both halves; it is kept only to keep this change
 * type-level.
 *
 * The keys used to diverge from Supabase on a second count too: the platform
 * site's key was a longer legacy URL segment (see `src/lib/tenancy/RENAME.md`
 * §0) while `projects.slug` is `abluo`. Step 1 of that runbook renamed the
 * segment, so today every KEY here equals its `projects.slug`. Only the two `-main` VALUES still diverge —
 * that is Step 4.
 *
 * This is the ONLY sanctioned crossing between these two namespaces. There is
 * no cast and no string transform — `'livener-main'.replace(/-main$/,'')` is
 * the forbidden thing, and so is `unbrand(x) as SanityProjectSlug`.
 *
 * Scheduled for deletion by the contract phase; see
 * `src/lib/tenancy/host-scope.ts`, "What the CONTRACT phase will delete" (4).
 */
const TENANT_TO_PROJECT: Record<string, SanityProjectSlug> = {
  livener: asSanityProjectSlug('livener-main'),
  studiomartegani: asSanityProjectSlug('studiomartegani-main'),
  abluo: asSanityProjectSlug('abluo'),
  nologo: asSanityProjectSlug('nologo'),
}

/**
 * Non-throwing lookup — resolves a URL tenant slug to its Sanity projectSlug,
 * or returns `null` when the slug has no entry in `TENANT_TO_PROJECT`.
 *
 * Use this at public-website route boundaries (the `(website)/[tenant]`
 * route group) where an unmapped/unknown tenant slug is an expected,
 * recoverable case — e.g. a retired flat route or a typo falling through to
 * the `[tenant]` dynamic segment — and should resolve to a clean `notFound()`
 * rather than an unhandled throw. Callers that legitimately want a hard
 * error for a missing mapping (internal/admin paths) should keep using
 * `tenantToProjectSlug()` below.
 */
export function tryLookupSanityProjectSlugByUrlSegment(
  segment: UrlProjectSegment
): SanityProjectSlug | null {
  return TENANT_TO_PROJECT[unbrand(segment)] ?? null
}

/**
 * Throwing counterpart. Crosses URL-segment → Sanity-projectSlug via the
 * bridge above. Named for the direction it goes and for the fact that it
 * CONSULTS DATA: the contract phase greps for `…ByUrlSegment` to find every
 * crossing it has to replace with the generated route config.
 */
export function lookupSanityProjectSlugByUrlSegment(
  segment: UrlProjectSegment
): SanityProjectSlug {
  const projectSlug = tryLookupSanityProjectSlugByUrlSegment(segment)
  if (!projectSlug) {
    throw new Error(
      `No project mapping for tenant "${segment}". Add it to TENANT_TO_PROJECT in client.ts.`
    )
  }
  return projectSlug
}

/**
 * @deprecated Historic name — both halves of it are wrong (the argument is a
 * URL segment, not a tenant slug; and "project slug" here means SANITY's name,
 * not Supabase's). Kept as a pure re-export so this split stays type-level.
 * Prefer {@link tryLookupSanityProjectSlugByUrlSegment}.
 */
export const tryTenantToProjectSlug = tryLookupSanityProjectSlugByUrlSegment

/**
 * @deprecated See {@link tryTenantToProjectSlug}. Prefer
 * {@link lookupSanityProjectSlugByUrlSegment}.
 */
export const tenantToProjectSlug = lookupSanityProjectSlugByUrlSegment

// ─── STEP 3 DUAL-READ (src/lib/tenancy/RENAME.md) ────────────────────────────
//
// Two projects have TWO names for one thing: Supabase says `livener`, Sanity
// documents say `livener-main` (same for `studiomartegani`). Step 4 of the
// runbook renames the 38 Sanity documents; step 3 — this — teaches the read
// path to accept BOTH names FIRST, so the data can move without a synchronised
// deploy and can sit in either state indefinitely.
//
// Mechanism: every query filters `projectSlug in $projectSlugs`, and both
// chokepoints (`fetchForTenant` below, `tenantScopedSanityClient` in
// `@/lib/api/tenant-scoped-sanity`) bind that array through
// `dualReadProjectSlugs()`.
//
// ⚠️ THIS IS A NO-OP TODAY. Verified against the live production dataset on
// 2026-09-01: `array::unique(*[defined(projectSlug)].projectSlug)` is
// `[abluo, abluo-base, abluo-dental, amelie, livener-main, nologo,
// studiomartegani-main]` — NO document carries the bare `livener` or
// `studiomartegani` name, so `projectSlug in ["livener", "livener-main"]`
// selects exactly the same 24 documents `projectSlug == "livener-main"` does.
// Every other project has ONE name, so its array has ONE element and the
// filter is literally the old one. (`abluo-base`/`abluo-dental` are the
// shared designSystem misuse of the field noted in RENAME.md §Step 4 — they
// are not project names and are untouched by this.)
//
// ── WHAT STEP 5 DELETES ─────────────────────────────────────────────────────
// Exactly two things in this file: the constant `LEGACY_MAIN_PROJECT_SLUG_PAIRS`
// and the function `dualReadProjectSlugs`. Then sweep the query catalogue back
// from `projectSlug in $projectSlugs` to `projectSlug == $projectSlug` and drop
// the `projectSlugs` binding at both chokepoints. `grep -rn dualReadProjectSlugs`
// enumerates every site.

/**
 * The ONLY place the legacy `-main` names are written down. One row per project
 * whose Supabase name and Sanity name disagree; both are dead the moment step 4
 * lands. Deleting this constant (and the function below) is the whole of the
 * step-5 contraction on the read path.
 */
const LEGACY_MAIN_PROJECT_SLUG_PAIRS: ReadonlyArray<readonly [supabase: string, sanity: string]> = [
  ['livener', 'livener-main'],
  ['studiomartegani', 'studiomartegani-main'],
]

/**
 * The set of project-slug values a query should match for `slug` — the name it
 * was given, plus the OTHER name of the same project while both exist.
 *
 * This is NOT a conversion between the branded namespaces of
 * `@/lib/tenancy/ids` (there is no such function, and there must not be — see
 * that module's "There is NO conversion function between the three"). It is a
 * LOOKUP against a table of known aliases, and it returns plain `string[]`
 * precisely because the result is a mixed-namespace set on its way out to an
 * untyped GROQ param bag, not a value of any one namespace.
 *
 * Accepts a name from EITHER side of a pair, so it is correct whichever
 * chokepoint calls it: the website passes Sanity's `livener-main`, the
 * dashboard passes Supabase's `livener`, and both get
 * `['livener', 'livener-main']`.
 *
 * A project with one name gets a one-element array — an exact-match filter by
 * another spelling.
 */
export function dualReadProjectSlugs(slug: TenantSlug | AnyProjectSlug): string[] {
  const raw = unbrand(slug)
  for (const [supabaseSlug, sanitySlug] of LEGACY_MAIN_PROJECT_SLUG_PAIRS) {
    if (raw === supabaseSlug || raw === sanitySlug) return [supabaseSlug, sanitySlug]
  }
  return [raw]
}

// ─── Runtime tenant-scope guard (finding I-9) ────────────────────────────────

/**
 * A query that failed the tenant-scope check. `kind` distinguishes the two
 * failure shapes; `message` is the human-readable text both chokepoints report.
 */
export type TenantScopeViolation = {
  kind: 'interpolation' | 'missing-project-slug'
  message: string
}

/**
 * The SINGLE implementation of "is this GROQ query tenant-scoped?", shared by
 * both chokepoints:
 *
 *   - the dashboard chokepoint — `assertQueryIsTenantScoped` in
 *     `src/lib/api/tenant-scoped-sanity.ts`, which throws
 *     `TenantAuthorizationError` on any violation; and
 *   - the public-website read path — `tenantClient().fetchForTenant` below.
 *
 * It lives HERE, in the lower-level of the two modules, because
 * `tenant-scoped-sanity.ts` already imports `sanityClient` from this file:
 * putting the shared detector on that side would create an import cycle and
 * would drag the API/auth layer into a module that sits on the client-bundle
 * boundary (see `__tests__/client-bundle-boundary.test.ts`).
 *
 * It is deliberately a DETECTOR, not an assertion — it RETURNS the violation
 * rather than throwing, so each chokepoint chooses its own reaction. The
 * dashboard throws unconditionally (an API route returning 500 is a contained
 * failure). The website does not always throw, because a throw on a false
 * positive is a blank client site — see `tenantScopeEnforcement` below.
 *
 * `label` is prefixed to the message so the two chokepoints stay
 * distinguishable in logs, and so the dashboard's messages are byte-for-byte
 * what they were before this detector was extracted from it.
 *
 * This is a lightweight guard, not a GROQ parser. It proves the query is
 * parameterized on `$projectSlug` and does not inline tenant identity as a
 * literal. It does NOT prove `$projectSlug` is used in the ROOT filter — that
 * stronger, static check lives in `__tests__/query-tenant-scope.test.ts`,
 * which reads every exported query at CI time. The two are complementary:
 * static coverage of the query catalogue, runtime coverage of whatever string
 * a caller actually passes.
 */
export function findTenantScopeViolation(
  query: string,
  label: string
): TenantScopeViolation | null {
  if (query.includes('${')) {
    return {
      kind: 'interpolation',
      message:
        label +
        ': query string contains a template-literal interpolation ' +
        '(`${...}`) — raw interpolation of tenant identity is banned at this chokepoint. ' +
        'Use a bound GROQ parameter ($projectSlug) instead.',
    }
  }
  if (!query.includes('$projectSlug')) {
    return {
      kind: 'missing-project-slug',
      message:
        label +
        ': query must reference $projectSlug — every query executed ' +
        'through this chokepoint must be scoped by the bound projectSlug parameter.',
    }
  }
  return null
}

export type TenantScopeEnforcement = 'throw' | 'warn'

/**
 * How `fetchForTenant` reacts to a violation: THROW in development, WARN
 * everywhere else (production, preview, test).
 *
 * ── Why not throw in production ─────────────────────────────────────────────
 * This guard is a substring check, not a parser. A false positive here does
 * not degrade a page — it takes a live client website down entirely, on a
 * server component, with no fallback. Every query the website actually issues
 * comes from `queries.ts`, and the whole exported catalogue is already proven
 * scoped at CI time by `__tests__/query-tenant-scope.test.ts`; so in
 * production this guard is defence-in-depth against a *future* ad-hoc query
 * string, not the primary control. Defence-in-depth that can black out a
 * tenant is a worse trade than defence-in-depth that pages someone. The warn
 * carries the full query plus the tenant and project slugs, so it is
 * actionable rather than decorative.
 *
 * ── Why throw in development ────────────────────────────────────────────────
 * That is where a new unscoped query is written, and where a hard failure
 * costs nothing and is impossible to ignore. A developer never gets to commit
 * an unscoped `fetchForTenant` call without seeing it fail first, and CI
 * catches it again on the way in.
 *
 * ── Why warn (not throw) in test ────────────────────────────────────────────
 * NODE_ENV is 'test' under vitest, and existing suites deliberately drive
 * `fetchForTenant` with stub queries like `*[_type == "page"]` to assert
 * param injection — those are testing the injection, not the query catalogue.
 * The throwing branch is exercised directly by passing 'development' here.
 *
 * The env is read per call (not captured at module load) so it stays
 * stubbable and so a process cannot be locked into the wrong mode by import
 * order.
 */
export function tenantScopeEnforcement(
  nodeEnv: string | undefined = process.env.NODE_ENV
): TenantScopeEnforcement {
  return nodeEnv === 'development' ? 'throw' : 'warn'
}

/**
 * Returns a project-scoped fetch helper.
 * Accepts the URL tenant slug (e.g. "livener") and resolves it to the
 * Sanity projectSlug (e.g. "livener-main") before injecting into queries.
 */
export function tenantClient(tenantSlug: UrlProjectSegment) {
  if (!tenantSlug) {
    throw new Error('tenantSlug is required — never query Sanity without a tenant scope')
  }

  const projectSlug = tenantToProjectSlug(tenantSlug)

  return {
    fetchForTenant<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
      // `tenantSlug` is injected alongside `projectSlug` but is NOT yet read by
      // any query — this is the additive half of an expand/migrate/contract.
      // It exists so that tenant-owned content (above all `formDefinition`,
      // which is filed under a flat `tenantSlug` field and NOT under a project)
      // can eventually be scoped correctly — e.g. `headerCta.formRef->`.
      //
      // The value is the URL tenant slug this function was handed, verbatim.
      // IT IS NOT YET VERIFIED AGAINST `project.clientRef->tenantSlug`, which
      // is the true ownership edge. For at least one live project the two
      // disagree (project `nologo` is owned by client `freeriders`), and the
      // dataset currently agrees with the wrong answer. `src/lib/tenancy/
      // project-scope.ts` is the eventual source of a correct tenant slug;
      // see `src/lib/tenancy/MIGRATION.md` before any query starts consuming
      // this parameter.
      //
      // Injection order is unchanged from before: the scope values are spread
      // LAST, so they still win over any caller-supplied param of the same
      // name. No current caller passes either name.
      // ── Runtime scope enforcement (finding I-9) ────────────────────────
      // Injecting $projectSlug proves nothing on its own: a query that never
      // MENTIONS $projectSlug is handed the parameter and quietly ignores it,
      // returning every tenant's documents. Before this check, scoping on the
      // public website was a convention enforced only by a CI test over the
      // `queries.ts` catalogue — nothing stopped an inline query string here.
      // Throws in development, warns (loudly, with the query and both slugs)
      // elsewhere — see `tenantScopeEnforcement`.
      const violation = findTenantScopeViolation(query, 'tenantClient.fetchForTenant')
      if (violation) {
        const detail =
          violation.message +
          ` [tenantSlug=${tenantSlug} projectSlug=${projectSlug}] query: ` +
          query.replace(/\s+/g, ' ').trim().slice(0, 500)
        if (tenantScopeEnforcement() === 'throw') {
          throw new Error(detail)
        }
        // console.error, not console.warn: this is a potential cross-tenant
        // content leak, and it must surface at error level in the platform's
        // log drain rather than blend into build noise.
        console.error('[tenant-scope] UNSCOPED WEBSITE QUERY — ' + detail)
      }

      // `projectSlugs` is the STEP 3 DUAL-READ binding (see the block above
      // `findTenantScopeViolation`): every query in `queries.ts` filters
      // `projectSlug in $projectSlugs`. `projectSlug` stays bound alongside it,
      // unchanged, so an ad-hoc query string that still says `== $projectSlug`
      // (and the guard's own message) keep working. Step 5 drops `projectSlugs`.
      return sanityClient.fetch<T>(query, {
        ...params,
        projectSlug,
        projectSlugs: dualReadProjectSlugs(projectSlug),
        tenantSlug,
      })
    },
  }
}

// ─── Audited exemptions from the tenant-scope guard ─────────────────────────

/**
 * The CLOSED list of website reads that deliberately run without a
 * `projectSlug == $projectSlug` root filter.
 *
 * These reads do not go through `fetchForTenant`, so they are not silently
 * slipping past the guard — they are recorded here, each with the reason it
 * is safe, and they can only be performed through `fetchUnscoped` below,
 * whose `exemption` parameter is typed as `keyof` this object. Adding an
 * unscoped read therefore requires editing this list, which is a security
 * decision and shows up as one in review. `grep fetchUnscoped` enumerates
 * every unscoped read in the codebase.
 *
 * Mirrors, for the website path, the single documented exemption the
 * dashboard chokepoint carries (`assertSameTenantReference`'s reference
 * lookup — see the header of `src/lib/api/tenant-scoped-sanity.ts`).
 */
export const UNSCOPED_READ_EXEMPTIONS = {
  fetchDesignSystemById:
    'Design systems are deliberately SHARED across projects — that is what ' +
    'design-system inheritance means. The resolver follows `parentDesignSystem->` ' +
    'from a document it has already reached through the project-scoped ' +
    '`designSystemQuery`, so the parent is reached by reference from an ' +
    'already-scoped document, never by an attacker-controlled id: the `_id` comes ' +
    'from the child design system in Sanity, not from the request. Scoping this ' +
    'fetch by $projectSlug would break inheritance outright.',
} as const

export type UnscopedReadExemption = keyof typeof UNSCOPED_READ_EXEMPTIONS

/**
 * Runs a read that is exempt from the tenant-scope guard. The `exemption`
 * argument is not decoration: it is the key of the audited entry in
 * `UNSCOPED_READ_EXEMPTIONS` that justifies this call, and the union type
 * makes it impossible to invent a new exemption at the call site.
 */
// `T = any` reproduces `sanityClient.fetch`'s own default type parameter
// exactly, so routing a call through this helper does not narrow its result to
// `unknown` and change the caller's inferred types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fetchUnscoped<T = any>(
  query: string,
  params: Record<string, unknown>,
  exemption: UnscopedReadExemption
): Promise<T> {
  void exemption
  return sanityClient.fetch<T>(query, params)
}

/**
 * Fetch a design system by its Sanity _id.
 * Used by the design system inheritance resolver to fetch parent design systems.
 *
 * Uses DS_FIELDS_SELECTION from queries.ts — the single canonical field list.
 * Do NOT add fields here directly; add them to DS_FIELDS_SELECTION instead.
 *
 * EXEMPT from the `$projectSlug` scope guard, explicitly and by name — see
 * `UNSCOPED_READ_EXEMPTIONS.fetchDesignSystemById` for why. It does not use
 * `fetchForTenant` (it has no tenant slug to hand it) and must not: an
 * inherited parent design system belongs to a different project on purpose.
 */
export async function fetchDesignSystemById(id: string) {
  const query = /* groq */ `*[_id == $id && _type == "designSystem"][0] ${DS_FIELDS_SELECTION}`
  return fetchUnscoped(query, { id }, 'fetchDesignSystemById')
}
