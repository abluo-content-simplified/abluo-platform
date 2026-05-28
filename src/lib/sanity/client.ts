import { createClient } from '@sanity/client'

// NEXT_PUBLIC_ vars are inlined at build time by Next.js/Turbopack.
// Using a non-empty fallback ('unconfigured') prevents createClient from
// throwing at module-evaluation time when the var is not yet in the build
// environment. Real requests will simply fail at runtime if projectId is wrong.
export const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'unconfigured',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  useCdn: process.env.NODE_ENV === 'production',
})

/**
 * Returns a tenant-scoped fetch helper.
 * Every query MUST include a `$tenantId` parameter — this enforces
 * the multi-tenant isolation rule at the call site.
 *
 * Usage:
 *   const { fetchForTenant } = tenantClient('livener')
 *   const posts = await fetchForTenant(postsQuery, { limit: 10 })
 */
export function tenantClient(tenantId: string) {
  if (!tenantId) {
    throw new Error('tenantId is required — never query Sanity without a tenant scope')
  }

  return {
    fetchForTenant<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
      return sanityClient.fetch<T>(query, { ...params, tenantId })
    },
  }
}
