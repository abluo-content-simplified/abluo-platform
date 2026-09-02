/**
 * Project → Tenant scope resolution — Tests (post-CONTRACT).
 *
 * Fixtures are the five real `project` documents in the live `production`
 * dataset (Sanity project 3n7t84j3). All five now carry a stored `tenantSlug`
 * (Stage 2 backfill), and `form-nologo-demo` has been repointed to
 * `freeriders` (Stage 3). The `-main` suffix strip is GONE — a project with no
 * resolvable tenant returns null and selects nothing rather than guessing.
 *
 * These tests are pure — no Sanity client, no network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deriveTenantSlug,
  findKnownInconsistency,
  KNOWN_TENANT_SCOPE_INCONSISTENCIES,
  __resetTenantScopeWarnings,
  type ProjectScopeInput,
} from '../project-scope'

// ─── Fixtures: the five real projects ────────────────────────────────────────

/** Shape of a project as the resolver sees it, post-migration. */
type RealProject = ProjectScopeInput & { _id: string; trueTenantSlug: string }

const livener: RealProject = {
  _id: '088e16f6-0288-47b9-af2b-4ef28f90c6a8',
  projectSlug: 'livener',
  tenantSlug: 'livener',
  clientRef: { tenantSlug: 'livener' },
  trueTenantSlug: 'livener',
}

const studiomartegani: RealProject = {
  _id: '90b7cb26-b192-4e8c-8378-d16c085540fd',
  projectSlug: 'studiomartegani',
  tenantSlug: 'studiomartegani',
  clientRef: { tenantSlug: 'studiomartegani' },
  trueTenantSlug: 'studiomartegani',
}

const abluo: RealProject = {
  _id: '38cf9381-3893-489a-a987-3a2da28f561b',
  projectSlug: 'abluo',
  tenantSlug: 'abluo',
  clientRef: { tenantSlug: 'abluo' },
  trueTenantSlug: 'abluo',
}

/** Draft-only document; still a real project for scoping purposes. */
const amelie: RealProject = {
  _id: 'drafts.28f192d5-f59d-44c5-a738-e10aaeaed041',
  projectSlug: 'amelie',
  tenantSlug: 'amelie',
  clientRef: { tenantSlug: 'amelie' },
  trueTenantSlug: 'amelie',
}

/** The one the whole refactor exists for: slug says "nologo", owner is Freeriders. */
const nologo: RealProject = {
  _id: 'project-nologo',
  projectSlug: 'nologo',
  tenantSlug: 'freeriders',
  clientRef: { tenantSlug: 'freeriders' },
  trueTenantSlug: 'freeriders',
}

const ALL_REAL_PROJECTS = [livener, studiomartegani, abluo, amelie, nologo]

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

// ─── The live dataset ────────────────────────────────────────────────────────

