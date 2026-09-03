/**
 * `proxy()` end to end, over the generated route table (RENAME.md Step 6).
 *
 * ── Why this exists on top of the resolver's own tests ───────────────────────
 * `src/lib/tenancy/__tests__/step6-routing-flip.test.ts` proves the resolver
 * answers correctly. This file proves the MIDDLEWARE does the right thing with
 * those answers: the exact rewrite URL a browser would get, for every live
 * host, plus the hosts that must get NO tenant rewrite at all. Those two can
 * disagree — a correct resolver wired into the wrong branch still serves the
 * wrong site — and the rewrite URL is what actually reaches a customer.
 *
 * `next-intl/middleware` is mocked to a sentinel response. It is a third-party
 * i18n middleware, not the subject: what matters here is WHICH branch proxy()
 * takes, and "fell through to intl" is a distinct, assertable outcome
 * (`x-intl-fallthrough`) from "rewrote to a tenant route".
 *
 * Everything else in proxy() is real. No Supabase call is reachable from any
 * request below: the auth gates only fire on `admin.abluo.app` and on
 * admin/client surfaces, none of which are exercised here.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { headers: { 'x-intl-fallthrough': '1' } }),
}))

// The admin/client gates build a real Supabase client. None of the host-routing
// cases below reach them; the bypass regression suite at the bottom of this file
// does, deliberately — reaching the gate is the thing it asserts. Mock an
// ANONYMOUS session so the gate's own behaviour (redirect to /login) is the
// observable outcome, with no network and no credentials.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}))

import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

/** The URL proxy() rewrote to, or null when it did not rewrite. */
async function rewriteFor(
  host: string,
  path = '/',
  init: { headers?: Record<string, string>; cookie?: string } = {}
): Promise<string | null> {
  const headers: Record<string, string> = { host, ...(init.headers ?? {}) }
  if (init.cookie) headers.cookie = init.cookie
  // The URL's own host is irrelevant — proxy() reads the Host header, exactly
  // as it does behind Vercel's proxy.
  const req = new NextRequest(new URL(`https://placeholder.invalid${path}`), { headers })
  const res = await proxy(req)
  const rewrite = res.headers.get('x-middleware-rewrite')
  return rewrite ? new URL(rewrite).pathname : null
}

/** True when proxy() handed the request to the i18n middleware (no tenant). */
async function fellThroughToIntl(host: string, path = '/'): Promise<boolean> {
  const req = new NextRequest(new URL(`https://placeholder.invalid${path}`), { headers: { host } })
  const res = await proxy(req)
  return res.headers.get('x-intl-fallthrough') === '1'
}

// ─── Live custom domains ─────────────────────────────────────────────────────

describe('every live customer host rewrites to its own project route', () => {
  it.each([
    ['livener.net',           '/en/livener'],
    ['studiomartegani.com',   '/it/studiomartegani'],
    ['nologo.cloud',          '/en/nologo'],
    ['abluo.app',             '/en/abluo'],
    // Hoffmann — the host RENAME.md flagged as a live behaviour change.
    ['ch-psicoterapeuta.com', '/it/hoffmann'],
  ])('%s / → %s', async (host, expected) => {
    expect(await rewriteFor(host)).toBe(expected)
  })

  it.each([
    ['livener.net',           '/about', '/en/livener/about'],
    ['studiomartegani.com',   '/blog/a-post', '/it/studiomartegani/blog/a-post'],
    ['ch-psicoterapeuta.com', '/contatti', '/it/hoffmann/contatti'],
  ])('%s %s → %s', async (host, path, expected) => {
    expect(await rewriteFor(host, path)).toBe(expected)
  })

  it('serves the it-first sites in Italian, not the platform default', async () => {
    // If the flip had lost the per-project locale, both of these would be /en/.
    expect(await rewriteFor('studiomartegani.com')).toBe('/it/studiomartegani')
    expect(await rewriteFor('ch-psicoterapeuta.com')).toBe('/it/hoffmann')
  })
})

describe('host header spellings that reach the same site', () => {
  it.each([
    'livener.net',
    'www.livener.net',
    'LIVENER.NET',
    'livener.net.',
    'livener.net:443',
    'Www.Livener.Net:8080',
  ])('%s → /en/livener', async (host) => {
    expect(await rewriteFor(host)).toBe('/en/livener')
  })

  it('BEHAVIOUR CHANGE: a case-varied custom domain used to miss the map', async () => {
    // `domainMap` was keyed by exact lowercase strings and proxy.ts only
    // stripped the port and a leading `www.`, so `Livener.NET` fell through to
    // the platform routes. It now normalises before the lookup.
    expect(await rewriteFor('Ch-Psicoterapeuta.com')).toBe('/it/hoffmann')
  })
})

