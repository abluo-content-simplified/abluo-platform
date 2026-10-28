import { cache } from 'react'
import { tenantClient } from '@/lib/sanity/client'
import { sitePageSlugsQuery } from '@/lib/sanity/queries'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { normalizeSitePageSlugs, type SitePageSlug } from './localize-site-path'

/**
 * The project's pages with their slug per language, read once per request
 * (React cache) — the data localizeSitePath() needs. A failed read returns []
 * so links fall back to exactly what was authored.
 */
export const getSitePageSlugs = cache(async (projectSlug: string): Promise<SitePageSlug[]> => {
  if (!projectSlug) return []
  try {
    const rows = await tenantClient(asProjectSlug(projectSlug)).fetchForTenant<unknown>(sitePageSlugsQuery, {})
    return normalizeSitePageSlugs(rows)
  } catch (err) {
    console.error('[links] page slug map read failed; site paths left as authored', err)
    return []
  }
})
