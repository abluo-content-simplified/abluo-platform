/**
 * Public URL construction for canonical tags, hreflang alternates, og:url,
 * JSON-LD and the sitemap.
 *
 * ── The bug this exists to fix ───────────────────────────────────────────────
 * Ten metadata functions each built their canonical by hand as
 * `https://${customDomain}/${locale}/${tenantId}/…`. That interpolates the
 * INTERNAL rewrite target into the PUBLIC URL. On a custom domain `src/proxy.ts`
 * accepts both spellings — `/en` is rewritten to `/en/livener`, and `/en/livener`
 * matches `alreadyRewritten` and passes straight through — so the same content
 * answers on two URLs and the canonical pointed at the uglier of the two.
 * Verified live: `livener.net/en` declares `<link rel=canonical>` of
 * `https://livener.net/en/livener`, and that URL returns 200.
 *
 * The project segment is a ROUTING detail. It belongs in `href`s and internal
 * redirects, which are resolved against the app's own route tree; it does not
 * belong in the address we ask a search engine to index. `nologo.cloud/en/nologo`
 * also leaks the internal project slug into every indexed URL.
 *
 * So: one helper, no interpolation at the call sites, and the project segment
 * never appears in a public URL.
 *
 * ── What this does NOT change ────────────────────────────────────────────────
 * Internal `href`s and `permanentRedirect()` targets still carry the project
 * segment (see `withTenantPrefix` in `@/lib/sanity/href`). Those are app paths,
 * not public addresses, and the proxy round-trips them. A crawler following one
 * lands on `/en/livener`, reads the canonical it declares — `/en` — and
 * consolidates. Correct, if one hop longer than it needs to be; collapsing that
 * hop means changing every rendered link on two live client sites and is
 * deliberately a separate decision.
 */

import type { Metadata } from 'next'

/** A locale code as it appears in a URL path segment. */
type Locale = string

/**
 * `https://<customDomain>`, or null when the project has no custom domain yet.
 *
 * A project without a domain has no canonical address, and emitting a guess
 * (the request host, a platform alias) would point search engines at staging.
 * Null is the honest answer and every caller treats it as "emit nothing".
 */
export function canonicalOrigin(customDomain: string | null | undefined): string | null {
  if (!customDomain) return null
  const trimmed = customDomain.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  return `https://${trimmed}`
}

/**
 * The public URL for a page: `https://domain/<locale>[/<segment>…]`.
 *
 * Segments are the path BELOW the locale, exactly as they appear publicly —
 * `['blog', slug]`, `['news', slug]`, or nothing at all for the home page.
 * Empty and nullish segments are dropped so a caller need not branch.
 */
export function canonicalUrl(
  origin: string | null,
  locale: Locale,
  ...segments: (string | null | undefined)[]
): string | undefined {
  if (!origin) return undefined
  const path = segments
    .filter((s): s is string => Boolean(s && s.length > 0))
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
  return [origin, locale, ...path].join('/')
}

/**
 * hreflang alternates, including `x-default`.
 *
 * `perLocaleSegments` maps each supported locale to the path segments for THAT
 * locale — the slug differs per language, so the caller resolves it. A locale
 * whose entry is absent is omitted: an hreflang pointing at a page that does
 * not exist in that language is worse than no hreflang.
 *
 * `x-default` names the page a visitor gets when none of the declared languages
 * matches theirs. That is the project's own default locale, which is what the
 * proxy's root-path branch falls back to after the cookie and Accept-Language
 * both miss — so the tag describes the behaviour rather than asserting a
 * separate one. Google treats a missing x-default as "no fallback declared",
 * which for a seven-language site is a real omission.
 */
export function hreflangAlternates(
  origin: string | null,
  perLocaleSegments: Record<Locale, (string | null | undefined)[] | undefined>,
  defaultLocale: Locale
): Record<string, string> | undefined {
  if (!origin) return undefined

  const languages: Record<string, string> = {}
  for (const [locale, segments] of Object.entries(perLocaleSegments)) {
    if (!segments) continue
    const url = canonicalUrl(origin, locale, ...segments)
    if (url) languages[locale] = url
  }

  if (Object.keys(languages).length === 0) return undefined

  // Only claim a default we actually emitted a URL for.
  if (languages[defaultLocale]) languages['x-default'] = languages[defaultLocale]

  return languages
}

/**
 * The `alternates` block, assembled and environment-gated in one place.
 *
 * Canonical is production-only: a canonical on `dev.abluo.app` would point at
 * the client's live domain and invite a crawler to treat staging as a copy of
 * it. `isProduction` is passed in rather than imported so this module stays
 * pure and testable without stubbing the deployment helpers.
 */
export function seoAlternates(
  origin: string | null,
  canonical: string | undefined,
  languages: Record<string, string> | undefined,
  opts: { isProduction: boolean; isDev: boolean }
): NonNullable<Metadata['alternates']> {
  return {
    canonical: opts.isProduction ? canonical : undefined,
    languages: !opts.isDev && languages && Object.keys(languages).length > 0 ? languages : undefined,
  }
}
