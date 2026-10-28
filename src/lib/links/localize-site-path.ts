/**
 * Localized site-relative paths.
 *
 * Some link fields are free text (an event host's link, an event's
 * registration URL, a CTA's URL) and editors write a site path in ONE
 * language, e.g. `/teachers#elena-constantinides`. The platform prefixes
 * `/{locale}/{tenant}/` (withTenantPrefix in @/lib/sanity/href) but keeps the
 * path, so on the French site that link became `/fr/cyce/teachers#…`, which
 * 404s: the page's French slug is `professeurs`.
 *
 * localizeSitePath() rewrites the path's leading page slug — matched against
 * the slugs of the project's pages in ANY language, longest match wins so
 * nested slugs work — to that page's slug in the visitor's language. The
 * `#anchor` and `?query` are kept. Anything it does not recognise is returned
 * exactly as authored, so the fix can never break a link that worked.
 *
 * Pure: no React, no Next.js. The page list comes from sitePageSlugsQuery,
 * read once per request by getSitePageSlugs (./page-slugs.server).
 */
import { isPassThroughHref } from '@/lib/sanity/href'

/** One page of the project: its id, type and slug per locale. */
export interface SitePageSlug {
  _id: string
  pageType?: string | null
  /** Slug per locale, without leading/trailing slashes. */
  slugs: Record<string, string>
}

/**
 * Route segments owned by the platform (folders under `(website)/[tenant]/`).
 * A path starting with one of these is a module route, never a page, so it is
 * left alone even if a page happens to use the same word as a slug.
 */
const PLATFORM_ROUTE_SEGMENTS = new Set(['blog', 'news', 'events', 'live', 'category', 'brand', 'preview', 'site-access'])

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '')

/**
 * Normalise the raw query rows (`slugs` is the localizedSlug object:
 * `{ _type, en: { current }, fr: { current } }`) into SitePageSlug[].
 */
export function normalizeSitePageSlugs(raw: unknown): SitePageSlug[] {
  if (!Array.isArray(raw)) return []
  const out: SitePageSlug[] = []
  for (const row of raw as { _id?: unknown; pageType?: unknown; slugs?: unknown }[]) {
    if (!row || typeof row._id !== 'string' || !row.slugs || typeof row.slugs !== 'object') continue
    const slugs: Record<string, string> = {}
    for (const [loc, value] of Object.entries(row.slugs as Record<string, unknown>)) {
      if (loc.startsWith('_')) continue
      const current = typeof value === 'string' ? value : (value as { current?: unknown } | null)?.current
      if (typeof current === 'string' && trimSlashes(current.trim())) slugs[loc] = trimSlashes(current.trim())
    }
    if (Object.keys(slugs).length > 0) {
      out.push({ _id: row._id, pageType: typeof row.pageType === 'string' ? row.pageType : null, slugs })
    }
  }
  return out
}

/**
 * Rewrite a site-relative path to the visitor's language.
 *
 *   /teachers#elena   (fr) → /professeurs#elena
 *   /professeurs#elena (fr) → unchanged (already French)
 *   /about/team?x=1   (fr) → /a-propos/equipe?x=1 (nested slug)
 *   /home             (any) → /   (the home page)
 *   /, #x, https://…, mailto:… and unknown paths → unchanged
 *
 * A page without a slug in `locale` leaves the link unchanged.
 */
export function localizeSitePath<T extends string | null | undefined>(
  href: T,
  locale: string | null | undefined,
  pages: readonly SitePageSlug[] | null | undefined
): T {
  if (!href || !locale || !pages?.length) return href
  const raw = href.trim()
  if (isPassThroughHref(raw)) return href

  const cut = raw.search(/[?#]/)
  const path = cut === -1 ? raw : raw.slice(0, cut)
  const suffix = cut === -1 ? '' : raw.slice(cut)
  const clean = trimSlashes(path)
  if (!clean) return href // home stays home
  if (PLATFORM_ROUTE_SEGMENTS.has(clean.split('/')[0])) return href

  // Longest slug prefix on whole segments; on a tie prefer the visitor's
  // language, so a slug already in that language is never re-pointed.
  let best: { page: SitePageSlug; length: number; sameLocale: boolean } | null = null
  for (const page of pages) {
    for (const [loc, slug] of Object.entries(page.slugs)) {
      if (clean !== slug && !clean.startsWith(slug + '/')) continue
      const candidate = { page, length: slug.length, sameLocale: loc === locale }
      if (
        !best ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate.sameLocale && !best.sameLocale)
      ) {
        best = candidate
      }
    }
  }
  if (!best) return href

  const target = best.page.pageType === 'home' ? '' : best.page.slugs[locale]
  if (target === undefined) return href // not translated: keep as authored
  const rest = clean.slice(best.length) // '' or '/…'
  const localized = trimSlashes(`${target}${rest}`)
  const leading = path.startsWith('/') || !localized ? '/' : ''
  return `${leading}${localized}${suffix}` as T
}

/** A free-text link field holding a site-relative path: `obj[key]`. */
export interface SiteLinkSlot {
  obj: Record<string, unknown>
  key: string
}

const isSitePath = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().startsWith('/') && !isPassThroughHref(v.trim())

/**
 * Every free-text link field under `root` that holds a site-relative path:
 *   - a CTA's `externalUrl` (actionType 'externalUrl');
 *   - an event's `registrationUrl`;
 *   - an event host's `url` (`hosts[].url`).
 * Walks hydrated section data or event objects; absolute URLs, `#anchors`,
 * `mailto:` / `tel:` are not collected.
 */
export function findSiteLinkSlots(root: unknown): SiteLinkSlot[] {
  const slots: SiteLinkSlot[] = []
  const seen = new WeakSet<object>()
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const obj = node as Record<string, unknown>
    if (obj.actionType === 'externalUrl' && isSitePath(obj.externalUrl)) slots.push({ obj, key: 'externalUrl' })
    if (isSitePath(obj.registrationUrl)) slots.push({ obj, key: 'registrationUrl' })
    if (Array.isArray(obj.hosts)) {
      for (const host of obj.hosts) {
        if (host && typeof host === 'object' && isSitePath((host as Record<string, unknown>).url)) {
          slots.push({ obj: host as Record<string, unknown>, key: 'url' })
        }
      }
    }
    for (const value of Object.values(obj)) walk(value)
  }
  walk(root)
  return slots
}

/**
 * Localize every site-relative free-text link under `root` in place (see
 * findSiteLinkSlots). `loadPages` is called only when there is at least one
 * such link, so pages without one never read the slug map.
 */
export async function localizeSiteLinks(
  root: unknown,
  locale: string,
  loadPages: () => Promise<readonly SitePageSlug[]>
): Promise<void> {
  const slots = findSiteLinkSlots(root)
  if (slots.length === 0) return
  const pages = await loadPages()
  for (const { obj, key } of slots) obj[key] = localizeSitePath(obj[key] as string, locale, pages)
}
