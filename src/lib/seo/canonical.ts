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
 * ── Internal links follow the same rule (2026-10-02) ─────────────────────────
 * Internal `href`s and redirect targets used to keep the project segment, so a
 * crawler on a custom domain walked `/en/livener/…` and consolidated through
 * the canonical. QA on abluo.app counted 60 crawlable URLs where 27 were needed.
 * Links are now built with `siteBasePath()` (`@/lib/sanity/href`), which drops
 * the segment whenever the request is on the site's own host
 * (`@/lib/tenancy/link-scope`) and keeps it on the platform's path-based
 * preview/dev surfaces, where it is part of the public URL.
 */

import type { Metadata } from 'next'
import { normalizeHost } from '@/lib/tenancy/host-scope'

/** A locale code as it appears in a URL path segment. */
type Locale = string

/**
 * The host prefix every Abluo site serves its public pages on.
 *
 * ── The platform convention (Tom, settled 2026-10-13) ────────────────────────
 * Every client domain is wired the same way in Vercel: the apex 308-redirects
 * to the `www` host, and `www` is the one assigned to Production. That is true
 * of livener.net, nologo.cloud, studiomartegani.com, ch-psicoterapeuta.com,
 * ameliez.com and tmz.it without exception, and it is deliberate:
 *
 *   - DNS. A CNAME is not allowed at a zone apex, so a naked domain must be an
 *     A record pinned to an IP. `www` is a plain CNAME and follows Vercel if it
 *     ever moves. One fewer thing that breaks without anyone touching it.
 *   - Cookies. A cookie set on an apex is sent to every subdomain beneath it.
 *     On `www` it stays put.
 *
 * It is NOT an SEO preference — apex and www rank identically. Do not reopen
 * it, and do not propose flipping a project to apex-primary.
 *
 * ── Why this is a constant and not a stored field ────────────────────────────
 * Because the alternative was tried and drifted. `project.customDomain` held
 * the APEX on all nine projects, so every site declared a canonical pointing at
 * a URL that immediately 308s to the host actually serving it — a site telling
 * Google "the real address is X" where X is a redirect to Y. Storing the www
 * form per project instead would fix it, but it is nine records that a tenth
 * project can silently get wrong, which is how `customDomain`, `projectSlug`
 * and `status` each ended up null on tmz.
 *
 * The convention is platform-wide, so it lives in platform code. One constant,
 * every site correct, nothing to remember when provisioning the next one.
 * If a client ever genuinely needs apex-primary, add an explicit per-project
 * override THEN — not a second source of truth now, on spec.
 */
export const CANONICAL_HOST_PREFIX = 'www.'

/**
 * `https://www.<domain>`, or null when the project has no custom domain yet.
 *
 * The stored value is normalised first (`normalizeHost` strips a scheme, a
 * port, a trailing dot, case and any existing `www.`), so this is idempotent:
 * `tmz.it`, `www.tmz.it`, `https://TMZ.IT/` and `tmz.it.` all yield exactly
 * `https://www.tmz.it`. A project row cannot be stored in a shape that produces
 * the wrong canonical.
 *
 * A project without a domain has no canonical address, and emitting a guess
 * (the request host, a platform alias) would point search engines at staging.
 * Null is the honest answer and every caller treats it as "emit nothing".
 */
export function canonicalOrigin(customDomain: string | null | undefined): string | null {
  if (!customDomain) return null
  const host = normalizeHost(customDomain)
  if (!host) return null
  return `https://${CANONICAL_HOST_PREFIX}${host}`
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
