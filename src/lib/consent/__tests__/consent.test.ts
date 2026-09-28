import { describe, expect, it } from 'vitest'
import {
  acceptAll,
  allowVendor,
  applyChoice,
  consentCookieName,
  deriveConsentPolicy,
  grantsFrom,
  parseConsentCookie,
  rejectAll,
  requiresConsent,
  serializeConsentCookie,
  shouldShowBanner,
  vendorAllowed,
} from '@/lib/consent'
import type { ProjectIntegrations } from '@/lib/sanity/types'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-10-01T10:00:00Z')
const after = (days: number) => new Date(T0.getTime() + days * DAY)

const ga: ProjectIntegrations = {
  integrationConfigs: [{ integrationId: 'google-analytics', enabled: true, values: { measurementId: 'G-TEST123' } }],
}
const gaAndPixel: ProjectIntegrations = {
  integrationConfigs: [
    ...ga.integrationConfigs!,
    { integrationId: 'meta-pixel', enabled: true, values: { pixelId: '123' } },
  ],
}
const gaAndGtm: ProjectIntegrations = {
  integrationConfigs: [
    ...ga.integrationConfigs!,
    { integrationId: 'google-tag-manager', enabled: true, values: { containerId: 'GTM-X' } },
  ],
}

describe('deriveConsentPolicy / requiresConsent', () => {
  it('no tracking → no banner', () => {
    expect(requiresConsent(deriveConsentPolicy(undefined))).toBe(false)
    expect(requiresConsent(deriveConsentPolicy({ integrationConfigs: [] }))).toBe(false)
  })
  it('enabled but blank value → no banner', () => {
    const p = deriveConsentPolicy({ integrationConfigs: [{ integrationId: 'google-analytics', enabled: true, values: {} }] })
    expect(requiresConsent(p)).toBe(false)
  })
  it('disabled integration → no banner', () => {
    const p = deriveConsentPolicy({ integrationConfigs: [{ integrationId: 'google-analytics', enabled: false, values: { measurementId: 'G-1' } }] })
    expect(requiresConsent(p)).toBe(false)
  })
  it('kill switch → no banner (nothing loads)', () => {
    expect(requiresConsent(deriveConsentPolicy({ ...ga, privacy: { trackingKillSwitch: true } }))).toBe(false)
  })
  it('GA4 → analytics only; Meta → marketing', () => {
    const p = deriveConsentPolicy(gaAndPixel)
    expect(Object.keys(p.purposes).sort()).toEqual(['analytics', 'marketing'])
    expect(p.purposes.analytics!.vendors.map((v) => v.id)).toEqual(['google-analytics'])
  })
  it('custom scripts: necessary exempt, others gated by their own category', () => {
    const p = deriveConsentPolicy({
      integrationConfigs: [{
        integrationId: 'custom-scripts', enabled: true, values: { scripts: [
          { label: 'chat', code: 'x', enabled: true, consentCategory: 'functional' },
          { label: 'sec', code: 'x', enabled: true, consentCategory: 'necessary' },
          { label: 'off', code: 'x', enabled: false, consentCategory: 'marketing' },
        ] },
      }],
    })
    expect(Object.keys(p.purposes)).toEqual(['functional'])
  })
})

describe('cookie', () => {
  it('name is per project (shared preview host)', () => {
    expect(consentCookieName('livener')).not.toBe(consentCookieName('studiomartegani'))
  })
  it('round-trips', () => {
    const p = deriveConsentPolicy(ga)
    const rec = applyChoice(null, p, acceptAll(p), T0)
    expect(parseConsentCookie(serializeConsentCookie(rec))).toEqual(rec)
  })
  it('corrupt / foreign / wrong version → null (fail closed)', () => {
    expect(parseConsentCookie('%%%')).toBeNull()
    expect(parseConsentCookie('{"v":2}')).toBeNull()
    expect(parseConsentCookie(encodeURIComponent('{"v":1,"purposes":{"analytics":{"granted":"yes"}}}'))!.purposes).toEqual({})
  })
})

