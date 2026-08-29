/**
 * Project → Tenant scope resolution — Tests
 *
 * Fixtures are the five real `project` documents in the live `production`
 * dataset (Sanity project 3n7t84j3), read on 2026-08-29. Four of them agree
 * with the legacy "-main" strip by luck; `nologo` does not, and that one is
 * the reason the whole refactor exists.
 *
 * These tests are pure — no Sanity client, no network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deriveTenantSlug,
  legacyTenantSlugFromProjectSlug,
  findKnownInconsistency,
  KNOWN_TENANT_SCOPE_INCONSISTENCIES,
  __resetTenantScopeWarnings,
  type ProjectScopeInput,
} from '../project-scope'

// ─── Fixtures: the five real projects ────────────────────────────────────────

/** Shape of a project as the dual-read sees it, pre-migration. */
type RealProject = ProjectScopeInput & { _id: string; trueTenantSlug: string }

const livener: RealProject = {
  _id: '088e16f6-0288-47b9-af2b-4ef28f90c6a8',
  projectSlug: 'livener-main',
  clientRef: { tenantSlug: 'livener' },
  trueTenantSlug: 'livener',
}

const studiomartegani: RealProject = {
  _id: '90b7cb26-b192-4e8c-8378-d16c085540fd',
  projectSlug: 'studiomartegani-main',
  clientRef: { tenantSlug: 'studiomartegani' },
  trueTenantSlug: 'studiomartegani',
}

const abluo: RealProject = {
  _id: '38cf9381-3893-489a-a987-3a2da28f561b',
  projectSlug: 'abluo',
  clientRef: { tenantSlug: 'abluo' },
  trueTenantSlug: 'abluo',
}

/** Draft-only document; still a real project for scoping purposes. */
const amelie: RealProject = {
  _id: 'drafts.28f192d5-f59d-44c5-a738-e10aaeaed041',
  projectSlug: 'amelie',
  clientRef: { tenantSlug: 'amelie' },
  trueTenantSlug: 'amelie',
}

/** The broken one: slug says "nologo", the owner is Freeriders. */
const nologo: RealProject = {
  _id: 'project-nologo',
  projectSlug: 'nologo',
  clientRef: { tenantSlug: 'freeriders' },
  trueTenantSlug: 'freeriders',
}

const ALL_REAL_PROJECTS = [livener, studiomartegani, abluo, amelie, nologo]
/** The four whose legacy derivation happens to be right. */
const LUCKY_PROJECTS = [livener, studiomartegani, abluo, amelie]

// ─── Harness ─────────────────────────────────────────────────────────────────

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetTenantScopeWarnings()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

/** All console.warn output from this test, joined. */
const warnings = () => warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')

// ─── Tier 1: stored project.tenantSlug ───────────────────────────────────────

describe('deriveTenantSlug — tier 1, stored tenantSlug', () => {
  it('prefers a stored tenantSlug over clientRef and over the suffix strip', () => {
    const scope = deriveTenantSlug({
      projectSlug: 'nologo',
      tenantSlug: 'freeriders',
      clientRef: { tenantSlug: 'freeriders' },
    })
    expect(scope).toEqual({
      projectSlug: 'nologo',
      tenantSlug: 'freeriders',
      source: 'stored',
    })
  })

  it('wins even when it disagrees with clientRef (stored is the post-migration authority)', () => {
    const scope = deriveTenantSlug({
      projectSlug: 'livener-main',
      tenantSlug: 'someothertenant',
      clientRef: { tenantSlug: 'livener' },
    })
    expect(scope?.tenantSlug).toBe('someothertenant')
    expect(scope?.source).toBe('stored')
  })

  it('never emits the unreliable-legacy warning', () => {
    deriveTenantSlug({ projectSlug: 'livener-main', tenantSlug: 'livener' })
    expect(warnings()).not.toContain('UNRELIABLE')
  })

  it('treats an empty or whitespace-only stored value as absent', () => {
    expect(
      deriveTenantSlug({ projectSlug: 'abluo', tenantSlug: '', clientRef: { tenantSlug: 'abluo' } })?.source
    ).toBe('clientRef')
    expect(
      deriveTenantSlug({ projectSlug: 'abluo', tenantSlug: '   ', clientRef: { tenantSlug: 'abluo' } })?.source
    ).toBe('clientRef')
  })
})

// ─── Tier 2: clientRef->tenantSlug ───────────────────────────────────────────

