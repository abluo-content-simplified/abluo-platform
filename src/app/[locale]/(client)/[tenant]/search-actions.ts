'use server'

/**
 * Dashboard search (ADR-047). The caller is resolved by the one project-scoped
 * resolver; the project slug in the request only PICKS the grant (ambiguity and
 * unreachable projects fail closed) and is never used for a query — the
 * grant's own slug is. Any failure is logged here and returned as `failed`.
 */
import { getLocale } from 'next-intl/server'
import { getDashboardSubmissions } from '@/lib/api/client-dashboard'
import { coursesTaughtBy } from '@/lib/api/course-schedule'
import { canModuleAction } from '@/lib/api/module-action-guard'
import { grantCanManageMedia, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { resolveProjectAction } from '@/lib/api/project-action'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { normalizeQuery, runSearch } from '@/lib/search/run'
import { REQUESTS_SEARCH_SCAN } from '@/lib/search/requests-search'
import type { SearchRequest, SearchResponse } from '@/lib/search/types'

export async function searchDashboardAction(req: SearchRequest): Promise<SearchResponse> {
  const raw = typeof req?.q === 'string' ? req.q : ''
  try {
    const norm = normalizeQuery(raw)
    if ('error' in norm) return { ok: false, q: raw, error: norm.error }

    const access = await resolveProjectAction(req.projectSlug)
    if (!access.ok) return { ok: false, q: norm.q, error: 'unauthorized' }
    const { ctx, grant } = access

    return await runSearch(
      {
        projectSlug: grant.projectSlug,
        q: norm.q,
        includeArchived: req.includeArchived === true,
        locale: await getLocale(),
        access: {
          isEnabled: (moduleId) => moduleId === undefined || grant.enabledModuleIds.includes(moduleId),
          can: (permission) =>
            permission === MEDIA_MANAGE_PERMISSION
              ? grantCanManageMedia(grant)
              : canModuleAction(ctx, grant.projectId, permission),
          hideContactRequests: Boolean(ctx.support && !ctx.support.contactRequestsShown),
        },
      },
      {
        fetchSanity: (query, params) =>
          sanityWriteClient.fetch<Record<string, unknown> | null>(query, params, { perspective: 'raw' }),
        loadRequests: () => getDashboardSubmissions(ctx, grant.projectId, { limit: REQUESTS_SEARCH_SCAN }),
        // The engine only calls this when courses are installed + readable (permittedSources) and a teacher matched by name.
        relatedLoaders: { courses: (people) => coursesTaughtBy(grant.projectId, people) },
      }
    )
  } catch (error) {
    console.error('dashboard search failed', error instanceof Error ? error.message : 'unknown error')
    return { ok: false, q: raw, error: 'failed' }
  }
}
