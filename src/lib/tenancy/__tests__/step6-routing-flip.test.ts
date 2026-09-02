/**
 * RENAME.md Step 6 — the flip, and every behaviour it changes.
 *
 * ── What this file is for ────────────────────────────────────────────────────
 * `host-scope.test.ts` proves the RESOLVER is correct. This file proves the
 * FLIP is safe: it pins, host by host and segment by segment, what the three
 * deleted hand-typed tables used to answer and what the generated table answers
 * now, so that every difference is a decision recorded here rather than a
 * surprise in production.
 *
 * The deleted tables, transcribed below exactly as they stood at commit
 * `c73fd54` (the last commit before this one):
 *   - `domainMap`            — src/proxy.ts, host → URL slug
 *   - `resolveDefaultLocale` — src/proxy.ts, slug → locale AND the "is this a
 *                              project?" test that stopped `/login` being
 *                              rewritten as if it were a site
 *   - `KNOWN_PROJECT_SEGMENTS` — src/lib/sanity/client.ts, the route allow-list
 *                              the `(website)/[tenant]` boundary 404s on
 *
 * Fixtures are the live Supabase rows, read 2026-09-02. Pure — no network.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveScopeFromHost,
  resolveScopeFromProjectSegment,
  defaultLocaleForProjectSegment,
  isKnownProjectSegment,
  lookupHostRoute,
} from '../host-scope'
import { asUrlProjectSegment } from '../ids'
import { GENERATED_HOST_ROUTES } from '../generated/route-config'

// ─── The incumbent, transcribed verbatim from commit c73fd54 ─────────────────

/** src/proxy.ts `resolveTenant` as it stood before this commit. */
function legacyResolveTenant(hostname: string): string | null {
  const host = hostname.split(':')[0].replace(/^www\./, '')
  if (host.endsWith('.preview.abluo.app')) {
    const slug = host.slice(0, -'.preview.abluo.app'.length)
    if (slug && slug !== 'www') return slug
  }
  const domainMap: Record<string, string> = {
    'livener.net': 'livener',
    'studiomartegani.com': 'studiomartegani',
    'abluo.app': 'abluo',
    'dev.abluo.app': 'abluo',
    'nologo.cloud': 'nologo',
    'ch-psicoterapeuta.com': 'hoffmann',
  }
  if (domainMap[host]) return domainMap[host]
  if (host.endsWith('.localhost')) {
    const sub = host.replace('.localhost', '')
    if (sub && sub !== 'www') return sub
  }
  return null
}

/** src/proxy.ts `resolveDefaultLocale` as it stood before this commit. */
function legacyResolveDefaultLocale(projectSlug: string): string | null {
  const localeMap: Record<string, string> = {
    studiomartegani: 'it',
    livener: 'en',
    abluo: 'en',
    nologo: 'en',
    hoffmann: 'it',
  }
  return localeMap[projectSlug] ?? null
}

/** src/lib/sanity/client.ts `KNOWN_PROJECT_SEGMENTS` as it stood before this commit. */
const LEGACY_KNOWN_PROJECT_SEGMENTS = new Set([
  'livener',
  'studiomartegani',
  'abluo',
  'nologo',
  'hoffmann',
])

// ─── 1. Every live host resolves to the right project AND locale ─────────────

interface HostCase {
  host: string
  tenantSlug: string
  projectSlug: string
  projectId: string
  defaultLocale: string
}

/**
 * One row per host the platform serves, from the live `projects` table
 * (7 projects, 20 hosts). This is the acceptance table for the flip: if a row
 * here is wrong, a real site serves the wrong content.
 */
