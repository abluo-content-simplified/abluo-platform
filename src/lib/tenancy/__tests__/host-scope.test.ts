/**
 * Host → project scope resolution — Tests (EXPAND phase).
 *
 * Two jobs:
 *
 *  1. EQUIVALENCE. `src/proxy.ts` is the incumbent. Its behaviour for every
 *     host it serves today is transcribed below as `proxyResolveTenant` /
 *     `proxyResolveDefaultLocale` — a literal copy of proxy.ts:19-81 as of
 *     2026-08-31 — and every live host is asserted against it. Where the new
 *     resolver deliberately disagrees, the test asserts the DISAGREEMENT
 *     explicitly, with the reason. A divergence that is written down and
 *     asserted is a decision; one that is only true is a landmine.
 *
 *  2. THE ONE-TO-N CASE. `freeriders` owns TWO projects — `nologo` (live on
 *     nologo.cloud) and `t42` (inactive, no custom domain). That is the whole
 *     point of the exercise: no URL shape today can express "tenant freeriders,
 *     project t42", and the host model has to.
 *
 * Fixtures are the live Supabase rows, not invented data. Pure — no network.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveScopeFromHost,
  lookupHostRoute,
  isPlatformHost,
  normalizeHost,
  hostsForProjectId,
} from '../host-scope'
import { GENERATED_HOST_ROUTES } from '../generated/route-config'

// ─── The incumbent, transcribed verbatim from src/proxy.ts (2026-08-31) ──────

/** proxy.ts:19 `resolveTenant`. Copied, not imported — proxy.ts pulls in
 *  next/server and Supabase and cannot be loaded in a node-env unit test. */
