// ── status.test.ts ────────────────────────────────────────────────────────────
// ADR-014 Phase B, slice 2. Tests getIntegrationStatus() in ../status.ts.
// Static imports throughout (no dynamic import) — matches the I9 convention
// established in validate.test.ts/schema.test.ts.

import { describe, it, expect } from 'vitest'
import { getIntegrationStatus } from '../status'
import type { IntegrationManifest, IntegrationConfig } from '../types'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const analyticsManifest: IntegrationManifest = {
  id: 'google-analytics',
  label: 'Google Analytics (GA4)',
  version: '1.0.0',
  status: 'released',
  category: 'analytics',
  consentCategory: 'analytics',
  storage: 'content',
  fields: [
    {
      id: 'measurementId',
      label: 'Measurement ID',
      type: 'string',
      required: true,
      secret: false,
      description: 'GA4 Measurement ID.',
    },
  ],
}

const necessaryManifest: IntegrationManifest = {
  id: 'custom-scripts',
  label: 'Custom Scripts',
  version: '1.0.0',
  status: 'released',
  category: 'developers',
  consentCategory: 'necessary',
  storage: 'content',
  fields: [
    {
      id: 'scripts',
      label: 'Scripts',
      type: 'customScriptArray',
      required: false,
      secret: false,
      description: 'Scripts.',
    },
  ],
}

const noRequiredFieldsManifest: IntegrationManifest = {
  id: 'no-required-fields',
  label: 'No Required Fields',
  version: '1.0.0',
  status: 'released',
  category: 'marketing',
  consentCategory: 'marketing',
  storage: 'content',
  fields: [
    {
      id: 'optionalNote',
      label: 'Optional Note',
      type: 'string',
      required: false,
      secret: false,
      description: 'Not required.',
    },
  ],
}

function config(overrides: Partial<IntegrationConfig>): IntegrationConfig {
  return {
    integrationId: 'google-analytics',
    enabled: false,
    values: {},
    ...overrides,
  }
}

// ── status derivation ─────────────────────────────────────────────────────────

describe('getIntegrationStatus — status derivation', () => {
  it('returns not-configured when config is undefined', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, undefined)
    expect(result.status).toBe('not-configured')
  })

  it('returns not-configured when config exists but the required field is missing', () => {
    const result = getIntegrationStatus(analyticsManifest, config({ values: {} }), undefined)
    expect(result.status).toBe('not-configured')
  })

  it('returns not-configured when the required field is present but empty string', () => {
    const result = getIntegrationStatus(
      analyticsManifest,
      config({ values: { measurementId: '' } }),
      undefined
    )
    expect(result.status).toBe('not-configured')
  })

  it('returns not-configured when the required field is present but enabled is true (configuration precedes enablement)', () => {
    const result = getIntegrationStatus(
      analyticsManifest,
      config({ enabled: true, values: {} }),
      undefined
    )
    expect(result.status).toBe('not-configured')
  })

  it('returns disabled when fully configured but enabled is false', () => {
    const result = getIntegrationStatus(
      analyticsManifest,
      config({ enabled: false, values: { measurementId: 'G-ABC1234' } }),
      undefined
    )
    expect(result.status).toBe('disabled')
  })

  it('returns disabled when fully configured and enabled is undefined (not === true)', () => {
    const configWithoutEnabled: Partial<IntegrationConfig> = {
      integrationId: 'google-analytics',
      values: { measurementId: 'G-ABC1234' },
    }
    const result = getIntegrationStatus(
      analyticsManifest,
      configWithoutEnabled as IntegrationConfig,
      undefined
    )
    expect(result.status).toBe('disabled')
  })

  it('returns enabled when fully configured and enabled is true', () => {
    const result = getIntegrationStatus(
      analyticsManifest,
      config({ enabled: true, values: { measurementId: 'G-ABC1234' } }),
      undefined
    )
    expect(result.status).toBe('enabled')
  })

  it('treats a manifest with no required fields as configured as soon as a config entry exists', () => {
    const result = getIntegrationStatus(
      noRequiredFieldsManifest,
      { integrationId: 'no-required-fields', enabled: true, values: {} },
      undefined
    )
    expect(result.status).toBe('enabled')
  })
})

// ── consentGated ───────────────────────────────────────────────────────────────

describe('getIntegrationStatus — consentGated', () => {
  it('is false when privacy is undefined', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, undefined)
    expect(result.consentGated).toBe(false)
  })

  it('is false when consentModeEnabled is false', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, { consentModeEnabled: false })
    expect(result.consentGated).toBe(false)
  })

  it('is true when consentModeEnabled is true and consentCategory is analytics', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, { consentModeEnabled: true })
    expect(result.consentGated).toBe(true)
  })

  it('is true when consentModeEnabled is true and consentCategory is marketing', () => {
    const result = getIntegrationStatus(noRequiredFieldsManifest, undefined, {
      consentModeEnabled: true,
    })
    expect(result.consentGated).toBe(true)
  })

  it('is false when consentModeEnabled is true but consentCategory is necessary', () => {
    const result = getIntegrationStatus(necessaryManifest, undefined, { consentModeEnabled: true })
    expect(result.consentGated).toBe(false)
  })
})

// ── killSwitched ───────────────────────────────────────────────────────────────

describe('getIntegrationStatus — killSwitched', () => {
  it('is false when privacy is undefined', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, undefined)
    expect(result.killSwitched).toBe(false)
  })

  it('is false when trackingKillSwitch is false', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, { trackingKillSwitch: false })
    expect(result.killSwitched).toBe(false)
  })

  it('is true when trackingKillSwitch is true', () => {
    const result = getIntegrationStatus(analyticsManifest, undefined, { trackingKillSwitch: true })
    expect(result.killSwitched).toBe(true)
  })

  it('is independent of status — enabled + killSwitched can both be true', () => {
    const result = getIntegrationStatus(
      analyticsManifest,
      config({ enabled: true, values: { measurementId: 'G-ABC1234' } }),
      { trackingKillSwitch: true }
    )
    expect(result.status).toBe('enabled')
    expect(result.killSwitched).toBe(true)
  })
})
