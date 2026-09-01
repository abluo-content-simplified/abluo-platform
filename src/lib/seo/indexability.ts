/**
 * Search-engine indexability, decided from the request HOST.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 * Vercel Deployment Protection is a paid feature this account does not have, so
 * `dev.abluo.app` and `preview.abluo.app` are PUBLICLY reachable and serve a
 * complete copy of every client website. `dev.abluo.app/en/livener` is a full
 * duplicate of `livener.net` and was crawlable, competing with a paying
 * client's own domain in search results. This module is the host classifier
 * both anti-indexing layers are driven from:
 *
 *   Layer 1 (authoritative) — `X-Robots-Tag: noindex, nofollow`, emitted by the
 *     declarative `headers()` block in `next.config.ts` on every response from a
 *     staging host (pages, API routes, images, static files alike). A header is
 *     what actually removes a URL from an index; robots.txt only asks a crawler
 *     not to FETCH, and a URL linked from anywhere can still be indexed unfetched.
 *     `next.config.ts` cannot import this module (it is loaded by Next's own
 *     config loader before the app graph exists), so the regex is duplicated
 *     there as a literal and `__tests__/indexability.test.ts` fails if the two
 *     copies ever drift apart.
 *
 *   Layer 2 — `src/app/robots.ts`, via `buildRobotsForHost()` below.
 *
 * ── Why a PATTERN, and not `hostKind` from `./tenancy/host-scope` ────────────
 * `GENERATED_HOST_ROUTES` already classifies every KNOWN host, and this module
 * deliberately does not key off it. The two are wired the other way round: the
 * tests below iterate the generated table and assert that every
 * `custom-domain` row is indexable and every `preview-subdomain` /
 * `localhost-subdomain` / `platform-alias` row is not, so the table stays the
 * cross-check and no client host is hand-typed anywhere in this file.
 *
 * The reason it cannot be the *mechanism* is the failure mode when a host is
 * NOT in the table. `host-scope.ts` is fail-CLOSED by house rule (divergence
 * (C)): an unknown host resolves to null. Fail-closed is right for ROUTING —
 * guessing a project at the edge is how one tenant renders another's content.
 * It is exactly wrong for indexing: `route-config.ts` is a build-time copy of
 * Supabase, so a `custom_domain` added to the database and deployed before
 * `scripts/generate-route-config.mjs` is re-run is an unknown host — and a
 * fail-closed indexability rule would answer "noindex" and silently delete a
 * paying client's site from Google. Losing a client's SEO is the worst
 * outcome available here; a staging host briefly indexed is recoverable.
 *
 * So indexability fails OPEN, and the closed set is the one that is safe to
 * enumerate: the staging hosts are Abluo-owned infrastructure, are all under
 * three fixed suffixes, and change only when the platform's own DNS changes —
 * never when a client is onboarded. An unknown host is treated as a production
 * client host and stays indexable.
 */

import { normalizeHost } from '@/lib/tenancy/host-scope'

/**
 * Regex SOURCE (no anchors) for every host that must never be indexed.
 *
 * Anchored `^…$` by both consumers: `new RegExp()` below, and Next's `has`
 * matcher, which wraps a `{ type: 'host' }` value in `^…$` and tests it against
 * the lowercased, port-stripped `Host` header
 * (`next/dist/shared/lib/router/utils/prepare-destination.js`, `matchHas`).
 *
 * MUST stay byte-identical to the `has[0].value` literal in `next.config.ts`.
 * A test asserts this by reading that file.
 *
 *   dev.abluo.app          — the dev alias, a full copy of every client site
 *   preview.abluo.app      — the preview alias, ditto
 *   *.preview.abluo.app    — per-project preview subdomains (livener.preview…)
 *   *.vercel.app           — raw deployment URLs, which are never protected
 *   localhost / *.localhost — local development
 */
export const STAGING_HOST_REGEX_SOURCE =
  '(?:dev\\.abluo\\.app|(?:.+\\.)?preview\\.abluo\\.app|(?:.+\\.)?vercel\\.app|(?:.+\\.)?localhost)'

const STAGING_HOST_REGEX = new RegExp(`^${STAGING_HOST_REGEX_SOURCE}$`)