// ─── The Amélie fix ──────────────────────────────────────────────────────────

describe('amelie: a project with no custom domain, on its preview host', () => {
  it('rewrites to /en/amelie — it used to 404 at the route boundary', async () => {
    expect(await rewriteFor('amelie.preview.abluo.app')).toBe('/en/amelie')
  })

  it('carries sub-paths through', async () => {
    expect(await rewriteFor('amelie.preview.abluo.app', '/galerie')).toBe('/en/amelie/galerie')
  })
})

// ─── Preview and dev subdomains for every active project ─────────────────────

describe('per-project preview and dev hosts', () => {
  it.each([
    ['livener.preview.abluo.app',         '/en/livener'],
    ['studiomartegani.preview.abluo.app', '/it/studiomartegani'],
    ['hoffmann.preview.abluo.app',        '/it/hoffmann'],
    ['nologo.preview.abluo.app',          '/en/nologo'],
    ['amelie.preview.abluo.app',          '/en/amelie'],
    ['livener.localhost:3000',            '/en/livener'],
    ['studiomartegani.localhost:3000',    '/it/studiomartegani'],
  ])('%s / → %s', async (host, expected) => {
    expect(await rewriteFor(host)).toBe(expected)
  })
})

// ─── Hosts that must NOT get a tenant route ──────────────────────────────────

describe('unknown and platform hosts get no tenant rewrite', () => {
  it.each([
    'example.com',
    'not-a-customer.com',
    'nologo.cloud.evil.com',
    'abluo-platform.vercel.app',
  ])('%s falls through to the i18n middleware', async (host) => {
    expect(await rewriteFor(host)).toBeNull()
    expect(await fellThroughToIntl(host)).toBe(true)
  })

  it('BEHAVIOUR CHANGE: an unknown subdomain is no longer guessed into a route', async () => {
    // Before: `evil.localhost` rewrote to `/en/evil`, and
    // `not-a-project.preview.abluo.app` to `/null/not-a-project`. Both 404'd
    // downstream, but only after the edge had asserted a project identity it
    // had invented. Now neither is claimed at all.
    expect(await rewriteFor('evil.localhost:3000')).toBeNull()
    expect(await rewriteFor('not-a-project.preview.abluo.app')).toBeNull()
  })

  it('BEHAVIOUR CHANGE: an INACTIVE project does not route', async () => {
    expect(await rewriteFor('t42.preview.abluo.app')).toBeNull()
    expect(await rewriteFor('t42.localhost:3000')).toBeNull()
  })

  it('bare localhost is the platform, not a project', async () => {
    expect(await rewriteFor('localhost:3000')).toBeNull()
  })
})

// ─── Path-based platform surfaces ────────────────────────────────────────────

describe('preview.abluo.app/<slug> — path-based project routing', () => {
  it.each([
    ['/studiomartegani',            '/it/studiomartegani'],
    ['/studiomartegani/blog',       '/it/studiomartegani/blog'],
    ['/livener',                    '/en/livener'],
    ['/hoffmann',                   '/it/hoffmann'],
    ['/amelie',                     '/en/amelie'],
  ])('%s → %s', async (path, expected) => {
    expect(await rewriteFor('preview.abluo.app', path)).toBe(expected)
  })

  it('BUG FIX: an unknown first segment no longer rewrites to /null/<segment>', async () => {
    // `resolveDefaultLocale()` returned null and the old code interpolated it
    // straight into the path. Both spellings 404, but only one of them is
    // readable in a log.
    expect(await rewriteFor('preview.abluo.app', '/not-a-project')).toBeNull()
    expect(await fellThroughToIntl('preview.abluo.app', '/not-a-project')).toBe(true)
  })

  it('does not claim an inactive project', async () => {
    expect(await rewriteFor('preview.abluo.app', '/t42')).toBeNull()
  })
})

describe('dev.abluo.app — path-based routing plus the platform apex alias', () => {
  it.each([
    ['/livener',          '/en/livener'],
    ['/studiomartegani',  '/it/studiomartegani'],
    ['/amelie',           '/en/amelie'],
  ])('%s → %s', async (path, expected) => {
    expect(await rewriteFor('dev.abluo.app', path)).toBe(expected)
  })

  it('root falls through to the platform project (abluo)', async () => {
    expect(await rewriteFor('dev.abluo.app', '/')).toBe('/en/abluo')
  })

  it('an already-localed project path passes straight through (language switch)', async () => {
    expect(await rewriteFor('dev.abluo.app', '/de/livener')).toBeNull()
  })

  it('a locale-only path gets the platform project injected', async () => {
    expect(await rewriteFor('dev.abluo.app', '/de')).toBe('/de/abluo')
  })
})

