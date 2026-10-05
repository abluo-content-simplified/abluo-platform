/**
 * Write-path guard: exactly ONE Sanity `project` document carries this
 * projectSlug.
 *
 * Sanity scopes every document by `projectSlug` alone (no tenant), while
 * Supabase only keeps `projects.slug` unique per tenant (migration 023). If two
 * projects ever share a slug — two Supabase rows, or a stray duplicate
 * `project` document — every post / media / siteConfig document with that
 * slug is shared, and an "ownership" check (`doc.projectSlug === grant's`)
 * proves nothing. `getTenantAuthorizationContext` already drops grants whose
 * Supabase slug is shared (`dropAmbiguousSlugGrants`); this is the Sanity-side
 * half, called by the client-dashboard write path right before every
 * mutation. Anything but exactly one → TenantAuthorizationError ('forbidden').
 */
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

export const SANITY_PROJECT_COUNT_QUERY = /* groq */ `count(*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))])`

export type CountFetch = (query: string, params: Record<string, unknown>) => Promise<unknown>

export async function assertSingleSanityProject(fetch: CountFetch, projectSlug: string): Promise<void> {
  const count = await fetch(SANITY_PROJECT_COUNT_QUERY, { projectSlug })
  if (count !== 1) {
    throw new TenantAuthorizationError(
      `assertSingleSanityProject: ${typeof count === 'number' ? count : 'unknown'} Sanity project documents ` +
        `carry projectSlug "${projectSlug}" — writes refused until it is exactly one.`
    )
  }
}