/**
 * True when this host is Abluo staging infrastructure and must be kept out of
 * every search index.
 *
 * Fails OPEN: an empty, missing or unrecognised host is NOT staging. See the
 * module header — a future client `custom_domain` is an unrecognised host, and
 * it must keep its search ranking.
 */
export function isStagingHost(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host)
  if (!normalized) return false
  return STAGING_HOST_REGEX.test(normalized)
}

/** Inverse of `isStagingHost`, spelled out because call sites read better. */
export function isIndexableHost(host: string | null | undefined): boolean {
  return !isStagingHost(host)
}

/**
 * The canonical origin to advertise a sitemap under, for THIS request's host.
 *
 * Uses the host as asked for, `www.` included — a sitemap must be served from
 * the host whose URLs it lists, and `normalizeHost()` strips `www.`, which
 * would make `www.livener.net` advertise a cross-host sitemap. Falls back to
 * `NEXT_PUBLIC_BASE_URL` only when there is no `Host` header at all.
 */
function siteOriginForHost(host: string | null | undefined): string {
  if (typeof host === 'string') {
    let h = host.trim().toLowerCase()
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    h = h.split('/')[0]
    if (h.startsWith('[')) {
      const close = h.indexOf(']')
      if (close !== -1) h = h.slice(0, close + 1)
    } else {
      h = h.split(':')[0]
    }
    h = h.replace(/\.$/, '')
    if (h) return `https://${h}`
  }
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
}

/** Paths that stay disallowed on production hosts (unchanged from before). */
export const PRODUCTION_DISALLOW: readonly string[] = ['/studio/', '/dashboard/']

/**
 * The robots.txt body for a given request host.
 *
 * Pure and synchronous so it can be tested without mocking `next/headers`;
 * `src/app/robots.ts` is a two-line wrapper that reads the header and calls it.
 */
export function buildRobotsForHost(host: string | null | undefined): {
  rules: { userAgent: string; allow?: string; disallow: string | string[] }
  sitemap?: string
} {
  if (isStagingHost(host)) {
    // ── COUNTERINTUITIVE AND DELIBERATE — DO NOT "FIX" THIS TO `disallow: '/'` ──
    //
    // A staging host returns the PERMISSIVE rules, the same as production. That
    // looks like the opposite of the goal. It is not.
    //
    // `Disallow` and `noindex` are not additive — they FIGHT each other.
    // `Disallow` stops a crawler FETCHING a URL. The `X-Robots-Tag: noindex`
    // from Layer 1 (`next.config.ts`) is only discoverable BY fetching it.
    // Block the fetch and Googlebot never learns the page is noindex, so
    // anything already in the index STAYS in the index indefinitely — typically
    // shown as a bare URL with no snippet. Permitting the crawl is precisely
    // HOW an already-indexed page gets removed.
    //
    // `allow` is strictly better than `disallow` in both possible states, and
    // we do not know which state we are in:
    //   - not yet indexed → crawler fetches, sees noindex, never indexes it
    //   - already indexed → crawler fetches, sees noindex, DROPS it
    // `disallow` only helps in the first case and cements the second. So we
    // pick the rule that is correct either way.
    //
    // Layer 1 remains the authoritative control. This file is not what keeps
    // staging out of the index; the header is. This file's only job here is to
    // not get in the header's way.
    //
    // EXIT CONDITION. Once Google Search Console reports ZERO indexed URLs for
    // dev.abluo.app and preview.abluo.app, flipping this branch to
    // `disallow: '/'` becomes safe and saves crawl budget. Until then it is
    // actively harmful. Do not flip it on the basis that it "reads wrong".
    //
    // Two things do still differ from production:
    //   1. NO `sitemap` line. We are permitting a crawl so the noindex header
    //      is seen — not advertising the content. A permitted crawl must find
    //      no sitemap to follow. (`src/app/sitemap.ts` independently returns an
    //      empty sitemap on a staging host, so both halves agree.)
    //   2. Nothing else. `/studio/` and `/dashboard/` stay disallowed exactly as
    //      on production: no deindexing goal requires those admin surfaces to
    //      be fetched.
    return {
      rules: {
        userAgent: '*',
        allow: '/',
        disallow: [...PRODUCTION_DISALLOW],
      },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...PRODUCTION_DISALLOW],
    },
    sitemap: `${siteOriginForHost(host)}/sitemap.xml`,
  }
}
