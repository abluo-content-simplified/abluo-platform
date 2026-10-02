/**
 * News and blog listings for `/llms.txt` (src/app/llms.txt/route.ts).
 *
 * Kept outside the route file because a Next.js route module may only export
 * route handlers and route config; these are imported by the route and by
 * tests.
 */

import { canonicalUrl } from '@/lib/seo/canonical'

/** A published blog post or news item — per-locale maps, like PageRow. */
export interface EntryRow {
  titles?: Record<string, string | undefined>
  slugs?: Record<string, { current?: string } | undefined>
  descriptions?: Record<string, string | undefined>
  excerpts?: Record<string, string | undefined>
}

/**
 * Published, unexpired news items (ADR-020) — the same visibility rule the
 * sitemap applies, so llms.txt never lists a URL the sitemap does not. Newest
 * first. News and posts carry no `noindex` field (it is `page`-only), so there
 * is nothing further to skip.
 */
export const LLMS_NEWS_QUERY = /* groq */ `*[
  _type == "newsArticle"
  && projectSlug == $projectSlug
  && defined(publishedAt)
  && publishedAt <= now()
  && (!defined(expiresAt) || expiresAt > now())
] | order(publishedAt desc) {
  "titles": title,
  "slugs": slug,
  "descriptions": seoDescription,
  "excerpts": excerpt
}`

/**
 * Published, unexpired blog posts — the visibility rule the blog listings
 * apply. Newest first.
 */
export const LLMS_POSTS_QUERY = /* groq */ `*[
  _type == "post"
  && projectSlug == $projectSlug
  && defined(publishedAt)
  && publishedAt <= now()
  && (!defined(expiresAt) || expiresAt > now())
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
