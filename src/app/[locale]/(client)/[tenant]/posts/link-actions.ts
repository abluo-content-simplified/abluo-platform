'use server'

/**
 * Client dashboard — find a page of the site to link to (ADR-025 · links).
 *
 * Thin wrapper over `src/lib/api/post-link-search.ts`, which holds every
 * check. Identity is re-resolved server-side on each call; the projectSlug
 * only picks one of the caller's own grants.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostLinkSearchError, searchLinkTargets, type LinkTargetResult } from '@/lib/api/post-link-search'

export type LinkSearchResult = { ok: true; results: LinkTargetResult[] } | { ok: false; error: 'unauthenticated' | 'forbidden' | 'invalid_value' | 'failed' }

export async function searchLinkTargetsAction(input: {
  projectSlug: string
  locale: string
  query?: string
  ids?: string[]
}): Promise<LinkSearchResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = typeof input?.projectSlug === 'string' ? resolveProjectGrant(ctx.projects, input.projectSlug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    return { ok: true, results: await searchLinkTargets(ctx, grant.projectId, { locale: input.locale, query: input.query, ids: input.ids }) }
  } catch (error) {
    if (error instanceof PostLinkSearchError) return { ok: false, error: 'invalid_value' }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
