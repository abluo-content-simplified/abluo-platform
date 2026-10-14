import type { MetadataRoute } from 'next'
import { canonicalUrl } from './canonical'
import { withImages } from './sitemap-images'

/**
 * Catalogue sitemap entries (ADR-033 D4.4, D11, C1; spec §6.5) for ONE project.
 *
 * The rows come from SITEMAP_CATALOGUE_* in ./sitemap-queries.ts, which have
 * already applied every rule that decides whether a document is listed: a page
 * (`hasPage`), the ADR-032 D3 lifecycle rule and the sitemap visibility context
 * (no `unlisted`). This function only turns rows into URLs: one per site locale
 * whose slug is set, under the project's segment. Pure, so it is tested without
 * a request.
 */

export type CatalogueSitemapRow = {
  projectSlug: string
  slug?: Record<string, { current?: string } | undefined> | null
  /** The project's current public segment (rows without one are dropped by the query). */
  segment?: string | null
  images?: string[] | null
}

export type CatalogueLandingSitemapRow = {
  projectSlug: string
  segment?: string | null
}

export function catalogueSitemapEntries(opts: {
  items: readonly CatalogueSitemapRow[]
  collections: readonly CatalogueSitemapRow[]
  landing: CatalogueLandingSitemapRow | null | undefined
  origin: string
  locales: readonly string[]
  primaryLocale: string
}): MetadataRoute.Sitemap {
  const { origin, locales, primaryLocale } = opts
  const out: MetadataRoute.Sitemap = []

  const landingSegment = opts.landing?.segment
  if (landingSegment) {
    for (const locale of locales) {
      out.push({
        url: canonicalUrl(origin, locale, landingSegment)!,
        changeFrequency: 'weekly',
        priority: locale === primaryLocale ? 0.7 : 0.6,
      })
    }
  }

  const push = (rows: readonly CatalogueSitemapRow[], priority: [number, number]) => {
    for (const row of rows) {
      if (!row.segment) continue
      for (const locale of locales) {
        const slug = row.slug?.[locale]?.current
        if (!slug) continue
        out.push({
          url: canonicalUrl(origin, locale, row.segment, slug)!,
          changeFrequency: 'weekly',
          priority: locale === primaryLocale ? priority[0] : priority[1],
          ...withImages(row.images),
        })
      }
    }
  }
  push(opts.collections, [0.7, 0.6])
  push(opts.items, [0.6, 0.5])
  return out
}