describe('deriveTenantSlug — the five live projects', () => {
  it('resolves every project to its TRUE owner from the stored field', () => {
    for (const p of ALL_REAL_PROJECTS) {
      expect(deriveTenantSlug(p), `project ${p._id}`).toEqual({
        projectSlug: p.projectSlug,
        tenantSlug: p.trueTenantSlug,
        source: 'stored',
      })
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('resolves nologo to freeriders, not to its own slug', () => {
    const scope = deriveTenantSlug(nologo)
    expect(scope?.tenantSlug).toBe('freeriders')
    expect(scope?.tenantSlug).not.toBe(scope?.projectSlug)
  })

  it('leaves the four conventionally-named projects exactly where they were', () => {
    // The migration must be a no-op for these: the tenant the deleted suffix
    // strip used to return, spelled out rather than re-derived, so this pins
    // the before/after equivalence without resurrecting the derivation.
    const unchanged = {
      livener: 'livener',
      studiomartegani: 'studiomartegani',
      abluo: 'abluo',
      amelie: 'amelie',
    } as const
    for (const p of [livener, studiomartegani, abluo, amelie]) {
      expect(deriveTenantSlug(p)?.tenantSlug).toBe(
        unchanged[p.projectSlug as keyof typeof unchanged]
      )
    }
  })
})

// ─── Tier 1: stored project.tenantSlug ───────────────────────────────────────

describe('deriveTenantSlug — tier 1, stored tenantSlug', () => {
  it('prefers a stored tenantSlug over clientRef', () => {
    const scope = deriveTenantSlug({
      projectSlug: 'livener',
      tenantSlug: 'someothertenant',
      clientRef: { tenantSlug: 'livener' },
    })
    expect(scope?.tenantSlug).toBe('someothertenant')
    expect(scope?.source).toBe('stored')
  })

  it('treats an empty or whitespace-only stored value as absent', () => {
    for (const tenantSlug of ['', '   ']) {
      expect(
        deriveTenantSlug({ projectSlug: 'abluo', tenantSlug, clientRef: { tenantSlug: 'abluo' } })
          ?.source
      ).toBe('clientRef')
    }
  })

  it('trims a padded stored value', () => {
    expect(deriveTenantSlug({ projectSlug: 'nologo', tenantSlug: ' freeriders ' })?.tenantSlug)
      .toBe('freeriders')
  })
})

// ─── Tier 2: clientRef->tenantSlug ───────────────────────────────────────────

describe('deriveTenantSlug — tier 2, clientRef', () => {
  it('falls back to the ownership edge for a project the backfill has not reached', () => {
    for (const p of ALL_REAL_PROJECTS) {
      expect(
        deriveTenantSlug({ projectSlug: p.projectSlug, clientRef: p.clientRef }),
        `project ${p._id}`
      ).toEqual({
        projectSlug: p.projectSlug,
        tenantSlug: p.trueTenantSlug,
        source: 'clientRef',
      })
    }
  })

  it('accepts the flattened projection shape ("clientTenantSlug": clientRef->tenantSlug)', () => {
    expect(deriveTenantSlug({ projectSlug: 'nologo', clientTenantSlug: 'freeriders' })).toEqual({
      projectSlug: 'nologo',
      tenantSlug: 'freeriders',
      source: 'clientRef',
    })
  })
})

// ─── The multi-project case the refactor exists for ──────────────────────────

describe('one tenant owning several projects', () => {
  // Freeriders already owns "nologo". The whole point of storing tenancy rather
  // than deriving it from a slug is that the tenant can own a second site whose
  // slug shares nothing with the tenant name.
  const freeridersProjects = [
    { projectSlug: 'nologo', tenantSlug: 'freeriders', clientRef: { tenantSlug: 'freeriders' } },
    { projectSlug: 't42', tenantSlug: 'freeriders', clientRef: { tenantSlug: 'freeriders' } },
  ]

  it('resolves BOTH projects to the same tenant', () => {
    const scopes = freeridersProjects.map((p) => deriveTenantSlug(p))
    expect(scopes.map((s) => s?.tenantSlug)).toEqual(['freeriders', 'freeriders'])
    expect(new Set(scopes.map((s) => s?.tenantSlug)).size).toBe(1)
  })

  it('resolves both the same way through clientRef alone, with no stored field', () => {
    const scopes = freeridersProjects.map((p) =>
      deriveTenantSlug({ projectSlug: p.projectSlug, clientRef: p.clientRef })
    )
    expect(scopes.map((s) => s?.tenantSlug)).toEqual(['freeriders', 'freeriders'])
    expect(scopes.map((s) => s?.source)).toEqual(['clientRef', 'clientRef'])
  })

  it('keeps the two projects distinguishable — same tenant, different project', () => {
    // Tenant-owned content is shared; project-scoped content must not be.
    expect(freeridersProjects.map((p) => deriveTenantSlug(p)?.projectSlug)).toEqual([
      'nologo',
      't42',
    ])
  })

  it('makes one tenant-owned form visible from both of that tenant\'s projects', () => {
    const form = { tenantSlug: 'freeriders' }
    const visible = freeridersProjects.filter(
      (p) => deriveTenantSlug(p)?.tenantSlug === form.tenantSlug
    )
    expect(visible).toHaveLength(2)
  })
})

// ─── No resolvable tenant: select NOTHING ────────────────────────────────────

describe('deriveTenantSlug — a project with no resolvable tenant', () => {
  const orphan = { projectSlug: 'orphan-main' }

  it('returns null rather than guessing "orphan" from the slug', () => {
    // The deleted tier-3 behaviour. `orphan-main` must NOT become `orphan`.
    expect(deriveTenantSlug(orphan)).toBeNull()
  })

  it('returns null for every shape of an unpopulated client link', () => {
    expect(deriveTenantSlug({ projectSlug: 'livener', clientRef: {} })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: 'abluo', clientRef: null })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: 'amelie', clientRef: { tenantSlug: null } })).toBeNull()
    expect(deriveTenantSlug({ projectSlug: 'nologo', tenantSlug: '  ', clientTenantSlug: '' }))
      .toBeNull()
  })

  it('selects NOTHING — no form of any tenant matches a null scope', () => {
    // The property every call site relies on: null means "select nothing",
    // never "select everything".
    const allForms = [
      { _id: 'form-nologo-demo', tenantSlug: 'freeriders' },
      { _id: 'formDefinition-livener-contact', tenantSlug: 'livener' },
      { _id: 'formDefinition-orphan', tenantSlug: 'orphan' },
    ]
    const scope = deriveTenantSlug(orphan)
    expect(scope).toBeNull()
    const selected = scope ? allForms.filter((f) => f.tenantSlug === scope.tenantSlug) : []
    expect(selected).toEqual([])
  })

  it('warns once per slug, naming the project', () => {
    deriveTenantSlug(orphan)
    deriveTenantSlug(orphan)
    deriveTenantSlug(orphan)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warnings()).toContain('orphan-main')
    expect(warnings()).toContain('select NOTHING')

    deriveTenantSlug({ projectSlug: 'second-orphan' })
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

// ─── Absent input ────────────────────────────────────────────────────────────

describe('deriveTenantSlug — no project', () => {
  it('returns null for undefined, null, empty and whitespace-only slugs', () => {
    for (const projectSlug of [undefined, null, '', '   ']) {
      expect(deriveTenantSlug({ projectSlug })).toBeNull()
    }
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

// ─── The legacy derivation is gone ───────────────────────────────────────────

describe('the "-main" suffix strip has been removed', () => {
  it('exports no legacy derivation helper', async () => {
    const mod = await import('../project-scope')
    expect('legacyTenantSlugFromProjectSlug' in mod).toBe(false)
  })

  it('reports only the two remaining tiers as a source', () => {
    const sources = ALL_REAL_PROJECTS.map((p) => deriveTenantSlug(p)?.source)
    expect(sources.every((s) => s === 'stored' || s === 'clientRef')).toBe(true)
    expect(sources).not.toContain('legacy-suffix')
  })
})

// ─── The inconsistency register ──────────────────────────────────────────────

describe('KNOWN_TENANT_SCOPE_INCONSISTENCIES', () => {
  it('is empty — the nologo/freeriders divergence was migrated away', () => {
    expect(KNOWN_TENANT_SCOPE_INCONSISTENCIES).toEqual([])
    expect(findKnownInconsistency('nologo')).toBeUndefined()
  })

  it('is still a real register, so the next divergence has somewhere to land', () => {
    // Type and lookup kept deliberately; only the entry was removed.
    expect(Array.isArray(KNOWN_TENANT_SCOPE_INCONSISTENCIES)).toBe(true)
    expect(typeof findKnownInconsistency).toBe('function')
    expect(findKnownInconsistency('anything')).toBeUndefined()
  })

  it('never changes what deriveTenantSlug returns', () => {
    expect(deriveTenantSlug({ projectSlug: 'nologo', tenantSlug: 'freeriders' })?.tenantSlug)
      .toBe('freeriders')
  })
})
