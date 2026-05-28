import { createClient } from '@sanity/client'

// Credentials are hardcoded — they are not secrets (NEXT_PUBLIC_ values end up
// in the client bundle regardless). This removes any dependency on Vercel env
// var state, which proved unreliable during initial setup.
export const sanityClient = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
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
