import { createClient } from '@sanity/client'
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

// ─── Tenant → Project slug mapping ───────────────────────────────────────────
// Maps the URL tenant slug (e.g. "livener") to the Sanity project slug
// (e.g. "livener-main"). Add a new entry when onboarding a new client.
const TENANT_TO_PROJECT: Record<string, string> = {
  livener: 'livener-main',
  studiomartegani: 'studiomartegani-main',
  'abluo-the-tiny-cms': 'abluo',
  nologo: 'nologo',
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
export function tryTenantToProjectSlug(tenantSlug: string): string | null {
  return TENANT_TO_PROJECT[tenantSlug] ?? null
}

export function tenantToProjectSlug(tenantSlug: string): string {
  const projectSlug = tryTenantToProjectSlug(tenantSlug)
  if (!projectSlug) {
    throw new Error(
      `No project mapping for tenant "${tenantSlug}". Add it to TENANT_TO_PROJECT in client.ts.`
    )
  }
  return projectSlug
}

/**
 * Returns a project-scoped fetch helper.
 * Accepts the URL tenant slug (e.g. "livener") and resolves it to the
 * Sanity projectSlug (e.g. "livener-main") before injecting into queries.
 */
export function tenantClient(tenantSlug: string) {
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
      return sanityClient.fetch<T>(query, { ...params, projectSlug, tenantSlug })
    },
  }
}

/**
 * Fetch a design system by its Sanity _id.
 * Used by the design system inheritance resolver to fetch parent design systems.
 *
 * Uses DS_FIELDS_SELECTION from queries.ts — the single canonical field list.
 * Do NOT add fields here directly; add them to DS_FIELDS_SELECTION instead.
 */
export async function fetchDesignSystemById(id: string) {
  const query = /* groq */ `*[_id == $id && _type == "designSystem"][0] ${DS_FIELDS_SELECTION}`
  return sanityClient.fetch(query, { id })
}
