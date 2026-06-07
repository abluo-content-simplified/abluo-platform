import { createClient } from '@sanity/client'

export const sanityClient = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
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
}

export function tenantToProjectSlug(tenantSlug: string): string {
  const projectSlug = TENANT_TO_PROJECT[tenantSlug]
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
