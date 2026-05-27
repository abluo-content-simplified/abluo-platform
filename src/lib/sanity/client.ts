import { createClient } from '@sanity/client'

export const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
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
