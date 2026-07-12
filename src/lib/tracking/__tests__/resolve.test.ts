/**
 * Tracking Resolution — Tests
 *
 * Covers `resolveTracking` (src/lib/tracking/resolve.ts), ADR-014 Phase C.
 * This is the runtime bridge from the Integration Registry shape
 * (`project.integrationConfigs` + `project.privacy`) to the flat value set
 * `TrackingScripts.tsx` renders from.
 *
 * Contract under test:
 * - `privacy.trackingKillSwitch === true` blanks every value (`killSwitched: true`).
 * - Absent the kill switch, each value requires its own config entry's
 *   `enabled === true` (strict — undefined/false omit it), matching the
 *   fail-closed convention `filterCustomScripts` already established.
 * - Empty-string / missing values are omitted even when `enabled === true`.
 * - Unknown `integrationId`s are ignored (never surfaced as any known field).
 * - `custom-scripts` entry disabled → empty array, not omitted.
 * - `consentModeEnabled` passes through unchanged for the caller to feed into
 *   `builtInTrackingAllowed`/`consentStateFor` (this module never re-derives it).
 * - Undefined `configs`/`privacy` produce safe, all-empty output — never throws.
 */

import { describe, it, expect } from 'vitest'
import { resolveTracking } from '../resolve'
import type { ProjectIntegrations, ProjectPrivacy } from '@/lib/sanity/types'

type Configs = ProjectIntegrations['integrationConfigs']

const fullConfigs: Configs = [
  { integrationId: 'google-analytics', enabled: true, values: { measurementId: 'G-ABC123' } },
  { integrationId: 'google-tag-manager', enabled: true, values: { containerId: 'GTM-XYZ789' } },
  { integrationId: 'meta-pixel', enabled: true, values: { pixelId: '1234567890' } },
  {
    integrationId: 'custom-scripts',
    enabled: true,
    values: { scripts: [{ code: 'console.log("hi")', enabled: true, placement: 'head' }] },
  },
]

describe('resolveTracking — kill switch', () => {
  it('blanks every value when trackingKillSwitch is true, even with fully enabled configs', () => {
    const privacy: ProjectPrivacy = { trackingKillSwitch: true, consentModeEnabled: false }
    const result = resolveTracking(fullConfigs, privacy)

    expect(result.killSwitched).toBe(true)
    expect(result.ga4MeasurementId).toBeUndefined()
    expect(result.gtmContainerId).toBeUndefined()
    expect(result.metaPixelId).toBeUndefined()
    expect(result.customScripts).toEqual([])
  })

  it('consentModeEnabled still passes through even when kill-switched', () => {
    const result = resolveTracking(fullConfigs, { trackingKillSwitch: true, consentModeEnabled: true })
    expect(result.consentModeEnabled).toBe(true)
  })
})

describe('resolveTracking — per-integration enabled strictness', () => {
  it('resolves all four values when every config entry is enabled === true with values set', () => {
    const result = resolveTracking(fullConfigs, undefined)
    expect(result.killSwitched).toBe(false)
    expect(result.ga4MeasurementId).toBe('G-ABC123')
    expect(result.gtmContainerId).toBe('GTM-XYZ789')
    expect(result.metaPixelId).toBe('1234567890')
    expect(result.customScripts).toHaveLength(1)
  })

  it('omits a value when its config entry enabled is undefined', () => {
    const configs: Configs = [
      { integrationId: 'google-analytics', values: { measurementId: 'G-ABC123' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.ga4MeasurementId).toBeUndefined()
  })

  it('omits a value when its config entry enabled is false', () => {
    const configs: Configs = [
      { integrationId: 'google-tag-manager', enabled: false, values: { containerId: 'GTM-XYZ789' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.gtmContainerId).toBeUndefined()
  })

  it('omits meta pixel when enabled is not strictly true', () => {
    const configs: Configs = [
      { integrationId: 'meta-pixel', enabled: undefined, values: { pixelId: '1234567890' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.metaPixelId).toBeUndefined()
  })
})

describe('resolveTracking — empty-string / missing values', () => {
  it('omits ga4MeasurementId when enabled but the value is an empty string', () => {
    const configs: Configs = [
      { integrationId: 'google-analytics', enabled: true, values: { measurementId: '' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.ga4MeasurementId).toBeUndefined()
  })

  it('omits gtmContainerId when enabled but values.containerId is missing', () => {
    const configs: Configs = [{ integrationId: 'google-tag-manager', enabled: true, values: {} }]
    const result = resolveTracking(configs, undefined)
    expect(result.gtmContainerId).toBeUndefined()
  })

  it('omits a value when enabled but the value is a non-string type', () => {
    const configs: Configs = [
      { integrationId: 'meta-pixel', enabled: true, values: { pixelId: 1234567890 as unknown as string } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.metaPixelId).toBeUndefined()
  })
})

describe('resolveTracking — unknown integrationId', () => {
  it('ignores unknown integrationIds entirely', () => {
    const configs: Configs = [
      { integrationId: 'some-future-integration', enabled: true, values: { anything: 'value' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.ga4MeasurementId).toBeUndefined()
    expect(result.gtmContainerId).toBeUndefined()
    expect(result.metaPixelId).toBeUndefined()
    expect(result.customScripts).toEqual([])
  })
})

describe('resolveTracking — custom scripts', () => {
  it('returns an empty array (not undefined) when the custom-scripts entry is disabled', () => {
    const configs: Configs = [
      {
        integrationId: 'custom-scripts',
        enabled: false,
        values: { scripts: [{ code: 'x', enabled: true }] },
      },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.customScripts).toEqual([])
  })

  it('returns an empty array when there is no custom-scripts entry at all', () => {
    const result = resolveTracking([], undefined)
    expect(result.customScripts).toEqual([])
  })

  it('returns an empty array when scripts value is not an array', () => {
    const configs: Configs = [
      { integrationId: 'custom-scripts', enabled: true, values: { scripts: 'not-an-array' } },
    ]
    const result = resolveTracking(configs, undefined)
    expect(result.customScripts).toEqual([])
  })
})

describe('resolveTracking — consentModeEnabled passthrough', () => {
  it('passes through true unchanged', () => {
    const result = resolveTracking(undefined, { consentModeEnabled: true })
    expect(result.consentModeEnabled).toBe(true)
  })

  it('passes through false/undefined as false', () => {
    expect(resolveTracking(undefined, { consentModeEnabled: false }).consentModeEnabled).toBe(false)
    expect(resolveTracking(undefined, undefined).consentModeEnabled).toBe(false)
  })
})

describe('resolveTracking — safe empties', () => {
  it('handles undefined configs and undefined privacy without throwing', () => {
    const result = resolveTracking(undefined, undefined)
    expect(result).toEqual({
      killSwitched: false,
      consentModeEnabled: false,
      ga4MeasurementId: undefined,
      gtmContainerId: undefined,
      metaPixelId: undefined,
      customScripts: [],
    })
  })

  it('handles an empty configs array', () => {
    const result = resolveTracking([], {})
    expect(result.killSwitched).toBe(false)
    expect(result.customScripts).toEqual([])
  })
})
