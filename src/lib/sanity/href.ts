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
 * Prefix a bare internal path with `/{locale}/{tenant}/`.
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
  tenantId: string | null | undefined
): string {
  if (!href) return href ?? ''
  if (isPassThroughHref(href) || !locale || !tenantId) return href
  const slug = href.startsWith('/') ? href.slice(1) : href
  return `/${locale}/${tenantId}/${slug}`
}
