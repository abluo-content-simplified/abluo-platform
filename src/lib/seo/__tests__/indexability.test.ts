/**
 * Host-based indexability — Tests.
 *
 * The expensive failure here is asymmetric, and the tests are shaped around
 * that. A staging host that stays indexable is an SEO problem that can be
 * fixed next week. A PAYING CLIENT'S DOMAIN that gets `noindex` is lost revenue
 * and a lost ranking that takes months to recover. So the client-domain
 * assertions are not written by hand: they are driven off
 * `GENERATED_HOST_ROUTES` (the build-time copy of Supabase `projects`), so
 * every custom domain the platform serves — present and future — is covered by
 * construction, and there is no fourth hand-typed host table to keep in sync
 * (see `src/lib/tenancy/RENAME.md`).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  isStagingHost,
  isIndexableHost,
  buildRobotsForHost,
  STAGING_HOST_REGEX_SOURCE,
} from '../indexability'
import { GENERATED_HOST_ROUTES } from '@/lib/tenancy/generated/route-config'

// ─── The hosts under test ────────────────────────────────────────────────────

/** Every staging host the brief names, plus the wildcard shapes. */
const STAGING_HOSTS = [
  'dev.abluo.app',
  'preview.abluo.app',
  // *.preview.abluo.app — per-project preview subdomains
  'livener.preview.abluo.app',
  'studiomartegani.preview.abluo.app',
  'nologo.preview.abluo.app',
  'hoffmann.preview.abluo.app',
  'abluo.preview.abluo.app',
  't42.preview.abluo.app',
  'some-brand-new-project.preview.abluo.app',
  'deeply.nested.preview.abluo.app',
  // *.vercel.app — raw deployment URLs
  'abluo-platform.vercel.app',
  'abluo-platform-git-dev-abluo.vercel.app',
  'abluo-platform-9f3a2b1c-abluo.vercel.app',
  'vercel.app',
  // local development
  'localhost',
  'livener.localhost',
] as const

/**
 * Production hosts, taken from the generated table rather than typed here.
 * `hostKind: 'custom-domain'` IS the definition of "a client's live domain".
 */
const CLIENT_CUSTOM_DOMAINS = GENERATED_HOST_ROUTES.filter(
  (r) => r.hostKind === 'custom-domain'
).map((r) => r.host)

/** The `www.` twin of every client domain — same site, must behave the same. */
const CLIENT_WWW_DOMAINS = CLIENT_CUSTOM_DOMAINS.map((h) => `www.${h}`)

// ─── Sanity check on the fixtures themselves ─────────────────────────────────

describe('fixtures', () => {
  it('the generated table still contains every client domain the brief names', () => {
    // If a domain disappears from route-config, the loops below would silently
    // stop testing it. This is the tripwire for that.
    expect(CLIENT_CUSTOM_DOMAINS).toEqual(
      expect.arrayContaining([
        'abluo.app',
        'livener.net',
        'studiomartegani.com',
        'nologo.cloud',
        'ch-psicoterapeuta.com',
      ])
    )
  })
})

// ─── Staging hosts are blocked ───────────────────────────────────────────────

