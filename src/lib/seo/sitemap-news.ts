import type { MetadataRoute } from 'next'
import { canonicalUrl } from './canonical'

/**
 * GROQ projection (inside a `project` document) — true when the site serves a
 * news index: the News module is installed and enabled, and a published
 * newsPage exists for the project. Both conditions match what /{locale}/news
 * needs to render something.
 */
export const HAS_NEWS_INDEX_PROJECTION = /* groq */ `"hasNewsIndex": count(moduleInstallations[moduleId == "news" && enabled != false]) > 0
  && defined(*[_type == "newsPage" && projectSlug == ^.projectSlug && !(_id in path("drafts.**"))][0]._id)`

/** One `/{locale}/news` entry per site language, when the site has a news index. */
export function newsIndexSitemapEntries(opts: {
  hasNewsIndex: boolean | null | undefined
  origin: string
  locales: readonly string[]
  primaryLocale: string
}): MetadataRoute.Sitemap {
  if (!opts.hasNewsIndex) return []
  return opts.locales.map((locale) => ({
    url: canonicalUrl(opts.origin, locale, 'news')!,
    changeFrequency: 'weekly' as const,
    priority: locale === opts.primaryLocale ? 0.7 : 0.6,
  }))
}
