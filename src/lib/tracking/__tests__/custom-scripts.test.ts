/**
 * Custom Script Filtering — Tests
 *
 * Covers `filterCustomScripts`, `consentStateFor`, and
 * `builtInTrackingAllowed` (src/lib/tracking/custom-scripts.ts):
 * - Round 2 hardening: `enabled` now defaults to `false` in the schema —
 *   undefined/false must both exclude a script (fail-closed).
 *   `consentCategory` (`analytics` | `marketing`) gates rendering once a
 *   `ConsentState` is supplied; with no `ConsentState`, gating is a no-op
 *   (interim behavior — no consent mechanism ships yet).
 * - Round 3: `consentStateFor` derives the `ConsentState` passed into
 *   `filterCustomScripts` from `siteConfig.integrations.consentModeEnabled`.
 *   The component-level `analyticsEnabled` master gate in
 *   `TrackingScripts.tsx` is plain JSX with no prior component-test
 *   precedent in this suite — it is covered by manual code read, not a
 *   render test (see Round 3 handoff §6).
 * - Round 4: `ConsentState` extended with `functional`, gated identically to
 *   `analytics`/`marketing` — no consent rules currently permit functional
 *   scripts to load pre-consent. `consentStateFor(true)` now fails closed on
 *   all three gated categories. `builtInTrackingAllowed` gates GA4/GTM/Meta
 *   Pixel: blocked whenever `consentModeEnabled === true` (no valid consent
 *   exists yet), allowed otherwise. `necessary` remains ungated throughout —
 *   it is Abluo-admin-approved by construction.
 */

import { describe, it, expect } from 'vitest'
import {
  filterCustomScripts,
  consentStateFor,
  builtInTrackingAllowed,
  type ConsentState,
} from '../custom-scripts'
import type { CustomScript } from '@/lib/sanity/types'

const base: CustomScript = {
  code: 'console.log("hi")',
  enabled: true,
}

describe('filterCustomScripts', () => {
  it('excludes a script when enabled is undefined', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: undefined }]
    expect(filterCustomScripts(scripts, 'head')).toEqual([])
  })

  it('excludes a script when enabled is false', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: false }]
    expect(filterCustomScripts(scripts, 'head')).toEqual([])
  })

  it('includes a script when enabled is true and placement matches', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, placement: 'head' }]
    expect(filterCustomScripts(scripts, 'head')).toEqual(scripts)
  })

  it('excludes a script with no code even if enabled', () => {
    const scripts: CustomScript[] = [{ ...base, code: undefined, enabled: true }]
    expect(filterCustomScripts(scripts, 'head')).toEqual([])
  })

  it('excludes a script with empty-string code', () => {
    const scripts: CustomScript[] = [{ ...base, code: '', enabled: true }]
    expect(filterCustomScripts(scripts, 'head')).toEqual([])
  })

  it('defaults placement to head when unset', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, placement: undefined }]
    expect(filterCustomScripts(scripts, 'head')).toEqual(scripts)
    expect(filterCustomScripts(scripts, 'bodyEnd')).toEqual([])
  })

  it('filters correctly for bodyEnd placement', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, placement: 'bodyEnd' }]
    expect(filterCustomScripts(scripts, 'bodyEnd')).toEqual(scripts)
    expect(filterCustomScripts(scripts, 'head')).toEqual([])
  })

  it('blocks an analytics script when consent.analytics is false', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'analytics' }]
    const consent: ConsentState = { analytics: false, marketing: true, functional: true }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual([])
  })

  it('allows an analytics script when consent.analytics is true', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'analytics' }]
    const consent: ConsentState = { analytics: true, marketing: false, functional: false }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual(scripts)
  })

  it('blocks a marketing script when consent.marketing is false', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'marketing' }]
    const consent: ConsentState = { analytics: true, marketing: false, functional: true }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual([])
  })

  it('allows a marketing script when consent.marketing is true', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'marketing' }]
    const consent: ConsentState = { analytics: false, marketing: true, functional: false }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual(scripts)
  })

  it('blocks a functional script when consent.functional is false', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'functional' }]
    const consent: ConsentState = { analytics: true, marketing: true, functional: false }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual([])
  })

  it('allows a functional script when consent.functional is true', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'functional' }]
    const consent: ConsentState = { analytics: false, marketing: false, functional: true }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual(scripts)
  })

  it('does not gate necessary-category scripts on consent, even under a full-block state', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: 'necessary' }]
    const consent: ConsentState = { analytics: false, marketing: false, functional: false }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual(scripts)
  })

  it('does not gate scripts with an undefined consentCategory', () => {
    const scripts: CustomScript[] = [{ ...base, enabled: true, consentCategory: undefined }]
    const consent: ConsentState = { analytics: false, marketing: false, functional: false }
    expect(filterCustomScripts(scripts, 'head', consent)).toEqual(scripts)
  })

  it('renders analytics/marketing/functional scripts when no consent argument is passed', () => {
    const scripts: CustomScript[] = [
      { ...base, enabled: true, consentCategory: 'analytics' },
      { ...base, enabled: true, consentCategory: 'marketing' },
      { ...base, enabled: true, consentCategory: 'functional' },
    ]
    expect(filterCustomScripts(scripts, 'head')).toEqual(scripts)
  })

  it('returns [] for undefined input', () => {
    expect(filterCustomScripts(undefined, 'head')).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(filterCustomScripts([], 'head')).toEqual([])
  })
})

describe('consentStateFor', () => {
  it('returns a fail-closed ConsentState when consentModeEnabled is true', () => {
    expect(consentStateFor(true)).toEqual({ analytics: false, marketing: false, functional: false })
  })

  it('returns undefined when consentModeEnabled is false', () => {
    expect(consentStateFor(false)).toBeUndefined()
  })

  it('returns undefined when consentModeEnabled is undefined', () => {
    expect(consentStateFor(undefined)).toBeUndefined()
  })

  it('feeds into filterCustomScripts to block analytics/marketing/functional scripts when consentModeEnabled is true, allowing only necessary', () => {
    const scripts: CustomScript[] = [
      { ...base, enabled: true, consentCategory: 'analytics' },
      { ...base, enabled: true, consentCategory: 'marketing' },
      { ...base, enabled: true, consentCategory: 'necessary' },
      { ...base, enabled: true, consentCategory: 'functional' },
    ]
    const result = filterCustomScripts(scripts, 'head', consentStateFor(true))
    expect(result).toEqual([scripts[2]])
  })

  it('feeds into filterCustomScripts to allow all scripts when consentModeEnabled is false/undefined', () => {
    const scripts: CustomScript[] = [
      { ...base, enabled: true, consentCategory: 'analytics' },
      { ...base, enabled: true, consentCategory: 'marketing' },
      { ...base, enabled: true, consentCategory: 'functional' },
    ]
    expect(filterCustomScripts(scripts, 'head', consentStateFor(false))).toEqual(scripts)
    expect(filterCustomScripts(scripts, 'head', consentStateFor(undefined))).toEqual(scripts)
  })
})

describe('builtInTrackingAllowed', () => {
  it('returns false when consentModeEnabled is true (no valid consent exists yet)', () => {
    expect(builtInTrackingAllowed(true)).toBe(false)
  })

  it('returns true when consentModeEnabled is false', () => {
    expect(builtInTrackingAllowed(false)).toBe(true)
  })

  it('returns true when consentModeEnabled is undefined', () => {
    expect(builtInTrackingAllowed(undefined)).toBe(true)
  })
})