// ─── Locale policy is unchanged by the flip ──────────────────────────────────

describe('root-path locale negotiation still overrides the project default', () => {
  it('honours a NEXT_LOCALE cookie', async () => {
    expect(await rewriteFor('studiomartegani.com', '/', { cookie: 'NEXT_LOCALE=en' })).toBe(
      '/en/studiomartegani'
    )
  })

  it('falls back to Accept-Language when there is no cookie', async () => {
    expect(
      await rewriteFor('studiomartegani.com', '/', {
        headers: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' },
      })
    ).toBe('/de/studiomartegani')
  })

  it('uses the project default when neither is present', async () => {
    expect(await rewriteFor('studiomartegani.com')).toBe('/it/studiomartegani')
  })

  it('negotiation applies to the ROOT path only — deeper paths use the default', async () => {
    expect(
      await rewriteFor('studiomartegani.com', '/chi-siamo', {
        headers: { 'accept-language': 'en-GB,en;q=0.9' },
      })
    ).toBe('/it/studiomartegani/chi-siamo')
  })

  it('a locale-prefixed path on a custom domain keeps its locale', async () => {
    expect(await rewriteFor('livener.net', '/de/about')).toBe('/de/livener/about')
  })

  it('an already-rewritten path is passed through untouched', async () => {
    expect(await rewriteFor('livener.net', '/en/livener/about')).toBeNull()
  })
})

/**
 * REGRESSION — the platform-host branches must not swallow gated surfaces.
 *
 * `if (host === 'preview.abluo.app')` sits ABOVE the admin-surface gate, so
 * anything it returns skips that gate. Before Step 6, `/dashboard` on that host
 * resolved a null locale and rewrote to `/null/dashboard`, which
 * `[locale]/layout.tsx` 404s because `null` is not in `routing.locales` — the
 * surface stayed closed by accident, not by design.
 *
 * Step 6 replaced the null with an honest `defaultLocaleForProjectSegment()`
 * lookup and an early `return intlMiddleware(request)`. That turned the
 * accidental 404 into a 307 to `/en/dashboard` — and NOTHING under
 * `src/app/[locale]/(admin)/` performs its own auth: `dashboard/page.tsx`
 * builds a service-role client and selects every project and tenant on the
 * platform. The middleware is the only gate, and the branch was returning
 * before it.
 *
 * These assert the branch declines to handle gated paths, so they reach the
 * real gate below. They must never be "fixed" by adding auth expectations
 * here — the point is that proxy() does NOT answer these itself.
 */
describe('preview.abluo.app does not bypass the admin gate', () => {
  // Both spellings. The LOCALE-PREFIXED form is the one that leaked in
  // production: `/dashboard` took the `slug && !isLocale` path, but `/en/...`
  // set isLocale=true, skipped that block entirely, and fell out of the branch
  // to `return intlMiddleware(request)` — above the gate. Verified live on
  // 2026-09-02: preview.abluo.app/en/dashboard returned 200 unauthenticated
  // with every project name and UUID in the flight payload.
  const GATED = [
    '/dashboard', '/clients', '/content', '/media', '/projects', '/settings',
    '/en/dashboard', '/en/clients', '/en/content', '/en/media', '/en/projects', '/en/settings',
    '/it/dashboard', '/de/clients',
  ]

  for (const path of GATED) {
    it(`does not rewrite ${path} into a tenant route`, async () => {
      expect(await rewriteFor('preview.abluo.app', path)).toBeNull()
    })

    it(`does not hand ${path} to the i18n middleware`, async () => {
      // Falling through to intl is what produced the 307 onto the ungated
      // admin page. The gate must see this request instead.
      expect(await fellThroughToIntl('preview.abluo.app', path)).toBe(false)
    })

    it(`sends an anonymous visitor of ${path} to /login`, async () => {
      // The positive half: not merely "declined by this branch", but actually
      // ARRIVED at the gate and was turned away. Without the fix this is a 307
      // to /en${path} — a signpost onto a service-role page with no auth.
      const res = await proxy(
        new NextRequest(new URL(`https://placeholder.invalid${path}`), {
          headers: { host: 'preview.abluo.app' },
        })
      )
      expect(res.status).toBe(307)
      const location = new URL(res.headers.get('location') ?? '')
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('next')).toBe(path)
    })
  }

  it('still routes a real project segment on the same host', async () => {
    expect(await rewriteFor('preview.abluo.app', '/studiomartegani')).toBe('/it/studiomartegani')
  })

  it('still declines an unknown segment on the same host', async () => {
    expect(await rewriteFor('preview.abluo.app', '/not-a-project')).toBeNull()
  })
})