function proxyResolveTenant(hostname: string): string | null {
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

/** proxy.ts:73 `resolveDefaultLocale`. */
function proxyResolveDefaultLocale(projectSlug: string): string | null {
  const localeMap: Record<string, string> = {
    studiomartegani: 'it',
    livener: 'en',
    abluo: 'en',
    nologo: 'en',
    hoffmann: 'it',
  }
  return localeMap[projectSlug] ?? null
}

// ─── The five live projects, as proxy.ts serves them today ───────────────────

interface LiveProject {
  name: string
  /** Every host proxy.ts routes to this project today. */
  hosts: string[]
  /** What proxy.ts's resolveTenant returns for those hosts. */
  proxySlug: string
  /** What proxy.ts's resolveDefaultLocale returns for that slug. */
  proxyLocale: string | null
  /** What the new resolver must return. */
  expected: {
    tenantSlug: string
    projectSlug: string
    projectId: string
    defaultLocale: string
  } | null
}

const LIVE_PROJECTS: LiveProject[] = [
  {
    name: 'livener',
    hosts: ['livener.net', 'www.livener.net', 'livener.preview.abluo.app', 'livener.localhost'],
    proxySlug: 'livener',
    proxyLocale: 'en',
    expected: {
      tenantSlug: 'livener',
      projectSlug: 'livener',
      projectId: '6cf3b0d5-e878-4625-a231-f0b0176d4c4f',
      defaultLocale: 'en',
    },
  },
  {
    name: 'studiomartegani',
    hosts: [
      'studiomartegani.com',
      'www.studiomartegani.com',
      'studiomartegani.preview.abluo.app',
      'studiomartegani.localhost',
    ],
    proxySlug: 'studiomartegani',
    proxyLocale: 'it',
    expected: {
      tenantSlug: 'studiomartegani',
      projectSlug: 'studiomartegani',
      projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a',
      defaultLocale: 'it',
    },
  },
  {
    name: 'nologo (tenant freeriders — the one-to-N case)',
    hosts: ['nologo.cloud', 'www.nologo.cloud', 'nologo.preview.abluo.app', 'nologo.localhost'],
    proxySlug: 'nologo',
    proxyLocale: 'en',
    expected: {
      tenantSlug: 'freeriders',
      projectSlug: 'nologo',
      projectId: 'cd14c981-e458-48b6-9cd3-bb8c089d5cbc',
      defaultLocale: 'en',
    },
  },
  {
    name: 'abluo (platform site)',
    hosts: ['abluo.app', 'www.abluo.app', 'dev.abluo.app'],
    // Divergence (A) — RESOLVED. proxy.ts used to call this project by a
    // longer name of its own (see ../RENAME.md §0); Step 1 of that runbook
    // renamed the URL segment to the database's name, so proxy.ts and this
    // resolver now agree.
    proxySlug: 'abluo',
    proxyLocale: 'en',
    expected: {
      tenantSlug: 'abluo',
      projectSlug: 'abluo',
      projectId: '84702a83-b59a-434d-8dd4-99ea7292f873',
      defaultLocale: 'en',
    },
  },
  {
    name: 'hoffmann',
    hosts: ['ch-psicoterapeuta.com', 'www.ch-psicoterapeuta.com', 'hoffmann.preview.abluo.app'],
    // Divergence (B) RESOLVED 2026-09-01: hoffmann was added to all three
    // proxy.ts maps so her site could be built. proxy.ts and the resolver now
    // agree. Step 6 deletes the maps entirely and this row stops being special.
    proxySlug: 'hoffmann',
    proxyLocale: 'it',
    expected: {
      tenantSlug: 'hoffmann',
      projectSlug: 'hoffmann',
      projectId: '6d709178-f33a-4b4a-be52-521189e11290',
      defaultLocale: 'it',
    },
  },
]

// ─── 1. Equivalence with proxy.ts ────────────────────────────────────────────

describe('equivalence with the proxy.ts host maps', () => {
  it.each(LIVE_PROJECTS)('$name resolves on every host it serves', (project) => {
    for (const host of project.hosts) {
      expect(resolveScopeFromHost(host), `host ${host}`).toEqual(project.expected)
    }
  })

  it('agrees with proxy.ts on the PROJECT SLUG for every project proxy.ts knows', () => {
    for (const project of LIVE_PROJECTS) {
      // Nothing is skipped any more. abluo used to be (divergence A, fixed by
      // RENAME.md Step 1) and hoffmann used to be (divergence B, fixed
      // 2026-09-01 by adding her to the three proxy maps). Every live project
      // now resolves identically through both paths.
      for (const host of project.hosts) {
        expect(proxyResolveTenant(host), `proxy on ${host}`).toBe(project.proxySlug)
        expect(resolveScopeFromHost(host)?.projectSlug, `new on ${host}`).toBe(project.proxySlug)
      }
    }
  })

  it('agrees with proxy.ts on the DEFAULT LOCALE for every project it knows', () => {
    for (const project of LIVE_PROJECTS) {
      if (project.proxyLocale === null) continue // divergence (B)
      expect(proxyResolveDefaultLocale(project.proxySlug)).toBe(project.proxyLocale)
      for (const host of project.hosts) {
        expect(resolveScopeFromHost(host)?.defaultLocale, `locale on ${host}`).toBe(
          project.proxyLocale
        )
      }
    }
  })

  // ── The divergences, asserted rather than discovered at flip time ──────────

  // ── (A) is a REGRESSION GUARD now, not a divergence ────────────────────────
  // HISTORY: this test used to be named
  //   'DIVERGENCE (A): proxy.ts says "<the legacy segment>", the database says "abluo"'
  // and asserted the opposite of what it asserts below — proxy.ts resolved
  // abluo.app to a longer URL slug of its own (spelled out in `../RENAME.md`
  // §0) while Supabase called the project `abluo`, and
  // `resolveDefaultLocale('abluo')` returned null. That
  // made flipping proxy.ts onto this resolver a BLOCKER: the flip would have
  // silently renamed the platform's own URL segment.
  // Step 1 of `../RENAME.md` settled it by renaming the URL segment (an
  // internal rewrite target, invisible in the browser, present in zero Sanity
  // documents) to the database's `abluo`. This test now guards the agreement so
  // the old three-name split cannot come back unnoticed.
  it('AGREEMENT (was divergence A): proxy.ts and the resolver both say "abluo"', () => {
    expect(proxyResolveTenant('abluo.app')).toBe('abluo')
    expect(proxyResolveTenant('dev.abluo.app')).toBe('abluo')
    expect(resolveScopeFromHost('abluo.app')?.projectSlug).toBe('abluo')
    expect(resolveScopeFromHost('dev.abluo.app')?.projectSlug).toBe('abluo')
    // The locale map answers for the database's name too — the second half of
    // what made this a flip-time blocker.
    expect(proxyResolveDefaultLocale('abluo')).toBe('en')
    expect(resolveScopeFromHost('abluo.app')?.defaultLocale).toBe('en')
    // www. is stripped before the lookup, so every platform host agrees too.
    expect(proxyResolveTenant('www.abluo.app')).toBe('abluo')
  })

  // ── (B) is a REGRESSION GUARD now, not a divergence ────────────────────────
  // HISTORY: this test was 'DIVERGENCE (B): ch-psicoterapeuta.com is live in
  // Supabase and unknown to proxy.ts', and asserted proxyResolveTenant(...) was
  // NULL — Hoffmann's domain was in the database but in none of the three
  // hand-typed maps, so her site could not be served at all. Fixed 2026-09-01.
  // This is the drift the maps produce: a client is onboarded in Supabase and
  // the maps are not updated, because nothing forces them to be. Step 6 removes
  // the maps so the class cannot recur.
  it('AGREEMENT (was divergence B): proxy.ts and the resolver both serve hoffmann', () => {
    expect(proxyResolveTenant('ch-psicoterapeuta.com')).toBe('hoffmann')
    expect(proxyResolveTenant('www.ch-psicoterapeuta.com')).toBe('hoffmann')
    expect(proxyResolveTenant('hoffmann.preview.abluo.app')).toBe('hoffmann')
    expect(proxyResolveDefaultLocale('hoffmann')).toBe('it')
    expect(resolveScopeFromHost('ch-psicoterapeuta.com')).toEqual({
      tenantSlug: 'hoffmann',
      projectSlug: 'hoffmann',
      projectId: '6d709178-f33a-4b4a-be52-521189e11290',
      defaultLocale: 'it',
    })
  })

  it('DIVERGENCE (C): proxy.ts guesses unknown subdomains; this resolver refuses', () => {
    // proxy.ts hands back whatever the subdomain says, for any subdomain.
    expect(proxyResolveTenant('not-a-project.preview.abluo.app')).toBe('not-a-project')
    expect(proxyResolveTenant('evil.localhost')).toBe('evil')
    // Fail-closed: an unknown host has no project, and no amount of
    // subdomain-shaped hopefulness will invent one.
    expect(resolveScopeFromHost('not-a-project.preview.abluo.app')).toBeNull()
    expect(resolveScopeFromHost('evil.localhost')).toBeNull()
  })

  it('DIVERGENCE (D): returns the Supabase slug, never the Sanity "-main" name', () => {
    expect(resolveScopeFromHost('livener.net')?.projectSlug).toBe('livener')
    expect(resolveScopeFromHost('livener.net')?.projectSlug).not.toBe('livener-main')
  })
})

// ─── 2. The two-project tenant ───────────────────────────────────────────────

describe('one tenant, N projects: freeriders owns nologo and t42', () => {
  it('has both projects in the generated table under one tenant', () => {
    const freeriders = GENERATED_HOST_ROUTES.filter((r) => r.tenantSlug === 'freeriders')
    const projectSlugs = [...new Set(freeriders.map((r) => r.projectSlug))].sort()
    expect(projectSlugs).toEqual(['nologo', 't42'])
  })

  it('gives the two projects DIFFERENT hosts and different project ids (D-2)', () => {
    const nologo = resolveScopeFromHost('nologo.cloud')
    const t42Row = lookupHostRoute('t42.preview.abluo.app')
    expect(nologo?.projectId).toBe('cd14c981-e458-48b6-9cd3-bb8c089d5cbc')
    expect(t42Row?.projectId).toBe('eaab108c-3dca-471a-a16c-d6db96a74fe4')
    expect(nologo?.projectId).not.toBe(t42Row?.projectId)
    // Same tenant, though — that is the relationship the URL cannot express.
    expect(nologo?.tenantSlug).toBe('freeriders')
    expect(t42Row?.tenantSlug).toBe('freeriders')
  })

  it('resolves the tenant for nologo — the case the "-main" regex got wrong', () => {
    // The retired regex derived tenant "nologo" from project slug "nologo".
    // The owner is freeriders, and no string transformation could know that.
    expect(resolveScopeFromHost('nologo.cloud')?.tenantSlug).toBe('freeriders')
    expect(resolveScopeFromHost('nologo.cloud')?.projectSlug).toBe('nologo')
  })

  it('does NOT serve t42: it is present in the table but inactive', () => {
    expect(lookupHostRoute('t42.preview.abluo.app')?.status).toBe('inactive')
    expect(resolveScopeFromHost('t42.preview.abluo.app')).toBeNull()
    expect(resolveScopeFromHost('t42.localhost')).toBeNull()
  })

  it('t42 has no custom domain, so no apex host exists for it', () => {
    const t42Hosts = GENERATED_HOST_ROUTES.filter((r) => r.projectSlug === 't42').map((r) => r.host)
    expect(t42Hosts.some((h) => h.endsWith('.preview.abluo.app'))).toBe(true)
    expect(t42Hosts.some((h) => h.endsWith('.localhost'))).toBe(true)
    expect(t42Hosts.filter((h) => !h.includes('abluo.app') && !h.endsWith('.localhost'))).toEqual([])
  })
})

// ─── 3. Unknown hosts ────────────────────────────────────────────────────────

describe('unknown hosts', () => {
  it.each([
    'example.com',
    'nologo.cloud.evil.com',
    'preview.abluo.app', // bare preview host: PATH-routed, no project
    'admin.abluo.app',
    'localhost',
    'abluo-platform.vercel.app',
  ])('returns null for %s', (host) => {
    expect(resolveScopeFromHost(host)).toBeNull()
  })

  it.each([null, undefined, '', '   ', '::::'])('returns null for %s', (host) => {
    expect(resolveScopeFromHost(host as string | null | undefined)).toBeNull()
  })

  it('distinguishes a known platform host from a host it has never heard of', () => {
    expect(isPlatformHost('admin.abluo.app')).toBe(true)
    expect(isPlatformHost('preview.abluo.app')).toBe(true)
    expect(isPlatformHost('localhost')).toBe(true)
    expect(isPlatformHost('localhost:3000')).toBe(true)
    expect(isPlatformHost('example.com')).toBe(false)
    // Both still resolve to null — for ROUTING they are the same answer.
    expect(resolveScopeFromHost('admin.abluo.app')).toBeNull()
    expect(resolveScopeFromHost('example.com')).toBeNull()
  })

  it('never falls back to a default project', () => {
    const scopes = ['a.com', 'b.preview.abluo.app', 'c.localhost'].map(resolveScopeFromHost)
    expect(scopes).toEqual([null, null, null])
  })
})

// ─── 4. Normalisation: www, port, case, trailing dot ─────────────────────────

describe('host normalisation', () => {
  const expected = {
    tenantSlug: 'studiomartegani',
    projectSlug: 'studiomartegani',
    projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a',
    defaultLocale: 'it',
  }

  it.each([
    ['bare', 'studiomartegani.com'],
    ['www', 'www.studiomartegani.com'],
    ['port', 'studiomartegani.com:443'],
    ['www + port', 'www.studiomartegani.com:8080'],
    ['upper case', 'STUDIOMARTEGANI.COM'],
    ['mixed case + www', 'WWW.StudioMartegani.com'],
    ['trailing dot', 'studiomartegani.com.'],
    ['trailing dot + port', 'studiomartegani.com.:443'],
    ['whitespace', '  studiomartegani.com  '],
    ['scheme pasted in', 'https://studiomartegani.com'],
  ])('%s → the same scope', (_label, host) => {
    expect(resolveScopeFromHost(host)).toEqual(expected)
  })

  it('normalises dev-convention and preview hosts the same way', () => {
    expect(resolveScopeFromHost('Livener.LocalHost:3000')?.projectSlug).toBe('livener')
    expect(resolveScopeFromHost('LIVENER.preview.abluo.app:443')?.projectSlug).toBe('livener')
  })

  it('handles IPv6 literals without mangling them into a partial host', () => {
    // proxy.ts's split(':')[0] turns this into "[", a host that could in
    // principle collide with a table key. It must fail as UNKNOWN, not as junk.
    expect(normalizeHost('[::1]:3000')).toBe('[::1]')
    expect(resolveScopeFromHost('[::1]:3000')).toBeNull()
  })

  it('normalizeHost is idempotent over every host in the generated table', () => {
    for (const route of GENERATED_HOST_ROUTES) {
      expect(normalizeHost(route.host)).toBe(route.host)
    }
  })
})

// ─── 5. Table invariants ─────────────────────────────────────────────────────

describe('generated table invariants', () => {
  it('is sorted by host, so regeneration produces no spurious diff', () => {
    const hosts = GENERATED_HOST_ROUTES.map((r) => r.host)
    expect(hosts).toEqual([...hosts].sort())
  })

  it('D-2: no host serves two projects', () => {
    const byHost = new Map<string, string>()
    for (const route of GENERATED_HOST_ROUTES) {
      const prev = byHost.get(route.host)
      expect(prev === undefined || prev === route.projectId, `collision on ${route.host}`).toBe(true)
      byHost.set(route.host, route.projectId)
    }
    expect(byHost.size).toBe(GENERATED_HOST_ROUTES.length)
  })

  it('no generated host is also a platform host', () => {
    for (const route of GENERATED_HOST_ROUTES) {
      expect(isPlatformHost(route.host), `${route.host} is both`).toBe(false)
    }
  })

  it('every row carries both grains and a project id', () => {
    for (const route of GENERATED_HOST_ROUTES) {
      expect(route.tenantSlug.length).toBeGreaterThan(0)
      expect(route.projectSlug.length).toBeGreaterThan(0)
      expect(route.projectId).toMatch(/^[0-9a-f-]{36}$/)
      expect(route.defaultLocale).toMatch(/^[a-z]{2}$/)
    }
  })

  it('every project has a preview and a localhost host', () => {
    const byProject = new Map<string, string[]>()
    for (const route of GENERATED_HOST_ROUTES) {
      byProject.set(route.projectId, [...(byProject.get(route.projectId) ?? []), route.hostKind])
    }
    for (const [projectId, kinds] of byProject) {
      expect(kinds, projectId).toContain('preview-subdomain')
      expect(kinds, projectId).toContain('localhost-subdomain')
    }
  })

  it('hostsForProjectId returns the full alias set of the platform project', () => {
    const hosts = hostsForProjectId('84702a83-b59a-434d-8dd4-99ea7292f873').map((r) => r.host)
    expect(hosts.sort()).toEqual([
      'abluo.app',
      'abluo.localhost',
      'abluo.preview.abluo.app',
      'dev.abluo.app',
    ])
  })
})
