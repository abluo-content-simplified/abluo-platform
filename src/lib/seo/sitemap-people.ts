import type { MetadataRoute } from 'next'
import { canonicalUrl } from './canonical'
import { cleanProfileSegments } from '@/lib/modules/people/website'

/**
 * People profile pages in the sitemap (ADR-043 D7; Requirement 4 of the
 * Publicly Routable Content Pattern) for ONE project.
 *
 * The rows come from SITEMAP_PEOPLE_QUERY (src/lib/modules/people/queries.ts),
 * which already keeps only listable people whose visibility is "page" — off,
 * archived and anonymised people never appear. This turns rows into URLs: one
 * per site locale where BOTH the person's slug and the language's profile
 * segment are set. Pure, so it is tested without a request.
 */
export type PeopleSitemapRow = {
  slugMap?: Record<string, { current?: string | null } | undefined> | null
  _updatedAt?: string | null
}

export function peopleSitemapEntries(opts: {
  rows: readonly PeopleSitemapRow[] | null | undefined
  /** Raw module config `profileSegment` (a localizedString); invalid entries are ignored. */
  profileSegment: unknown
  origin: string
  locales: readonly string[]
  primaryLocale: string
}): MetadataRoute.Sitemap {
  const segments = cleanProfileSegments(opts.profileSegment)
  const out: MetadataRoute.Sitemap = []
  for (const row of opts.rows ?? []) {
    for (const locale of opts.locales) {
      const segment = segments[locale]
      const slug = row.slugMap?.[locale]?.current
      if (!segment || !slug) continue
      out.push({
        url: canonicalUrl(opts.origin, locale, segment, slug)!,
        ...(row._updatedAt ? { lastModified: new Date(row._updatedAt) } : {}),
        changeFrequency: 'monthly',
        priority: locale === opts.primaryLocale ? 0.5 : 0.4,
      })
    }
  }
  return out
}
