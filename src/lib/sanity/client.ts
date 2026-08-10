import { createClient } from '@sanity/client'
import { DS_FIELDS_SELECTION } from '@/lib/sanity/queries'

export const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  // CDN disabled: the CDN caches empty GROQ results when a query field (projectSlug)
  // didn't exist at cache-warm time. Direct API always reflects the current dataset.
  useCdn: false,
})

// ─── Tenant → Project slug mapping ───────────────────────────────────────────
// Maps the URL tenant slug (e.g. "livener") to the Sanity project slug
// (e.g. "livener-main"). Add a new entry when onboarding a new client.
const TENANT_TO_PROJECT: Record<string, string> = {
  livener: 'livener-main',
  studiomartegani: 'studiomartegani-main',
  'abluo-the-tiny-cms': 'abluo',
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
      return sanityClient.fetch<T>(query, { ...params, projectSlug })
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