describe('staging hosts are non-indexable (by HEADER, not by robots.txt)', () => {
  it.each(STAGING_HOSTS)('%s is classified as staging', (host) => {
    expect(isStagingHost(host)).toBe(true)
    expect(isIndexableHost(host)).toBe(false)
  })

  it.each(STAGING_HOSTS)(
    '%s permits crawling so the noindex header can be seen',
    (host) => {
      // Deliberately permissive. `Disallow` and `noindex` FIGHT: `Disallow`
      // stops the crawler FETCHING, and the `X-Robots-Tag: noindex` from
      // Layer 1 is only discoverable BY fetching. Permitting the crawl is HOW
      // an already-indexed staging URL gets dropped. See the comment block on
      // the staging branch of `buildRobotsForHost`.
      const robots = buildRobotsForHost(host)
      expect(robots.rules.allow).toBe('/')
    }
  )

  it.each(STAGING_HOSTS)('%s advertises no sitemap', (host) => {
    // Permitting a crawl is not advertising the content. A permitted crawl
    // must find no sitemap to follow. (`src/app/sitemap.ts` independently
    // returns [] on a staging host, so both halves agree.)
    expect(buildRobotsForHost(host).sitemap).toBeUndefined()
  })

  it.each(STAGING_HOSTS)('%s keeps /studio/ and /dashboard/ blocked', (host) => {
    // No deindexing goal requires those admin surfaces to be fetched, so they
    // stay disallowed exactly as on production.
    expect(buildRobotsForHost(host).rules.disallow).toEqual(['/studio/', '/dashboard/'])
  })

  it('REGRESSION GUARD: staging never returns `disallow: /`', () => {
    // If this test starts failing because someone "fixed" robots.txt to block
    // staging outright, read the comment block on the staging branch of
    // `buildRobotsForHost` BEFORE changing this test. Blocking the fetch means
    // Googlebot never sees the noindex header, so anything already indexed
    // stays indexed indefinitely — a bare URL with no snippet, forever.
    //
    // EXIT CONDITION: once Search Console reports zero indexed URLs for
    // dev.abluo.app and preview.abluo.app, flipping to `disallow: '/'` is safe
    // and saves crawl budget. Until then it is actively harmful.
    for (const host of STAGING_HOSTS) {
      expect(buildRobotsForHost(host).rules.disallow, `${host}`).not.toBe('/')
    }
  })

  it('the URL that started this — dev.abluo.app — is crawlable but header-blocked', () => {
    // dev.abluo.app/en/livener is a byte-for-byte duplicate of livener.net.
    // It is classified staging (so Layer 1 sends X-Robots-Tag: noindex) while
    // robots.txt lets the crawler through to read that header.
    expect(isStagingHost('dev.abluo.app')).toBe(true)
    expect(buildRobotsForHost('dev.abluo.app').rules.allow).toBe('/')
    expect(buildRobotsForHost('dev.abluo.app').sitemap).toBeUndefined()
  })

  it('blocks staging hosts regardless of case, port or trailing dot', () => {
    for (const variant of [
      'DEV.ABLUO.APP',
      'dev.abluo.app:3000',
      'dev.abluo.app.',
      'Livener.Preview.Abluo.App',
      'livener.preview.abluo.app:443',
    ]) {
      expect(isStagingHost(variant)).toBe(true)
    }
  })

  it('classifies every non-custom-domain row in the generated table as staging', () => {
    // preview-subdomain, localhost-subdomain and platform-alias (dev.abluo.app)
    // are all Abluo-owned staging infrastructure.
    const nonProduction = GENERATED_HOST_ROUTES.filter((r) => r.hostKind !== 'custom-domain')
    expect(nonProduction.length).toBeGreaterThan(0)
    for (const route of nonProduction) {
      expect(
        isStagingHost(route.host),
        `${route.host} (${route.hostKind}) must be non-indexable`
      ).toBe(true)
    }
  })
})

// ─── Client domains are NEVER blocked ────────────────────────────────────────

describe('client custom domains stay indexable (the expensive regression)', () => {
  it('there is at least one client domain to test', () => {
    expect(CLIENT_CUSTOM_DOMAINS.length).toBeGreaterThanOrEqual(5)
  })

  it.each(CLIENT_CUSTOM_DOMAINS)('%s is NEVER classified as staging', (host) => {
    expect(isStagingHost(host)).toBe(false)
  })

  it.each(CLIENT_WWW_DOMAINS)('%s is NEVER classified as staging', (host) => {
    expect(isStagingHost(host)).toBe(false)
  })

  it.each([...CLIENT_CUSTOM_DOMAINS, ...CLIENT_WWW_DOMAINS])(
    '%s keeps exactly the pre-existing robots rules',
    (host) => {
      const robots = buildRobotsForHost(host)
      // Byte-for-byte the behaviour of the old unconditional robots.ts.
      expect(robots.rules).toEqual({
        userAgent: '*',
        allow: '/',
        disallow: ['/studio/', '/dashboard/'],
      })
    }
  )

  it.each(CLIENT_CUSTOM_DOMAINS)(
    '%s still advertises its sitemap (staging does not — this is what separates them)',
    (host) => {
      // Since the staging branch became permissive, `rules` is identical on
      // both. The sitemap line is now the only difference in robots.txt, and
      // the real separation is the X-Robots-Tag header from Layer 1 — asserted
      // in the next.config.ts describe below.
      expect(buildRobotsForHost(host).sitemap).toBe(`https://${host}/sitemap.xml`)
    }
  )

  it('ch-psicoterapeuta.com (Hoffmann, not yet routed) is not pre-emptively blocked', () => {
    expect(isStagingHost('ch-psicoterapeuta.com')).toBe(false)
    expect(buildRobotsForHost('ch-psicoterapeuta.com').rules.allow).toBe('/')
  })

  it('a FUTURE custom_domain not yet in the generated table stays indexable', () => {
    // route-config.ts is a build-time copy of Supabase. A domain added to the
    // database and deployed before `scripts/generate-route-config.mjs` re-runs
    // is an UNKNOWN host. Indexability must fail OPEN for it — this is the
    // single assertion standing between a slow onboarding and a client's site
    // being deleted from Google.
    for (const host of [
      'brand-new-client.com',
      'www.brand-new-client.com',
      'studio.example.co.uk',
      'a-client.app',
    ]) {
      expect(isStagingHost(host)).toBe(false)
      expect(buildRobotsForHost(host).rules.allow).toBe('/')
    }
  })

  it('does not blanket-block the abluo.app apex just because dev.abluo.app is blocked', () => {
    expect(isStagingHost('abluo.app')).toBe(false)
    expect(isStagingHost('www.abluo.app')).toBe(false)
    expect(isStagingHost('dev.abluo.app')).toBe(true)
  })

  it('does not block a client domain that merely CONTAINS a staging suffix', () => {
    // `.vercel.app` and `.preview.abluo.app` must only match as SUFFIXES of the
    // whole host — the regex is anchored, so these are production hosts.
    for (const host of ['vercel.app.example.com', 'preview.abluo.app.evil.com', 'notvercel.app.io']) {
      expect(isStagingHost(host)).toBe(false)
    }
  })
})

