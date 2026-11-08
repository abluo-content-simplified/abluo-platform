/**
 * Dashboard search (ADR-047) — "View on website" URLs.
 *
 * The module declares WHERE its public page lives (`SearchSiteRoute`: a
 * visibility rule, the slug field, the path segment); this file turns the
 * answers of the one Sanity request into an absolute URL. The origin and the
 * path come from the same helpers the sitemap uses (canonicalOrigin /
 * canonicalUrl, ADR-034), so a search link is exactly the address the site
 * publishes for the page.
 */
import { canonicalOrigin, canonicalUrl } from '@/lib/seo/canonical'
import type { SanitySearchDef } from './sanity-search'

/** Key under which the project facts travel in the same response. */
export const PROJECT_KEY = '_project'

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `segment` projection key of a declaration inside the project facts. */
export const segmentKey = (kind: string) => `seg_${kind}`

/** What the request reads about the project (see buildSearchQuery). */
export type SiteFacts = {
  customDomain?: unknown
  locales?: unknown
  [segmentKey: string]: unknown
}

export type SiteContext = {
  /** `https://www.<domain>`, null without a custom domain. */
  origin: string | null
  /** Languages of the website (default first). */
  locales: string[]
  defaultLocale: string
  facts: SiteFacts
}

export function siteContext(facts: unknown, defaultLocale: string): SiteContext {
  const f = (facts && typeof facts === 'object' ? facts : {}) as SiteFacts
  const domain = typeof f.customDomain === 'string' ? f.customDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') : ''
  const origin = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? canonicalOrigin(domain.toLowerCase()) : null
  const listed = Array.isArray(f.locales) ? f.locales.filter((l): l is string => typeof l === 'string' && l.length > 0) : []
  const locales = [defaultLocale, ...listed.filter((l) => l !== defaultLocale)]
  return { origin, locales, defaultLocale, facts: f }
}

const cleanSegment = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  return SEGMENT.test(s) && s.length <= 64 ? s : null
}

/** The segment of one language: a fixed word, or the module config's string / per-language value. */
function segmentFor(def: SanitySearchDef, ctx: SiteContext, locale: string): string | null {
  const seg = def.source.site?.segment
  if (!seg) return null
  if ('fixed' in seg) return seg.fixed
  const raw = ctx.facts[segmentKey(def.kind)]
  if (typeof raw === 'string') return cleanSegment(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return cleanSegment((raw as Record<string, unknown>)[locale])
  return null
}

const slugIn = (slugs: unknown, locale: string): string | null => {
  if (!slugs || typeof slugs !== 'object') return null
  const cur = (slugs as Record<string, { current?: unknown } | undefined>)[locale]?.current
  return typeof cur === 'string' && cur ? cur : null
}

/**
 * The public URL of one item, or undefined. Only when the PUBLISHED document is
 * visible (`live`), the project has a domain, and a page exists in the language:
 * the viewer's language when the website has it, else the site default. No
 * fallback to a language without a slug or segment (such a page 404s).
 */
export function siteUrlFor(def: SanitySearchDef, state: { live: boolean; slugs: unknown }, ctx: SiteContext, viewerLocale: string): string | undefined {
  if (!def.source.site || !state.live || !ctx.origin) return undefined
  const candidates = ctx.locales.includes(viewerLocale) ? [viewerLocale, ctx.defaultLocale] : [ctx.defaultLocale]
  for (const locale of candidates) {
    const slug = slugIn(state.slugs, locale)
    const segment = segmentFor(def, ctx, locale)
    if (slug && segment) return canonicalUrl(ctx.origin, locale, segment, slug)
  }
  return undefined
}