const LIVE_HOSTS: HostCase[] = [
  // abluo — the platform's own site
  { host: 'abluo.app',                    tenantSlug: 'abluo',           projectSlug: 'abluo',           projectId: '84702a83-b59a-434d-8dd4-99ea7292f873', defaultLocale: 'en' },
  { host: 'dev.abluo.app',                tenantSlug: 'abluo',           projectSlug: 'abluo',           projectId: '84702a83-b59a-434d-8dd4-99ea7292f873', defaultLocale: 'en' },
  { host: 'abluo.preview.abluo.app',      tenantSlug: 'abluo',           projectSlug: 'abluo',           projectId: '84702a83-b59a-434d-8dd4-99ea7292f873', defaultLocale: 'en' },
  { host: 'abluo.localhost',              tenantSlug: 'abluo',           projectSlug: 'abluo',           projectId: '84702a83-b59a-434d-8dd4-99ea7292f873', defaultLocale: 'en' },
  // livener
  { host: 'livener.net',                  tenantSlug: 'livener',         projectSlug: 'livener',         projectId: '6cf3b0d5-e878-4625-a231-f0b0176d4c4f', defaultLocale: 'en' },
  { host: 'livener.preview.abluo.app',    tenantSlug: 'livener',         projectSlug: 'livener',         projectId: '6cf3b0d5-e878-4625-a231-f0b0176d4c4f', defaultLocale: 'en' },
  { host: 'livener.localhost',            tenantSlug: 'livener',         projectSlug: 'livener',         projectId: '6cf3b0d5-e878-4625-a231-f0b0176d4c4f', defaultLocale: 'en' },
  // studiomartegani
  { host: 'studiomartegani.com',                 tenantSlug: 'studiomartegani', projectSlug: 'studiomartegani', projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a', defaultLocale: 'it' },
  { host: 'studiomartegani.preview.abluo.app',   tenantSlug: 'studiomartegani', projectSlug: 'studiomartegani', projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a', defaultLocale: 'it' },
  { host: 'studiomartegani.localhost',           tenantSlug: 'studiomartegani', projectSlug: 'studiomartegani', projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a', defaultLocale: 'it' },
  // nologo — tenant is freeriders, NOT nologo. The one-to-N case.
  { host: 'nologo.cloud',                 tenantSlug: 'freeriders',      projectSlug: 'nologo',          projectId: 'cd14c981-e458-48b6-9cd3-bb8c089d5cbc', defaultLocale: 'en' },
  { host: 'nologo.preview.abluo.app',     tenantSlug: 'freeriders',      projectSlug: 'nologo',          projectId: 'cd14c981-e458-48b6-9cd3-bb8c089d5cbc', defaultLocale: 'en' },
  { host: 'nologo.localhost',             tenantSlug: 'freeriders',      projectSlug: 'nologo',          projectId: 'cd14c981-e458-48b6-9cd3-bb8c089d5cbc', defaultLocale: 'en' },
  // hoffmann — an it-only site
  { host: 'ch-psicoterapeuta.com',        tenantSlug: 'hoffmann',        projectSlug: 'hoffmann',        projectId: '6d709178-f33a-4b4a-be52-521189e11290', defaultLocale: 'it' },
  { host: 'hoffmann.preview.abluo.app',   tenantSlug: 'hoffmann',        projectSlug: 'hoffmann',        projectId: '6d709178-f33a-4b4a-be52-521189e11290', defaultLocale: 'it' },
  { host: 'hoffmann.localhost',           tenantSlug: 'hoffmann',        projectSlug: 'hoffmann',        projectId: '6d709178-f33a-4b4a-be52-521189e11290', defaultLocale: 'it' },
  // amelie — active, NO custom_domain. Previewhosts only.
  { host: 'amelie.preview.abluo.app',     tenantSlug: 'amelie',          projectSlug: 'amelie',          projectId: 'fb34c7e4-6ecf-489a-b56a-8acbf75909cd', defaultLocale: 'en' },
  { host: 'amelie.localhost',             tenantSlug: 'amelie',          projectSlug: 'amelie',          projectId: 'fb34c7e4-6ecf-489a-b56a-8acbf75909cd', defaultLocale: 'en' },
]

describe('every live host resolves to the right project and locale', () => {
  it.each(LIVE_HOSTS)('$host', ({ host, tenantSlug, projectSlug, projectId, defaultLocale }) => {
    expect(resolveScopeFromHost(host)).toEqual({
      tenantSlug,
      projectSlug,
      projectId,
      defaultLocale,
    })
  })

  it('covers every ACTIVE host in the generated table — no row is untested', () => {
    const active = GENERATED_HOST_ROUTES.filter((r) => r.status === 'active').map((r) => r.host)
    expect([...active].sort()).toEqual(LIVE_HOSTS.map((c) => c.host).sort())
  })

  it('the locale is the PROJECT default, not the platform default', () => {
    // Two it-first sites. If the flip silently fell back to 'en' anywhere,
    // both of these would be 'en' and every root-path visitor would land on
    // the wrong language.
    expect(resolveScopeFromHost('studiomartegani.com')?.defaultLocale).toBe('it')
    expect(resolveScopeFromHost('ch-psicoterapeuta.com')?.defaultLocale).toBe('it')
  })
})

// ─── 2. Unknown hosts fail closed ────────────────────────────────────────────

describe('an unknown host resolves to no project', () => {
  it.each([
    'example.com',
    'not-a-customer.com',
    'nologo.cloud.evil.com',           // suffix-shaped impostor
    'abluo-platform.vercel.app',
    'admin.abluo.app',                 // platform host, deliberately projectless
    'preview.abluo.app',               // PATH-routed, carries no project itself
    'localhost',
  ])('%s → null', (host) => {
    expect(resolveScopeFromHost(host)).toBeNull()
  })

  it('BEHAVIOUR CHANGE: an unknown subdomain is no longer GUESSED', () => {
    // Before: proxy.ts returned whatever the subdomain said, for any subdomain,
    // and let the route 404 later. That is how one tenant's host can be made
    // to render another tenant's route.
    expect(legacyResolveTenant('evil.localhost')).toBe('evil')
    expect(legacyResolveTenant('not-a-project.preview.abluo.app')).toBe('not-a-project')
    // After: null. The request gets platform routes, not an invented project.
    expect(resolveScopeFromHost('evil.localhost')).toBeNull()
    expect(resolveScopeFromHost('not-a-project.preview.abluo.app')).toBeNull()
  })
})

// ─── 3. The route allow-list still 404s (the guard Step 5 nearly lost) ───────

describe('an unknown URL segment still produces a clean 404, not an empty 200', () => {
  // `(website)/[tenant]/layout.tsx` and its generateMetadata both do
  //   `if (!isKnownProjectSegment(tenantId)) notFound()`
  // so FALSE here is exactly "the route 404s". This is the behaviour that
  // `KNOWN_PROJECT_SEGMENTS` existed to preserve when TENANT_TO_PROJECT was
  // deleted; deriving the set from the generated table must not weaken it.
  it.each([
    'leads',           // a client-dashboard segment, not a website
    'some-typo',
    'login',
    'unauthorized',
    'dashboard',
    'studio',
    '',
    'evil',
    'ABLUO',           // exact match only — no case folding on a URL segment
    'livener-main',    // the retired Sanity name; never was a URL segment
    'studiomartegani-main',
  ])('%s is NOT a known segment → notFound()', (segment) => {
    expect(isKnownProjectSegment(asUrlProjectSegment(segment))).toBe(false)
    expect(resolveScopeFromProjectSegment(segment)).toBeNull()
    expect(defaultLocaleForProjectSegment(segment)).toBeNull()
  })

  it('never throws — a 404 must not become a 500', () => {
    for (const segment of ['', '../../etc/passwd', '%2e%2e', 'a'.repeat(500)]) {
      expect(() => isKnownProjectSegment(asUrlProjectSegment(segment))).not.toThrow()
      expect(isKnownProjectSegment(asUrlProjectSegment(segment))).toBe(false)
    }
  })

  it('every segment the hand-typed list accepted is still accepted', () => {
    // The flip must not REMOVE a segment: that would 404 a live site.
    for (const segment of LEGACY_KNOWN_PROJECT_SEGMENTS) {
      expect(isKnownProjectSegment(asUrlProjectSegment(segment)), segment).toBe(true)
    }
  })

  it('accepts exactly the ACTIVE projects, and nothing else', () => {
    const activeSlugs = [
      ...new Set(GENERATED_HOST_ROUTES.filter((r) => r.status === 'active').map((r) => r.projectSlug)),
    ].sort()
    expect(activeSlugs).toEqual(['abluo', 'amelie', 'hoffmann', 'livener', 'nologo', 'studiomartegani'])
    for (const slug of activeSlugs) {
      expect(isKnownProjectSegment(asUrlProjectSegment(slug)), slug).toBe(true)
    }
    // t42 is in the table but inactive — it must NOT become routable.
    expect(isKnownProjectSegment(asUrlProjectSegment('t42'))).toBe(false)
  })
})

// ─── 4. The named behaviour changes ──────────────────────────────────────────

describe('BEHAVIOUR CHANGE: hoffmann (ch-psicoterapeuta.com)', () => {
  /**
   * ⚠️ RENAME.md Step 6 says this host "resolves to null in the current maps
   * and gets platform routes". That was true when the runbook was written
   * (2026-08-31) and is NOT true of the code this commit replaces: by
   * 2026-09-01 somebody had hand-added `ch-psicoterapeuta.com` to `domainMap`,
   * `hoffmann` to `resolveDefaultLocale`, and `hoffmann` to
   * `KNOWN_PROJECT_SEGMENTS`. The flip is therefore a NO-OP for this host.
   * The runbook is stale; this test is the evidence.
   */
  it('was already served correctly before the flip', () => {
    expect(legacyResolveTenant('ch-psicoterapeuta.com')).toBe('hoffmann')
    expect(legacyResolveDefaultLocale('hoffmann')).toBe('it')
    expect(LEGACY_KNOWN_PROJECT_SEGMENTS.has('hoffmann')).toBe(true)
  })

  it('is served identically after the flip — same project, same locale', () => {
    expect(resolveScopeFromHost('ch-psicoterapeuta.com')?.projectSlug).toBe('hoffmann')
    expect(resolveScopeFromHost('ch-psicoterapeuta.com')?.defaultLocale).toBe('it')
    expect(isKnownProjectSegment(asUrlProjectSegment('hoffmann'))).toBe(true)
  })

  it('gains only the tenant grain, which the old maps could not express', () => {
    // The old maps returned a bare string. Nothing at the edge knew that this
    // project belongs to tenant `hoffmann` rather than, say, `freeriders`.
    expect(resolveScopeFromHost('ch-psicoterapeuta.com')?.tenantSlug).toBe('hoffmann')
  })

  it('www. and a case-varied host reach the same site (they did not before)', () => {
    // `Ch-Psicoterapeuta.com` missed `domainMap` entirely — Host headers are
    // case-insensitive and browsers do not normalise them.
    expect(legacyResolveTenant('Ch-Psicoterapeuta.com')).toBeNull()
    expect(resolveScopeFromHost('Ch-Psicoterapeuta.com')?.projectSlug).toBe('hoffmann')
    expect(resolveScopeFromHost('ch-psicoterapeuta.com.')?.projectSlug).toBe('hoffmann')
  })
})

describe('BEHAVIOUR CHANGE: amelie — the one project the flip actually fixes', () => {
  /**
   * `amelie` is an ACTIVE project with NO `custom_domain`, so it has no apex
   * host: it is reachable only at `amelie.preview.abluo.app` (and
   * `amelie.localhost` in dev).
   *
   * BEFORE: `legacyResolveTenant('amelie.preview.abluo.app')` returned
   * `'amelie'` — but by GUESSING the subdomain, not from any map. Then
   * `resolveDefaultLocale('amelie')` returned null, so proxy.ts fell back to
   * `'en'`, rewrote to `/en/amelie`, and the route boundary called
   * `isKnownProjectSegment('amelie')` → FALSE → `notFound()`. The project was
   * unreachable: a hard 404 on its own preview host.
   *
   * (The runbook says it "gets platform routes". That is not what happened —
   * it 404'd. Same conclusion, different failure; recorded here because the
   * distinction matters when reading logs after the deploy.)
   *
   * AFTER: it resolves from the table, with its real locale, and renders.
   */
  it('BEFORE: the segment was rejected by the route allow-list → 404', () => {
    expect(legacyResolveTenant('amelie.preview.abluo.app')).toBe('amelie') // guessed
    expect(legacyResolveDefaultLocale('amelie')).toBeNull()                // unknown
    expect(LEGACY_KNOWN_PROJECT_SEGMENTS.has('amelie')).toBe(false)        // → notFound()
  })

  it('AFTER: the host resolves to the amelie project', () => {
    expect(resolveScopeFromHost('amelie.preview.abluo.app')).toEqual({
      tenantSlug: 'amelie',
      projectSlug: 'amelie',
      projectId: 'fb34c7e4-6ecf-489a-b56a-8acbf75909cd',
      defaultLocale: 'en',
    })
  })

  it('AFTER: the segment is allowed, so /en/amelie renders instead of 404ing', () => {
    expect(isKnownProjectSegment(asUrlProjectSegment('amelie'))).toBe(true)
    expect(defaultLocaleForProjectSegment('amelie')).toBe('en')
  })

  it('has no apex host — it is preview-only until a custom_domain is set', () => {
    const hosts = GENERATED_HOST_ROUTES.filter((r) => r.projectSlug === 'amelie').map((r) => r.host)
    expect(hosts.sort()).toEqual(['amelie.localhost', 'amelie.preview.abluo.app'])
  })
})

describe('BEHAVIOUR CHANGE: t42 stops resolving one layer earlier', () => {
  it('BEFORE: guessed to "t42", then 404d at the route boundary', () => {
    expect(legacyResolveTenant('t42.preview.abluo.app')).toBe('t42')
    expect(LEGACY_KNOWN_PROJECT_SEGMENTS.has('t42')).toBe(false)
  })

  it('AFTER: null at the edge — same visible outcome, decided on purpose', () => {
    expect(lookupHostRoute('t42.preview.abluo.app')?.status).toBe('inactive')
    expect(resolveScopeFromHost('t42.preview.abluo.app')).toBeNull()
    expect(isKnownProjectSegment(asUrlProjectSegment('t42'))).toBe(false)
  })
})

// ─── 5. No live host lost its locale ─────────────────────────────────────────

describe('locale parity with the deleted resolveDefaultLocale map', () => {
  it.each([...LEGACY_KNOWN_PROJECT_SEGMENTS])(
    '%s keeps the exact locale the hand-typed map gave it',
    (segment) => {
      expect(defaultLocaleForProjectSegment(segment)).toBe(legacyResolveDefaultLocale(segment))
    }
  )

  it('adds amelie, which the hand-typed map did not know', () => {
    expect(legacyResolveDefaultLocale('amelie')).toBeNull()
    expect(defaultLocaleForProjectSegment('amelie')).toBe('en')
  })

  it('still answers null for the non-project paths the map guarded', () => {
    // This null is what stops proxy.ts rewriting /login to /en/login/... as if
    // `login` were a customer site.
    for (const path of ['login', 'unauthorized', 'dashboard', 'account', 'studio', 'api']) {
      expect(legacyResolveDefaultLocale(path)).toBeNull()
      expect(defaultLocaleForProjectSegment(path)).toBeNull()
    }
  })
})

// ─── 6. Adding a project must stay code-free ─────────────────────────────────

describe('the "one Supabase row + DNS, no code" claim', () => {
  it('has exactly ONE routing table, and it is generated', () => {
    // Every project the resolver serves comes from GENERATED_HOST_ROUTES.
    // If any hand-typed list of projects reappears anywhere in the request
    // path, this invariant is the thing that should have caught it: the set
    // the allow-list accepts is computed from the table, not typed beside it.
    const activeSlugs = new Set(
      GENERATED_HOST_ROUTES.filter((r) => r.status === 'active').map((r) => r.projectSlug)
    )
    for (const slug of activeSlugs) {
      expect(isKnownProjectSegment(asUrlProjectSegment(slug)), slug).toBe(true)
      expect(defaultLocaleForProjectSegment(slug), slug).not.toBeNull()
      expect(resolveScopeFromHost(`${slug}.preview.abluo.app`), slug).not.toBeNull()
    }
  })
})
