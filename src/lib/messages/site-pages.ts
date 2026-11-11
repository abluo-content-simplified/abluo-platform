// Server-only: reads one project's published pages from Sanity.
import { asProjectSlug } from '@/lib/tenancy/ids'
import { tenantClient } from '@/lib/sanity/client'
import { SITE_PAGES_QUERY } from './site-pages-query'

/** A page of the recipient's website a message may point at ("Hey, look here"). `page` '' = the home page. */
export type SitePageOption = { page: string; label: string }

type Row = { pageType?: string | null; title?: Record<string, string | null> | null; slug?: Record<string, { current?: string | null } | null> | null }


const pick = (map: Record<string, string | null> | null | undefined, locale: string): string => {
  if (!map) return ''
  return (map[locale] || map.it || map.en || Object.values(map).find((v) => typeof v === 'string' && v.trim()) || '').trim()
}

/** Pure: Sanity rows → options in the site's default language; the home page first, pages without a slug skipped. */
export function sitePageOptions(rows: readonly Row[], locale: string): SitePageOption[] {
  const out: SitePageOption[] = []
  for (const r of rows) {
    const home = r.pageType === 'home'
    const slug = home ? '' : (r.slug?.[locale]?.current ?? '').trim().replace(/^\/+|\/+$/g, '')
    if (!home && !slug) continue
    if (out.some((o) => o.page === slug)) continue
    out.push({ page: slug, label: pick(r.title, locale) || (home ? 'Home' : slug) })
  }
  return out
}

/** The project's published pages, or [] when Sanity cannot be read (the chooser then simply offers none). */
export async function listSitePages(projectSlug: string, locale: string): Promise<SitePageOption[]> {
  try {
    const rows = await tenantClient(asProjectSlug(projectSlug)).fetchForTenant<Row[]>(SITE_PAGES_QUERY, { locale })
    return sitePageOptions(rows ?? [], locale)
  } catch (err) {
    console.error('[messages] site pages unavailable', err instanceof Error ? err.message : err)
    return []
  }
}