// ─── Sitemap URL is per-host ─────────────────────────────────────────────────

describe('sitemap URL follows the request host', () => {
  it('advertises the requesting host, not NEXT_PUBLIC_BASE_URL', () => {
    expect(buildRobotsForHost('livener.net').sitemap).toBe('https://livener.net/sitemap.xml')
    expect(buildRobotsForHost('studiomartegani.com').sitemap).toBe(
      'https://studiomartegani.com/sitemap.xml'
    )
  })

  it('keeps the www. prefix so the sitemap is same-host', () => {
    // A sitemap must be served from the host whose URLs it lists; rewriting
    // www.livener.net to livener.net here would make it a cross-host reference.
    expect(buildRobotsForHost('www.livener.net').sitemap).toBe(
      'https://www.livener.net/sitemap.xml'
    )
  })

  it('normalises case and strips the port', () => {
    expect(buildRobotsForHost('Livener.NET:443').sitemap).toBe('https://livener.net/sitemap.xml')
  })

  it('falls back to the env base URL when there is no Host header', () => {
    const robots = buildRobotsForHost(null)
    expect(robots.rules.allow).toBe('/')
    expect(robots.sitemap).toBe(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/sitemap.xml`
    )
  })
})

// ─── Layer 1 / Layer 2 drift guard ───────────────────────────────────────────

describe('next.config.ts X-Robots-Tag header block', () => {
  const configSource = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf-8')

  it('uses the same staging-host regex as robots.txt', () => {
    // next.config.ts cannot import from src/, so the regex is duplicated there
    // as a string literal. In the file it is escaped for a TS string literal
    // (`\\.`), which evaluates to the `\.` in STAGING_HOST_REGEX_SOURCE.
    const match = configSource.match(/type: 'host',\s*\n\s*value: '([^']+)'/)
    expect(match, 'no `has: [{ type: host, value }]` found in next.config.ts').not.toBeNull()
    const literal = match![1].replace(/\\\\/g, '\\')
    expect(literal).toBe(STAGING_HOST_REGEX_SOURCE)
  })

  it('sets X-Robots-Tag: noindex, nofollow on all paths', () => {
    expect(configSource).toContain("key: 'X-Robots-Tag', value: 'noindex, nofollow'")
  })

  it('the regex Next compiles matches every staging host and no client host', () => {
    // Next wraps a host `has` value in ^…$ and tests it against the lowercased,
    // port-stripped Host header. Reproduce that exactly.
    const match = configSource.match(/type: 'host',\s*\n\s*value: '([^']+)'/)
    const compiled = new RegExp(`^${match![1].replace(/\\\\/g, '\\')}$`)
    const asNextSeesIt = (h: string) => h.split(':')[0].toLowerCase()

    for (const host of STAGING_HOSTS) {
      expect(compiled.test(asNextSeesIt(host)), `${host} must get X-Robots-Tag`).toBe(true)
    }
    for (const host of [...CLIENT_CUSTOM_DOMAINS, ...CLIENT_WWW_DOMAINS]) {
      expect(compiled.test(asNextSeesIt(host)), `${host} must NOT get X-Robots-Tag`).toBe(false)
    }
  })
})
