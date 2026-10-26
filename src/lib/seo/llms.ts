/**
 * News and blog listings for `/llms.txt` (src/app/llms.txt/route.ts).
 *
 * Kept outside the route file because a Next.js route module may only export
 * route handlers and route config; these are imported by the route and by
 * tests.
 */

import { canonicalUrl } from '@/lib/seo/canonical'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { visibilityFilter } from '@/lib/modules/catalogue/visibility'
import { pageIsOpen } from '@/lib/access/groq'

/**
 * Pages for llms.txt. ADR-040 — a closed page's title and description are
 * never read: only `open` and its slugs come back, and the route then drops it
 * (and everything under its path) with isListable().
 */
export const LLMS_PAGES_QUERY = /* groq */ `*[_type == "page" && projectSlug == $projectSlug && !(noindex == true)] | order(pageType asc) {
  pageType,
  "slugs": slug,
  "open": ${pageIsOpen()},
  ${pageIsOpen()} => { "titles": title, "descriptions": seoDescription }
}`

/** A published blog post or news item — per-locale maps, like PageRow. */
export interface EntryRow {
  titles?: Record<string, string | undefined>
  slugs?: Record<string, { current?: string } | undefined>
  descriptions?: Record<string, string | undefined>
  excerpts?: Record<string, string | undefined>
}

/**
 * Public news items (ADR-020; ADR-032 D3 rule) — the same visibility rule the
 * sitemap applies, so llms.txt never lists a URL the sitemap does not. Newest
 * first. News and posts carry no `noindex` field (it is `page`-only), so there
 * is nothing further to skip.
 */
export const LLMS_NEWS_QUERY = /* groq */ `*[
  _type == "newsArticle"
  && projectSlug == $projectSlug
  && ${publicFilterFor('newsArticle')}
] | order(publishedAt desc) {
  "titles": title,
  "slugs": slug,
  "descriptions": seoDescription,
  "excerpts": excerpt
}`

/**
 * Public blog posts (ADR-032 D3 rule) — the visibility rule the blog listings
 * apply. Newest first.
 */
export const LLMS_POSTS_QUERY = /* groq */ `*[
  _type == "post"
  && projectSlug == $projectSlug
  && ${publicFilterFor('post')}
] | order(publishedAt desc) {
  "titles": title,
  "slugs": slug,
  "descriptions": seoDescription,
  "excerpts": excerpt
}`

/**
 * One language's link lines for routable entries under a route prefix
 * (`news`, `blog`). An entry with no slug or no title in that language does
 * not exist in it and is skipped — the same rule pages follow. Pure, so it
 * can be tested without a request.
 */
export function entryLinesFor(
  entries: EntryRow[],
  origin: string,
  loc: string,
  routePrefix: string
): string[] {
  const out: string[] = []
  for (const entry of entries) {
    const slug = entry.slugs?.[loc]?.current
    const label = entry.titles?.[loc]
    if (!slug || !label) continue
    const url = canonicalUrl(origin, loc, routePrefix, slug)
    if (!url) continue
    const description = entry.descriptions?.[loc] ?? entry.excerpts?.[loc]
    out.push(description ? `- [${label}](${url}): ${description}` : `- [${label}](${url})`)
  }
  return out
}

// ── Catalogue (ADR-033 C5, C10) ───────────────────────────────────────────────
// Included, under the 'structuredData' visibility context — the one ADR-033
// C10 names for llms.txt: `unlisted` items and collections are left out (their
// pages are noindex), `public` and `websiteOnly` are listed, exactly as the
// sitemap lists them. Only documents with their own page (`hasPage`) have a
// URL to list. The ADR-032 D3 lifecycle rule applies first, as everywhere.
// Routed under the project's ONE public segment (D11), read separately below.

/** Public catalogue collections with a page — `entryLinesFor` rows. */
export const LLMS_CATALOGUE_COLLECTIONS_QUERY = /* groq */ `*[
  _type == "catalogueCollection"
  && projectSlug == $projectSlug
  && hasPage == true
  && ${publicFilterFor('catalogueCollection')}
  && ${visibilityFilter('structuredData')}
] | order(_createdAt asc) {
  "titles": name,
  "slugs": slug,
  "descriptions": description
}`

/** Public catalogue items with a page — `entryLinesFor` rows. */
export const LLMS_CATALOGUE_ITEMS_QUERY = /* groq */ `*[
  _type == "catalogueItem"
  && projectSlug == $projectSlug
  && hasPage == true
  && ${publicFilterFor('catalogueItem')}
  && ${visibilityFilter('structuredData')}
] | order(_createdAt asc) {
  "titles": name,
  "slugs": slug,
  "descriptions": description
}`

/** The enabled catalogue installation's public segment, or null (no module → no routes). */
export const LLMS_CATALOGUE_SEGMENT_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug][0].moduleInstallations[moduleId == "catalogue" && enabled != false][0].config.publicSegment`

/**
 * One language's catalogue link lines: collections first, then items, all
 * under the segment. No segment (module off) → nothing, whatever the rows say.
 */
export function catalogueLinesFor(
  rows: { collections: EntryRow[]; items: EntryRow[] },
  segment: string | null | undefined,
  origin: string,
  loc: string,
): string[] {
  if (!segment) return []
  return [...entryLinesFor(rows.collections, origin, loc, segment), ...entryLinesFor(rows.items, origin, loc, segment)]
}
