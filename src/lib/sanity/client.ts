import { createClient } from '@sanity/client'
import {
  asProjectSlug,
  unbrand,
  type ProjectSlug,
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

// ─── Route allow-list: moved out of this file ────────────────────────────────
// `isKnownProjectSegment()` now lives in `@/lib/tenancy/host-scope`, derived
// from the generated route table.
//
// Its history in one paragraph, because it has been deleted by accident once
// already: it began as the null branch of `tryTenantToProjectSlug()`, whose map
// `TENANT_TO_PROJECT` did TWO jobs — translate a URL segment to Sanity's
// separate name for the project, and answer "is this segment a project at all?".
// RENAME.md Step 4 made the two names one, so Step 5 deleted the translation
// and kept the KEYS as a hand-typed `KNOWN_PROJECT_SEGMENTS` set. Step 6 could
// then delete that too: the same set is a projection of Supabase's `projects`
// table, which `scripts/generate-route-config.mjs` already emits.
//
// The allow-list is not optional and it is not cosmetic: the `(website)/[tenant]`
// layout calls it and `notFound()`s on false, so an unknown segment produces a
// clean 404 rather than a 200 with an empty page.

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
 *
 * Accepts EITHER a `[tenant]` URL segment (the website route group) or a
 * `ProjectSlug` (the dashboard resolver, which holds `projects.slug`). They
 * are the same string for every project alive today — that is what Step 4 of
 * `src/lib/tenancy/RENAME.md` established — so the value is bound to
 * `$projectSlug` verbatim, with no lookup and no translation.
 *
 * ⚠️ The union, not a cast, is still the honest shape. Step 6 removed the
 * hand-written AUTHORITY behind `UrlProjectSegment` — the segment is now a
 * projection of `projects.slug` from the generated route table — but it did
 * NOT collapse the brand, deliberately: the two remain different TRUST levels.
 * A `UrlProjectSegment` is an unvalidated path parameter from the open
 * internet; a `ProjectSlug` has been checked. Merging them would delete the
 * type-level reason the route boundary has to call `isKnownProjectSegment()`
 * at all. Collapsing it is a separate change with its own review.
 * This function does not THROW on an unrecognised value: validity is the
 * route boundary's job, via `isKnownProjectSegment()`
 * (`@/lib/tenancy/host-scope`).
 */
export function tenantClient(tenantSlug: UrlProjectSegment | ProjectSlug) {
  if (!tenantSlug) {
    throw new Error('tenantSlug is required — never query Sanity without a tenant scope')
  }

  const projectSlug: ProjectSlug = asProjectSlug(unbrand(tenantSlug))

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

      // Step 5 dropped the `projectSlugs` dual-read binding: every query in
      // `queries.ts` is back to `projectSlug == $projectSlug`, because the
      // documents now carry the same name Supabase does.
      return sanityClient.fetch<T>(query, {
        ...params,
        projectSlug,
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
