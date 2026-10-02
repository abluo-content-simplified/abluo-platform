/**
 * Shared href resolution rules for the Abluo platform.
 *
 * One question is answered in exactly one place here: "is this href a bare
 * internal path that still needs the /{locale}/{tenant}/ prefix, or is it
 * something the browser must receive verbatim?"
 *
 * Every CTA prefixer (section components + resolveCta) and the navigation
 * link resolver call into these helpers, so a fragment link, a mailto:, a
 * tel: or a protocol-relative CDN URL can never be mangled into an internal
 * route again.
 *
 * This file is intentionally free of React or Next.js imports.
 */

/**
 * Matches an absolute URL scheme at the start of a string:
 * `mailto:`, `tel:`, `sms:`, `http:`, `https:`, `ftp:`, `data:` …
 *
 * Per RFC 3986 a scheme is ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":".
 * A bare internal path can never match: slugs contain no ':'.
 */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * True when `href` must be passed through to the DOM exactly as authored and
 * must NEVER receive a locale/tenant prefix.
 *
 * Pass-through cases:
 *   - null / undefined / empty string (nothing to prefix)
 *   - a bare fragment: `#faq`
 *   - any URL carrying a scheme: `mailto:`, `tel:`, `sms:`, `http:`, `https:` …
 *   - a protocol-relative URL: `//cdn.example.com/x.pdf`
 *
 * NOT pass-through (these are internal paths and still get prefixed):
 *   - `/about`, `about`, `/pricing#tiers`
 */
export function isPassThroughHref(href: string | null | undefined): boolean {
  if (!href) return true
  // Protocol-relative — checked before the single-slash internal path case.
  if (href.startsWith('//')) return true
  if (href.startsWith('#')) return true
  return SCHEME_RE.test(href)
}

/**
 * The path every internal link on a site starts with.
 *
 *   - `/{locale}/{tenant}` — the platform's path-based surfaces
 *     (`preview.abluo.app/<project>`, `dev.abluo.app/<project>`), where the
 *     project segment is how the proxy knows which site is meant;
 *   - `/{locale}` — a site served on its OWN host (its custom domain), where
 *     the host already names the project. Emitting the project segment there
 *     produced a second URL for every page (`abluo.app/en/abluo/news` next to
 *     the canonical `abluo.app/en/news`), both answering 200.
 *
 * `hostScoped` comes from `isHostScopedSegment()` (`@/lib/tenancy/link-scope`):
 * server code asks `isHostScopedRequest()`, client code `useHostScoped()`.
 */
export function siteBasePath(locale: string, tenantId: string, hostScoped = false): string {
  return hostScoped ? `/${locale}` : `/${locale}/${tenantId}`
}

/**
 * Prefix a bare internal path with the site base (see siteBasePath):
 * `/{locale}/{tenant}/` on path-based surfaces, `/{locale}/` on the site's
 * own host.
 *
 * Returns `href` untouched when it is pass-through (see isPassThroughHref) or
 * when either URL param is missing — the caller has nothing to build with.
 *
 * A fragment carried by an internal path is preserved because the whole string
 * is prefixed as-is: `/pricing#tiers` → `/en/livener/pricing#tiers`.
 */
export function withTenantPrefix(
  href: string | null | undefined,
  locale: string | null | undefined,
  tenantId: string | null | undefined,
  hostScoped = false
): string {
  if (!href) return href ?? ''
  if (isPassThroughHref(href) || !locale || !tenantId) return href
  const slug = href.startsWith('/') ? href.slice(1) : href
  return `${siteBasePath(locale, tenantId, hostScoped)}/${slug}`
}

/**
 * Rewrite an already-built internal path to its public form.
 *
 * For builders that produce `/{locale}/{tenant}/…` on their own (navigation
 * links, legacy hrefs): on the site's own host the project segment is dropped,
 * `/en/abluo/news?x#y` → `/en/news?x#y`; everywhere else, and for any href that
 * does not carry exactly this tenant as its second segment, it is returned
 * unchanged.
 */
export function toPublicPath(href: string, tenantId: string, hostScoped: boolean): string {
  if (!hostScoped || !href || isPassThroughHref(href) || !href.startsWith('/')) return href
  const match = /^\/([^/?#]+)\/([^/?#]+)(.*)$/.exec(href)
  if (!match || match[2] !== tenantId) return href
  const rest = match[3]
  if (rest !== '' && !/^[/?#]/.test(rest)) return href
  return `/${match[1]}${rest === '/' ? '' : rest}`
}
