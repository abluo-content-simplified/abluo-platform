// ── validate.test.ts ──────────────────────────────────────────────────────────
// ADR-014 Phase A. Mirrors src/lib/modules/__tests__/validate.test.ts's helper
// and assertion style.
//
// CAUTION (I9): modules/__tests__/validate.test.ts's live-MODULE_REGISTRY test
// uses a dynamic `await import('../registry')`, which is a known flake source.
// This file uses a STATIC import of INTEGRATION_REGISTRY throughout, including
// for the "live registry passes" test, to avoid the same trap.

import { describe, it, expect } from 'vitest'
import { validateIntegrationRegistry } from '../validate'
import { INTEGRATION_REGISTRY } from '../registry'
import type { IntegrationManifest } from '../types'

// ── Test helper ───────────────────────────────────────────────────────────────
// Minimal valid manifest satisfying all twelve rules. id is used to derive a
// field id so two makeManifest() calls with different ids never collide on
// field-uniqueness checks (which are scoped per-manifest, not cross-registry).

function makeManifest(id = 'test-integration'): IntegrationManifest {
  return {
    id,
    label: 'Test Integration',
    version: '1.0.0',
    status: 'released',
    category: 'analytics',
    consentCategory: 'analytics',
    storage: 'content',
    fields: [
      {
        id: 'apiKey',
        label: 'API Key',
        type: 'string',
        required: true,
        secret: false,
        description: 'Test field.',
      },
    ],
  }
}

// ── General ───────────────────────────────────────────────────────────────────

describe('validateIntegrationRegistry — general', () => {
  it('passes an empty registry without throwing', () => {
    expect(() => validateIntegrationRegistry([])).not.toThrow()
  })

  it('passes a single valid manifest', () => {
    expect(() => validateIntegrationRegistry([makeManifest()])).not.toThrow()
  })

  it('passes multiple valid manifests', () => {
    expect(() =>
      validateIntegrationRegistry([makeManifest('alpha'), makeManifest('beta')])
    ).not.toThrow()
  })

  it('collects all errors before throwing — does not stop at first failure', () => {
    const m = makeManifest()
    ;(m as unknown as { category: string }).category = 'invalid-category'
    ;(m as unknown as { status: string }).status = 'invalid-status'
    m.label = ''

    try {
      validateIntegrationRegistry([m])
      expect.fail('expected validateIntegrationRegistry to throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toMatch(/Rule 3/)
      expect(msg).toMatch(/Rule 5/)
      expect(msg).toMatch(/Rule 6/)
      expect(msg).toContain('3 errors')
    }
  })

  it('error message includes the integration id as a diagnostic prefix', () => {
    const m = makeManifest('my-integration')
    m.label = ''
    expect(() => validateIntegrationRegistry([m])).toThrow(/\[my-integration\]/)
  })
})

// ── Rule 1 — unique IDs ───────────────────────────────────────────────────────

describe('Rule 1 — unique IDs', () => {
  it('passes when all ids are distinct', () => {
    expect(() =>
      validateIntegrationRegistry([makeManifest('alpha'), makeManifest('beta')])
    ).not.toThrow()
  })

  it('fails when two manifests share the same id', () => {
    expect(() =>
      validateIntegrationRegistry([makeManifest('dup'), makeManifest('dup')])
    ).toThrow(/Rule 1/)
  })
})

// ── Rule 2 — lowercase kebab-case ID ─────────────────────────────────────────

describe('Rule 2 — lowercase kebab-case ID', () => {
  it('passes for a valid hyphenated id', () => {
    expect(() => validateIntegrationRegistry([makeManifest('my-integration-v2')])).not.toThrow()
  })

  it('fails for an id with uppercase letters', () => {
    const m = makeManifest()
    m.id = 'MyIntegration'
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 2/)
  })

  it('fails for an id with spaces', () => {
    const m = makeManifest()
    m.id = 'my integration'
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 2/)
  })
})

// ── Rule 3 — valid category ──────────────────────────────────────────────────

describe('Rule 3 — valid category (negative case)', () => {
  it('fails for an unrecognised category value', () => {
    const m = makeManifest()
    ;(m as unknown as { category: string }).category = 'unknown-category'
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 3/)
  })

  it('passes for every valid category', () => {
    for (const category of ['analytics', 'marketing', 'forms', 'ai', 'payments', 'developers'] as const) {
      const m = makeManifest()
      m.category = category
      expect(() => validateIntegrationRegistry([m])).not.toThrow()
    }
  })
})

// ── Rule 4 — valid consentCategory ───────────────────────────────────────────

describe('Rule 4 — valid consentCategory', () => {
  it('fails for an unrecognised consentCategory value', () => {
    const m = makeManifest()
    ;(m as unknown as { consentCategory: string }).consentCategory = 'invalid'
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 4/)
  })

  it('passes for every valid consentCategory', () => {
    for (const consentCategory of ['necessary', 'analytics', 'marketing', 'functional'] as const) {
      const m = makeManifest()
      m.consentCategory = consentCategory
      expect(() => validateIntegrationRegistry([m])).not.toThrow()
    }
  })
})

// ── Rule 5 — valid status ────────────────────────────────────────────────────