describe('deriveTenantSlug — tier 2, clientRef', () => {
  it('resolves every real project to its TRUE owner, including nologo → freeriders', () => {
    for (const p of ALL_REAL_PROJECTS) {
      const scope = deriveTenantSlug({ projectSlug: p.projectSlug, clientRef: p.clientRef })
      expect(scope, `project ${p._id}`).toEqual({
        projectSlug: p.projectSlug,
        tenantSlug: p.trueTenantSlug,
        source: 'clientRef',
      })
    }
  })

  it('accepts the flattened projection shape ("clientTenantSlug": clientRef->tenantSlug)', () => {
    const scope = deriveTenantSlug({ projectSlug: 'nologo', clientTenantSlug: 'freeriders' })
    expect(scope).toEqual({ projectSlug: 'nologo', tenantSlug: 'freeriders', source: 'clientRef' })
  })

  it('falls through to legacy when clientRef is present but unpopulated', () => {
    expect(deriveTenantSlug({ projectSlug: 'livener-main', clientRef: {} })?.source).toBe('legacy-suffix')
    expect(deriveTenantSlug({ projectSlug: 'abluo', clientRef: null })?.source).toBe('legacy-suffix')
    expect(
      deriveTenantSlug({ projectSlug: 'amelie', clientRef: { tenantSlug: null } })?.source
    ).toBe('legacy-suffix')
  })
})

// ─── Tier 3: legacy suffix strip ─────────────────────────────────────────────

describe('deriveTenantSlug — tier 3, legacy -main strip', () => {
  it('reproduces todays behaviour exactly for every real project', () => {
    for (const p of ALL_REAL_PROJECTS) {
      const scope = deriveTenantSlug({ projectSlug: p.projectSlug })
      expect(scope?.tenantSlug, `project ${p._id}`).toBe(
        p.projectSlug!.replace(/-main$/, '')
      )
      expect(scope?.source).toBe('legacy-suffix')
    }
  })

  it('is correct by luck for the four conventionally-named projects', () => {
    for (const p of LUCKY_PROJECTS) {
      expect(deriveTenantSlug({ projectSlug: p.projectSlug })?.tenantSlug).toBe(p.trueTenantSlug)
    }
  })

  it('is WRONG for nologo — it yields the project slug, not freeriders', () => {
    const scope = deriveTenantSlug({ projectSlug: nologo.projectSlug })
    expect(scope?.tenantSlug).toBe('nologo')
    expect(scope?.tenantSlug).not.toBe(nologo.trueTenantSlug)
  })

  it('only strips a trailing -main, not an embedded or leading one', () => {
    expect(legacyTenantSlugFromProjectSlug('main-site')).toBe('main-site')
    expect(legacyTenantSlugFromProjectSlug('acme-main-eu')).toBe('acme-main-eu')
    expect(legacyTenantSlugFromProjectSlug('acme-main-main')).toBe('acme-main')
  })

  it('warns that the derivation is unreliable, naming the project', () => {
    deriveTenantSlug({ projectSlug: 'studiomartegani-main' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warnings()).toContain('studiomartegani-main')
    expect(warnings()).toContain('UNRELIABLE')
  })

  it('warns once per slug, not once per call', () => {
    deriveTenantSlug({ projectSlug: 'livener-main' })
    deriveTenantSlug({ projectSlug: 'livener-main' })
    deriveTenantSlug({ projectSlug: 'livener-main' })
    expect(warn).toHaveBeenCalledTimes(1)

    deriveTenantSlug({ projectSlug: 'abluo' })
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

// ─── The disagreement warning ────────────────────────────────────────────────

describe('deriveTenantSlug — clientRef/legacy disagreement warning', () => {
  it('fires a distinct, louder warning for nologo', () => {
    deriveTenantSlug({ projectSlug: nologo.projectSlug, clientRef: nologo.clientRef })
    expect(warn).toHaveBeenCalledTimes(1)
    const text = warnings()
    expect(text).toContain('TENANT SCOPE DISAGREEMENT')
    expect(text).toContain('nologo')
    expect(text).toContain('freeriders')
    expect(text).toContain('KNOWN inconsistency')
  })

  it('does NOT fire for any of the four agreeing projects', () => {
    for (const p of LUCKY_PROJECTS) {
      deriveTenantSlug({ projectSlug: p.projectSlug, clientRef: p.clientRef })
    }
    expect(warnings()).not.toContain('DISAGREEMENT')
    expect(warn).not.toHaveBeenCalled()
  })

  it('fires even when the stored tier wins — the data mismatch is still there', () => {
    const scope = deriveTenantSlug({
      projectSlug: 'nologo',
      tenantSlug: 'freeriders',
      clientRef: { tenantSlug: 'freeriders' },
    })
    expect(scope?.source).toBe('stored')
    expect(warnings()).toContain('TENANT SCOPE DISAGREEMENT')
  })

  it('flags an UNKNOWN divergence differently, telling the reader to register it', () => {
    deriveTenantSlug({ projectSlug: 'brandnew', clientRef: { tenantSlug: 'someholding' } })
    const text = warnings()
    expect(text).toContain('TENANT SCOPE DISAGREEMENT')
    expect(text).toContain('NOT in KNOWN_TENANT_SCOPE_INCONSISTENCIES')
    expect(text).not.toContain('KNOWN inconsistency:')
  })

  it('warns once per slug', () => {
    deriveTenantSlug({ projectSlug: 'nologo', clientRef: { tenantSlug: 'freeriders' } })
    deriveTenantSlug({ projectSlug: 'nologo', clientRef: { tenantSlug: 'freeriders' } })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not change the returned value — warn-only, no behaviour branch', () => {
    const withoutClient = deriveTenantSlug({ projectSlug: 'nologo' })
    expect(withoutClient?.tenantSlug).toBe('nologo')
    expect(withoutClient?.source).toBe('legacy-suffix')
  })
})

// ─── The multi-project case the refactor exists for ──────────────────────────

describe('one tenant owning several projects', () => {
  // Freeriders already owns "nologo". The whole point of storing tenancy
  // rather than deriving it from a slug is that the tenant can own a second
  // site whose slug shares nothing with the tenant name.
  const freeridersProjects = [
    { projectSlug: 'nologo', clientRef: { tenantSlug: 'freeriders' } },
    { projectSlug: 'freeriders-shop', clientRef: { tenantSlug: 'freeriders' } },
  ]

  it('resolves both projects to the same tenant via clientRef', () => {
    const scopes = freeridersProjects.map((p) => deriveTenantSlug(p))
    expect(scopes.map((s) => s?.tenantSlug)).toEqual(['freeriders', 'freeriders'])
    expect(new Set(scopes.map((s) => s?.tenantSlug)).size).toBe(1)
  })

  it('the legacy strip splits them into two bogus tenants — the bug, demonstrated', () => {
    const legacy = freeridersProjects.map((p) => legacyTenantSlugFromProjectSlug(p.projectSlug))
    expect(legacy).toEqual(['nologo', 'freeriders-shop'])
    expect(new Set(legacy).size).toBe(2)
  })

  it('so a tenant-scoped form is shared by both projects only under clientRef', () => {
    // Forms are filed by tenantSlug. One form owned by "freeriders" must be
    // reachable from both of that tenant's projects.
    const form = { tenantSlug: 'freeriders' }
    const visibleUnderClientRef = freeridersProjects.filter(
      (p) => deriveTenantSlug(p)?.tenantSlug === form.tenantSlug
    )
    expect(visibleUnderClientRef).toHaveLength(2)

    const visibleUnderLegacy = freeridersProjects.filter(
      (p) => legacyTenantSlugFromProjectSlug(p.projectSlug) === form.tenantSlug
    )
    expect(visibleUnderLegacy).toHaveLength(0)
  })

  it('post-migration, a stored tenantSlug gives the same answer with source "stored"', () => {
    const migrated = freeridersProjects.map((p) => ({ ...p, tenantSlug: 'freeriders' }))
    for (const p of migrated) {
      expect(deriveTenantSlug(p)).toEqual({
        projectSlug: p.projectSlug,
        tenantSlug: 'freeriders',
        source: 'stored',
      })
    }
  })
})

// ─── Absent input ────────────────────────────────────────────────────────────

describe('deriveTenantSlug — no project', () => {
  it('returns null rather than a tenant, for undefined, null and empty slug', () => {
    expect(deriveTenantSlug({ projectSlug: undefined })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: null })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: '' })).toBeNull()
  })

  it('returns null even when a tenant slug is available — no project, no scope', () => {
    expect(deriveTenantSlug({ projectSlug: null, tenantSlug: 'freeriders' })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: '', clientRef: { tenantSlug: 'livener' } })).toBeNull()
  })

  it('does not warn when there is nothing to scope', () => {
    deriveTenantSlug({ projectSlug: undefined })
    expect(warn).not.toHaveBeenCalled()
  })
})

