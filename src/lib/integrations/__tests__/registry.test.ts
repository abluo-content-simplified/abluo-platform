// ── registry.test.ts ──────────────────────────────────────────────────────────
// ADR-014 Phase A. Static import only — importing registry.ts also runs
// validateIntegrationRegistry as a side effect (module-load-time validation,
// same as MODULE_REGISTRY). A static import here avoids the dynamic-import
// flake (I9) that affects the two pre-existing module-registry tests.

import { describe, it, expect } from 'vitest'
import { INTEGRATION_REGISTRY, INTEGRATION_CATEGORIES } from '../registry'

describe('INTEGRATION_REGISTRY', () => {
  it('contains exactly the four Phase A manifests', () => {
    expect(INTEGRATION_REGISTRY).toHaveLength(4)
    const ids = INTEGRATION_REGISTRY.map((m) => m.id)
    expect(ids).toEqual(['google-analytics', 'google-tag-manager', 'meta-pixel', 'custom-scripts'])
  })

  it('google-analytics has category analytics and consentCategory analytics', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'google-analytics')
    expect(m?.category).toBe('analytics')
    expect(m?.consentCategory).toBe('analytics')
  })

  it('google-tag-manager has category analytics and consentCategory analytics', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'google-tag-manager')
    expect(m?.category).toBe('analytics')
    expect(m?.consentCategory).toBe('analytics')
  })

  it('meta-pixel has category analytics and consentCategory marketing', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'meta-pixel')
    expect(m?.category).toBe('analytics')
    expect(m?.consentCategory).toBe('marketing')
  })

  it('custom-scripts has category developers and consentCategory necessary', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'custom-scripts')
    expect(m?.category).toBe('developers')
    expect(m?.consentCategory).toBe('necessary')
  })

  it('every manifest has status "released" in Phase A', () => {
    for (const m of INTEGRATION_REGISTRY) {
      expect(m.status).toBe('released')
    }
  })

  it('every manifest declares storage "content" in Phase A', () => {
    for (const m of INTEGRATION_REGISTRY) {
      expect(m.storage).toBe('content')
    }
  })

  it('the three analytics integrations declare renderContract.component "TrackingScripts"', () => {
    for (const id of ['google-analytics', 'google-tag-manager', 'meta-pixel']) {
      const m = INTEGRATION_REGISTRY.find((x) => x.id === id)
      expect(m?.renderContract).toEqual({ component: 'TrackingScripts' })
    }
  })

  it('custom-scripts has no renderContract (Phase C wires TrackingScripts consumption)', () => {
    const m = INTEGRATION_REGISTRY.find((x) => x.id === 'custom-scripts')
    expect(m?.renderContract).toBeUndefined()
  })
})

describe('INTEGRATION_CATEGORIES', () => {
  it('declares all six categories in ADR-014 IA order', () => {
    expect(INTEGRATION_CATEGORIES.map((c) => c.id)).toEqual([
      'analytics',
      'marketing',
      'forms',
      'ai',
      'payments',
      'developers',
    ])
  })

  it('every category has a non-empty label', () => {
    for (const c of INTEGRATION_CATEGORIES) {
      expect(c.label.trim().length).toBeGreaterThan(0)
    }
  })
})