describe('Rule 5 — valid status', () => {
  it('passes for released, beta, and deprecated', () => {
    for (const status of ['released', 'beta', 'deprecated'] as const) {
      const m = makeManifest()
      m.status = status
      expect(() => validateIntegrationRegistry([m])).not.toThrow()
    }
  })

  it('fails for an unrecognised status value', () => {
    const m = makeManifest()
    ;(m as unknown as { status: string }).status = 'archived'
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 5/)
  })
})

// ── Rule 6 — non-empty label ─────────────────────────────────────────────────

describe('Rule 6 — non-empty label', () => {
  it('fails when label is empty', () => {
    const m = makeManifest()
    m.label = ''
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 6/)
  })

  it('fails when label is whitespace-only', () => {
    const m = makeManifest()
    m.label = '   '
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 6/)
  })
})

// ── Rule 7 — non-empty version ───────────────────────────────────────────────

describe('Rule 7 — non-empty version', () => {
  it('fails when version is empty', () => {
    const m = makeManifest()
    m.version = ''
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 7/)
  })
})

// ── Rule 8 — fields non-empty ────────────────────────────────────────────────

describe('Rule 8 — fields non-empty', () => {
  it('fails when fields is an empty array', () => {
    const m = makeManifest()
    m.fields = []
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 8/)
  })
})

// ── Rule 9 — field ids non-empty and unique ──────────────────────────────────

describe('Rule 9 — field ids non-empty and unique', () => {
  it('fails when a field has an empty id', () => {
    const m = makeManifest()
    m.fields = [{ id: '', label: 'X', type: 'string', required: false, secret: false, description: 'x' }]
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 9/)
  })

  it('fails when two fields share the same id', () => {
    const m = makeManifest()
    m.fields = [
      { id: 'dup', label: 'X', type: 'string', required: false, secret: false, description: 'x' },
      { id: 'dup', label: 'Y', type: 'string', required: false, secret: false, description: 'y' },
    ]
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 9/)
  })
})

// ── Rule 10 — regex compiles ─────────────────────────────────────────────────

describe('Rule 10 — regex compiles', () => {
  it('passes when validation.regex is a valid pattern', () => {
    const m = makeManifest()
    m.fields = [
      {
        id: 'measurementId',
        label: 'ID',
        type: 'string',
        required: true,
        secret: false,
        description: 'x',
        validation: { regex: '^G-[A-Z0-9]+$', message: 'bad format' },
      },
    ]
    expect(() => validateIntegrationRegistry([m])).not.toThrow()
  })

  it('fails when validation.regex does not compile', () => {
    const m = makeManifest()
    m.fields = [
      {
        id: 'measurementId',
        label: 'ID',
        type: 'string',
        required: true,
        secret: false,
        description: 'x',
        validation: { regex: '(unterminated', message: 'bad format' },
      },
    ]
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 10/)
  })
})

// ── Rule 11 — secret fields must not be boolean ──────────────────────────────

describe('Rule 11 — secret fields must not be boolean', () => {
  it('fails when a secret field has type "boolean"', () => {
    const m = makeManifest()
    m.fields = [
      { id: 'flag', label: 'Flag', type: 'boolean', required: false, secret: true, description: 'x' },
    ]
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 11/)
  })

  it('passes when a secret field has type "string"', () => {
    const m = makeManifest()
    m.fields = [
      { id: 'apiKey', label: 'Key', type: 'string', required: false, secret: true, description: 'x' },
    ]
    expect(() => validateIntegrationRegistry([m])).not.toThrow()
  })

  it('passes when a non-secret field has type "boolean"', () => {
    const m = makeManifest()
    m.fields = [
      { id: 'flag', label: 'Flag', type: 'boolean', required: false, secret: false, description: 'x' },
    ]
    expect(() => validateIntegrationRegistry([m])).not.toThrow()
  })
})

// ── Rule 12 — renderContract.component non-empty when present ───────────────

describe('Rule 12 — renderContract.component non-empty when present', () => {
  it('passes when renderContract is omitted', () => {
    const m = makeManifest()
    expect(() => validateIntegrationRegistry([m])).not.toThrow()
  })

  it('passes when renderContract.component is set', () => {
    const m = makeManifest()
    m.renderContract = { component: 'TrackingScripts' }
    expect(() => validateIntegrationRegistry([m])).not.toThrow()
  })

  it('fails when renderContract is set but component is empty', () => {
    const m = makeManifest()
    m.renderContract = { component: '' }
    expect(() => validateIntegrationRegistry([m])).toThrow(/Rule 12/)
  })
})

// ── Live INTEGRATION_REGISTRY ─────────────────────────────────────────────────
// Explicit confirmation that the production registry passes all structural
// rules. Static import (see file-level CAUTION note) — importing registry.ts
// also runs validateIntegrationRegistry as a side effect; this test makes the
// passing check visible and documents the intent, without the dynamic-import
// flake pattern.

describe('live INTEGRATION_REGISTRY', () => {
  it('passes all structural rules without throwing', () => {
    expect(() => validateIntegrationRegistry(INTEGRATION_REGISTRY)).not.toThrow()
  })
})