describe('banner & grants — the rules', () => {
  const p = deriveConsentPolicy(ga)

  it('first visit → banner, nothing granted', () => {
    expect(shouldShowBanner(null, p, T0)).toBe(true)
    expect(grantsFrom(null, p, T0).analytics).toBe(false)
  })
  it('accept → no banner for 12 months, analytics granted', () => {
    const rec = applyChoice(null, p, acceptAll(p), T0)
    expect(shouldShowBanner(rec, p, after(1))).toBe(false)
    expect(shouldShowBanner(rec, p, after(364))).toBe(false)
    expect(grantsFrom(rec, p, after(364)).analytics).toBe(true)
    expect(shouldShowBanner(rec, p, after(366))).toBe(true)
    expect(grantsFrom(rec, p, after(366)).analytics).toBe(false)
  })
  it('X / reject → no banner for 12 months, nothing granted', () => {
    const rec = applyChoice(null, p, rejectAll(), T0)
    expect(shouldShowBanner(rec, p, after(1))).toBe(false)
    expect(shouldShowBanner(rec, p, after(200))).toBe(false)
    expect(grantsFrom(rec, p, after(1)).analytics).toBe(false)
    expect(shouldShowBanner(rec, p, after(366))).toBe(true)
  })
  it('accepted purpose gets a new vendor → ask again immediately, stop loading', () => {
    const rec = applyChoice(null, p, acceptAll(p), T0)
    const p2 = deriveConsentPolicy(gaAndGtm)
    expect(shouldShowBanner(rec, p2, after(10))).toBe(true)
    expect(grantsFrom(rec, p2, after(10)).analytics).toBe(false)
  })
  it('refused purpose gets a new vendor → NOT before 6 months, yes after', () => {
    const rec = applyChoice(null, p, rejectAll(), T0)
    const p2 = deriveConsentPolicy(gaAndGtm)
    expect(shouldShowBanner(rec, p2, after(30))).toBe(false)
    expect(shouldShowBanner(rec, p2, after(182))).toBe(false)
    expect(shouldShowBanner(rec, p2, after(184))).toBe(true)
  })
  it('new purpose never asked → banner, but the old answer stays', () => {
    const rec = applyChoice(null, p, acceptAll(p), T0)
    const p2 = deriveConsentPolicy(gaAndPixel)
    expect(shouldShowBanner(rec, p2, after(5))).toBe(true)
    const g = grantsFrom(rec, p2, after(5))
    expect(g.analytics).toBe(true)
    expect(g.marketing).toBe(false)
  })
  it('custom choice: only what was ticked', () => {
    const p2 = deriveConsentPolicy(gaAndPixel)
    const rec = applyChoice(null, p2, { analytics: true }, T0)
    expect(grantsFrom(rec, p2, after(1))).toEqual({ analytics: true, marketing: false, functional: false })
    expect(shouldShowBanner(rec, p2, after(1))).toBe(false)
  })
  it('future-dated decision (tampered cookie) → ask, grant nothing', () => {
    const rec = applyChoice(null, p, acceptAll(p), after(30))
    expect(shouldShowBanner(rec, p, T0)).toBe(true)
    expect(grantsFrom(rec, p, T0).analytics).toBe(false)
  })
  it('site with no tracking never shows a banner, whatever the cookie', () => {
    expect(shouldShowBanner(null, deriveConsentPolicy(undefined), T0)).toBe(false)
  })
})

describe('embed vendors (click-to-load)', () => {
  it('always-allow lasts 12 months and does not touch purposes', () => {
    const rec = allowVendor(null, 'google-maps', T0)
    expect(vendorAllowed(rec, 'google-maps', after(100))).toBe(true)
    expect(vendorAllowed(rec, 'google-maps', after(366))).toBe(false)
    expect(vendorAllowed(rec, 'youtube', after(1))).toBe(false)
    expect(rec.purposes).toEqual({})
  })
})

describe('embed withdrawal (settings panel)', () => {
  it('allowed vendors are listed, and withdrawing removes them', async () => {
    const { allowedVendorIds, applyVendorChoices } = await import('@/lib/consent')
    const rec = allowVendor(null, 'google-maps', T0)
    expect(allowedVendorIds(rec, after(1))).toEqual(['google-maps'])
    const withdrawn = applyVendorChoices(rec, { 'google-maps': false }, after(2))
    expect(allowedVendorIds(withdrawn, after(3))).toEqual([])
    expect(vendorAllowed(withdrawn, 'google-maps', after(3))).toBe(false)
  })
  it('keeping a vendor does not reset its 12-month clock', async () => {
    const { applyVendorChoices } = await import('@/lib/consent')
    const rec = allowVendor(null, 'google-maps', T0)
    const kept = applyVendorChoices(rec, { 'google-maps': true }, after(100))
    expect(kept.vendors['google-maps'].decidedAt).toBe(T0.toISOString())
  })
  it('expired vendor is no longer listed', async () => {
    const { allowedVendorIds } = await import('@/lib/consent')
    expect(allowedVendorIds(allowVendor(null, 'google-maps', T0), after(400))).toEqual([])
  })
})