// ─── The inconsistency register ──────────────────────────────────────────────

describe('KNOWN_TENANT_SCOPE_INCONSISTENCIES', () => {
  it('records nologo → freeriders with the documents the migration must touch', () => {
    const entry = findKnownInconsistency('nologo')
    expect(entry).toBeDefined()
    expect(entry!.trueTenantSlug).toBe('freeriders')
    expect(entry!.legacyDerivedTenantSlug).toBe('nologo')
    expect(entry!.formsFiledUnderTenantSlug).toBe('nologo')
    expect(entry!.affectedDocumentIds).toContain('project-nologo')
    expect(entry!.affectedDocumentIds).toContain('form-nologo-demo')
  })

  it('holds exactly the divergences present in the live dataset', () => {
    const diverging = ALL_REAL_PROJECTS.filter(
      (p) => p.trueTenantSlug !== legacyTenantSlugFromProjectSlug(p.projectSlug!)
    ).map((p) => p.projectSlug)
    expect(diverging).toEqual(['nologo'])
    expect(KNOWN_TENANT_SCOPE_INCONSISTENCIES.map((e) => e.projectSlug)).toEqual(diverging)
  })

  it('every entry is genuinely a disagreement', () => {
    for (const e of KNOWN_TENANT_SCOPE_INCONSISTENCIES) {
      expect(e.trueTenantSlug).not.toBe(e.legacyDerivedTenantSlug)
      expect(e.legacyDerivedTenantSlug).toBe(legacyTenantSlugFromProjectSlug(e.projectSlug))
    }
  })

  it('returns undefined for a project with no recorded inconsistency', () => {
    expect(findKnownInconsistency('livener-main')).toBeUndefined()
  })
})
