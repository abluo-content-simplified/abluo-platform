/**
 * Body links on the websites — where a link goes and whether it opens a new
 * tab (ADR-025 · links round 2). Pure, no React / Next imports; used by the
 * dashboard editor (to pre-set the "Open in a new tab" switch), by the article
 * renderer and by tests.
 *
 * ── New tab rule ─────────────────────────────────────────────────────────────
 *   external   http(s) to a host that is NOT one of the site's own → new tab
 *   internal   "/…" paths, the site's own hosts, internal references,
 *              mailto: / tel: / "#…"                               → same tab
 * The link's `blank` field is an OVERRIDE of that rule. The dashboard writes
 * it only when the person's choice differs from the rule (absent = automatic),
 * so a link follows the rule if the site's domains change later. Studio may
 * set it either way; an explicit boolean always wins.
 *
 * ── Internal links ───────────────────────────────────────────────────────────
 * `{ _type: 'link', _key, internal: { _type: 'reference', _ref, _weak? } }`
 * points at a page / post / news item / event of the SAME project. The website
 * query dereferences it as `internalTarget` (see `BODY_LINKS_PROJECTION` in
 * queries.ts) and `resolveBodyLinks` turns it into a URL in the page's
 * language; a missing, unpublished, untranslated or other-project target
 * renders as plain text.
 */
import { GENERATED_HOST_ROUTES } from '@/lib/tenancy/generated/route-config'
import { normalizeHref } from '@/lib/client/normalize-blocks'

/** Document types a body link may reference. Mirrors the Studio schema (`localizedPortableText` link). */
export const LINK_TARGET_TYPES = ['page', 'post', 'newsArticle', 'event'] as const
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number]

/** Route segments of the module detail pages (folders under `(website)/[tenant]/`). */
const ROUTE_PREFIX: Record<Exclude<LinkTargetType, 'page'>, string> = {
  post: 'blog',
  newsArticle: 'news',
  event: 'events',
}

/** Normalised host: lowercase, no port, no trailing dot, no leading `www.`. */
export function normalizeLinkHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '')
}

/** Every host a project's website answers on (its domains, platform aliases, preview hosts). */
export function siteHostsForProject(projectSlug: string | null | undefined): string[] {
  if (!projectSlug) return []
  return [...new Set(GENERATED_HOST_ROUTES.filter((r) => r.projectSlug === projectSlug).map((r) => normalizeLinkHost(r.host)))]
}

/** True for an http(s) link to a host that is not one of `siteHosts`. */
export function isExternalLink(href: string | null | undefined, siteHosts: readonly string[] = []): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false
  try {
    return !siteHosts.includes(normalizeLinkHost(new URL(href).hostname))
  } catch {
    return false
  }
}

export type LinkLike = { href?: unknown; internal?: unknown; blank?: unknown }

/** The rule alone (ignores `blank`). */
export function autoOpensInNewTab(link: LinkLike, siteHosts: readonly string[] = []): boolean {
  if (link.internal) return false
  return typeof link.href === 'string' && isExternalLink(link.href, siteHosts)
}

/** The rule, overridden by an explicit `blank`. */
export function opensInNewTab(link: LinkLike, siteHosts: readonly string[] = []): boolean {
  return typeof link.blank === 'boolean' ? link.blank : autoOpensInNewTab(link, siteHosts)
}

/** What the dashboard stores in `blank`: nothing when the choice equals the rule. */
export function blankToStore(choice: boolean, auto: boolean): boolean | undefined {
  return choice === auto ? undefined : choice
}

/** The dereferenced target the website query projects as `internalTarget`. */
export type InternalLinkTarget = {
  _type?: string
  /** Slug in the CURRENT language only — an untranslated target has none. */
  slug?: string | null
  pageType?: string | null
  projectSlug?: string | null
  /** Published and not expired (posts / news / events); pages are always live. */
  live?: boolean | null
}

/**
 * The site-relative path of an internal target ('' = the site's home), or
 * null when it cannot be linked (missing, unpublished, untranslated, unknown).
 */
export function internalTargetPath(target: InternalLinkTarget | null | undefined, projectSlug?: string | null): string | null {
  if (!target || target.live === false) return null
  if (projectSlug && target.projectSlug !== projectSlug) return null
  if (target._type === 'page') {
    if (target.pageType === 'home') return ''
    return target.slug ? target.slug.replace(/^\/+|\/+$/g, '') : null
  }
  const prefix = ROUTE_PREFIX[target._type as keyof typeof ROUTE_PREFIX]
  return prefix && target.slug ? `${prefix}/${target.slug}` : null
}

type RawDef = LinkLike & { _type?: unknown; _key?: unknown; internalTarget?: unknown }
type RawBlock = Record<string, unknown> & { _type?: unknown; markDefs?: unknown }

/**
 * Rewrites every link annotation of a website body into the plain shape the
 * renderers take — `{ _type: 'link', _key, href?, blank }` — with:
 *   - internal references resolved to `${siteBase}/${path}` (no href when the
 *     target can't be linked → the renderer shows plain text);
 *   - unsafe external hrefs removed (same gate as the dashboard);
 *   - `blank` = the new-tab rule with the stored override applied.
 * Everything else in the body is returned untouched.
 */
export function resolveBodyLinks<T>(
  body: T,
  opts: { siteBase: string; siteHosts?: readonly string[]; projectSlug?: string | null }
): T {
  if (!Array.isArray(body)) return body
  const hosts = opts.siteHosts ?? []
  return body.map((raw: RawBlock) => {
    if (!raw || raw._type !== 'block' || !Array.isArray(raw.markDefs)) return raw
    const markDefs = (raw.markDefs as RawDef[]).map((def) => {
      if (!def || def._type !== 'link') return def
      const blank = opensInNewTab(def, hosts)
      if (def.internal) {
        const path = internalTargetPath(def.internalTarget as InternalLinkTarget | undefined, opts.projectSlug)
        const href = path === null ? undefined : path ? `${opts.siteBase}/${path}` : opts.siteBase || '/'
        return { _type: 'link', _key: def._key, ...(href ? { href } : {}), blank }
      }
      const href = typeof def.href === 'string' && def.href.startsWith('#') ? def.href : normalizeHref(def.href)
      return { _type: 'link', _key: def._key, ...(href ? { href } : {}), blank }
    })
    return { ...raw, markDefs }
  }) as T
}
