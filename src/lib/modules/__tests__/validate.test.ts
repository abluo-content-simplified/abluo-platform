import { describe, it, expect } from 'vitest'
import { validateRegistry } from '../validate'
import type { ModuleManifest } from '../types'

// ── Test helper ───────────────────────────────────────────────────────────────
// Returns a minimal valid ModuleManifest. Every field satisfies all nine rules.
// The id is used to derive unique sectionType and schemaType values so that
// two makeManifest() calls with different ids do not conflict on Rules 6 or 7.

function makeManifest(id = 'test-module'): ModuleManifest {
  return {
    id,
    label: 'Test Module',
    version: '1.0.0',
    status: 'released',
    platformContract: {
      pageType: 'testPage',
      collectionItems: () => [],
      sectionTypes: [`${id}-section`],
      schemaTypes: [`${id}-doc`],
      permissions: [],
    },
    publicContract: {},
    dependencies: {
      requires: [],
      integratesWith: [],
    },
    dataStore: { primary: 'content' },
    changelog: 'V1.0.0 — test fixture',
  }
}

// ── General ───────────────────────────────────────────────────────────────────

describe('validateRegistry — general', () => {
  it('passes an empty registry without throwing', () => {
    expect(() => validateRegistry([])).not.toThrow()
  })

  it('passes a single valid manifest', () => {
    expect(() => validateRegistry([makeManifest()])).not.toThrow()
  })

  it('passes multiple valid manifests', () => {
    expect(() => validateRegistry([makeManifest('alpha'), makeManifest('beta')])).not.toThrow()
  })

  it('collects all errors before throwing — does not stop at first failure', () => {
    const m = makeManifest()
    m.version = 'not-semver'
    ;(m as unknown as { status: string }).status = 'invalid-status'
    ;(m.dataStore as unknown as { primary: string }).primary = 'cloud'

    try {
      validateRegistry([m])
      expect.fail('expected validateRegistry to throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toMatch(/Rule 3/)
      expect(msg).toMatch(/Rule 4/)
      expect(msg).toMatch(/Rule 9/)
      expect(msg).toContain('3 errors')
    }
  })

  it('error message includes the module id as a diagnostic prefix', () => {
    const m = makeManifest('my-module')
    m.version = 'bad'
    expect(() => validateRegistry([m])).toThrow(/\[my-module\]/)
  })
})

// ── Rule 1 — unique IDs ───────────────────────────────────────────────────────

describe('Rule 1 — unique IDs', () => {
  it('passes when all module IDs are distinct', () => {
    expect(() =>
      validateRegistry([makeManifest('alpha'), makeManifest('beta'), makeManifest('gamma')])
    ).not.toThrow()
  })

  it('fails when two manifests share the same id', () => {
    expect(() =>
      validateRegistry([makeManifest('dup'), makeManifest('dup')])
    ).toThrow(/Rule 1/)
  })

  it('error message names the duplicate id', () => {
    expect(() =>
      validateRegistry([makeManifest('dup'), makeManifest('dup')])
    ).toThrow(/"dup"/)
  })
})

// ── Rule 2 — lowercase kebab-case ID ─────────────────────────────────────────

describe('Rule 2 — lowercase kebab-case ID', () => {
  it('passes for a valid single-word id', () => {
    const m = makeManifest('blog')
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('passes for a valid hyphenated id', () => {
    const m = makeManifest('my-module-v2')
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails for an id with uppercase letters', () => {
    const m = makeManifest()
    m.id = 'MyModule'
    expect(() => validateRegistry([m])).toThrow(/Rule 2/)
  })

  it('fails for an id with spaces', () => {
    const m = makeManifest()
    m.id = 'my module'
    expect(() => validateRegistry([m])).toThrow(/Rule 2/)
  })

  it('fails for an id that starts with a hyphen', () => {
    const m = makeManifest()
    m.id = '-module'
    expect(() => validateRegistry([m])).toThrow(/Rule 2/)
  })
})

// ── Rule 3 — valid semver ─────────────────────────────────────────────────────

describe('Rule 3 — valid semver', () => {
  it('passes for a standard MAJOR.MINOR.PATCH version', () => {
    const m = makeManifest()
    m.version = '2.14.0'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('passes for a pre-release semver string', () => {
    const m = makeManifest()
    m.version = '1.0.0-alpha.1'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails for a two-part version', () => {
    const m = makeManifest()
    m.version = '1.0'
    expect(() => validateRegistry([m])).toThrow(/Rule 3/)
  })

  it('fails for a version with a "v" prefix', () => {
    const m = makeManifest()
    m.version = 'v1.0.0'
    expect(() => validateRegistry([m])).toThrow(/Rule 3/)
  })

  it('fails for a non-numeric version string', () => {
    const m = makeManifest()
    m.version = 'latest'
    expect(() => validateRegistry([m])).toThrow(/Rule 3/)
  })
})

// ── Rule 4 — valid status ─────────────────────────────────────────────────────

describe('Rule 4 — valid status', () => {
  it('passes for status "released"', () => {
    expect(() => validateRegistry([makeManifest()])).not.toThrow()
  })

  it('passes for status "deprecated"', () => {
    const m = makeManifest()
    m.status = 'deprecated'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('passes for status "archived"', () => {
    const m = makeManifest()
    m.status = 'archived'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails for an unrecognised status value', () => {
    const m = makeManifest()
    ;(m as unknown as { status: string }).status = 'active'
    expect(() => validateRegistry([m])).toThrow(/Rule 4/)
  })

  it('error message names the invalid status value', () => {
    const m = makeManifest()
    ;(m as unknown as { status: string }).status = 'beta'
    expect(() => validateRegistry([m])).toThrow(/"beta"/)
  })
})

// ── Rule 5 — pageType non-empty if set ───────────────────────────────────────

describe('Rule 5 — pageType non-empty if set', () => {
  it('passes when pageType is a non-empty string', () => {
    const m = makeManifest()
    m.platformContract.pageType = 'blogPage'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('passes when pageType is omitted entirely', () => {
    const m = makeManifest()
    delete m.platformContract.pageType
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails when pageType is an empty string', () => {
    const m = makeManifest()
    m.platformContract.pageType = ''
    expect(() => validateRegistry([m])).toThrow(/Rule 5/)
  })

  it('fails when pageType is only whitespace', () => {
    const m = makeManifest()
    m.platformContract.pageType = '   '
    expect(() => validateRegistry([m])).toThrow(/Rule 5/)
  })
})

// ── Rule 6 — sectionTypes unique across registry ──────────────────────────────

describe('Rule 6 — sectionTypes unique across registry', () => {
  it('passes when sectionTypes are distinct across modules', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    expect(() => validateRegistry([a, b])).not.toThrow()
  })

  it('passes when a module declares no sectionTypes', () => {
    const m = makeManifest()
    m.platformContract.sectionTypes = []
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails when two modules declare the same sectionType', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    b.platformContract.sectionTypes = ['alpha-section'] // conflicts with alpha
    expect(() => validateRegistry([a, b])).toThrow(/Rule 6/)
  })

  it('error message names both modules that own the conflicting sectionType', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    b.platformContract.sectionTypes = ['alpha-section']
    expect(() => validateRegistry([a, b])).toThrow(/"alpha"/)
    expect(() => validateRegistry([a, b])).toThrow(/"beta"/)
  })
})

// ── Rule 7 — schemaTypes unique across registry ───────────────────────────────

describe('Rule 7 — schemaTypes unique across registry', () => {
  it('passes when schemaTypes are distinct across modules', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    expect(() => validateRegistry([a, b])).not.toThrow()
  })

  it('fails when two modules declare the same schemaType', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    b.platformContract.schemaTypes = ['alpha-doc'] // conflicts with alpha
    expect(() => validateRegistry([a, b])).toThrow(/Rule 7/)
  })

  it('error message names both modules that own the conflicting schemaType', () => {
    const a = makeManifest('alpha')
    const b = makeManifest('beta')
    b.platformContract.schemaTypes = ['alpha-doc']
    expect(() => validateRegistry([a, b])).toThrow(/"alpha"/)
    expect(() => validateRegistry([a, b])).toThrow(/"beta"/)
  })
})

// ── Rule 8 — requires references valid registry IDs ───────────────────────────

describe('Rule 8 — requires references valid registry IDs', () => {
  it('passes when requires is empty', () => {
    expect(() => validateRegistry([makeManifest()])).not.toThrow()
  })

  it('passes when requires references a module that exists in the registry', () => {
    const dep = makeManifest('events')
    const consumer = makeManifest('blog')
    consumer.dependencies.requires = [{ moduleId: 'events', reason: 'needs events' }]
    expect(() => validateRegistry([dep, consumer])).not.toThrow()
  })

  it('fails when requires references a module id not in the registry', () => {
    const m = makeManifest('blog')
    m.dependencies.requires = [{ moduleId: 'crm', reason: 'needs crm' }]
    expect(() => validateRegistry([m])).toThrow(/Rule 8/)
  })

  it('error message names the unknown dependency id', () => {
    const m = makeManifest('blog')
    m.dependencies.requires = [{ moduleId: 'crm', reason: 'needs crm' }]
    expect(() => validateRegistry([m])).toThrow(/"crm"/)
  })
})

// ── Rule 9 — valid dataStore.primary ─────────────────────────────────────────

describe('Rule 9 — valid dataStore.primary', () => {
  it('passes for primary "content"', () => {
    expect(() => validateRegistry([makeManifest()])).not.toThrow()
  })

  it('passes for primary "operational"', () => {
    const m = makeManifest()
    m.dataStore.primary = 'operational'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('passes for primary "hybrid"', () => {
    const m = makeManifest()
    m.dataStore.primary = 'hybrid'
    expect(() => validateRegistry([m])).not.toThrow()
  })

  it('fails for an unrecognised primary value', () => {
    const m = makeManifest()
    ;(m.dataStore as unknown as { primary: string }).primary = 'database'
    expect(() => validateRegistry([m])).toThrow(/Rule 9/)
  })

  it('error message names the invalid primary value', () => {
    const m = makeManifest()
    ;(m.dataStore as unknown as { primary: string }).primary = 'cloud'
    expect(() => validateRegistry([m])).toThrow(/"cloud"/)
  })
})

// ── Live MODULE_REGISTRY ──────────────────────────────────────────────────────
// Explicit confirmation that the production registry passes all nine rules.
// Note: importing registry.ts also runs validateRegistry as a side effect —
// this test makes the passing check visible and documents the intent.

describe('live MODULE_REGISTRY', () => {
  it('passes all nine rules without throwing', async () => {
    const { MODULE_REGISTRY } = await import('../registry')
    expect(() => validateRegistry(MODULE_REGISTRY)).not.toThrow()
  })
})
