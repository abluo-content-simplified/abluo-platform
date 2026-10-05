import { describe, expect, it } from 'vitest'
import {
  EMBED_SECTION_TYPES,
  EMBED_VENDOR_REGISTRY,
  SITE_EMBED_SECTION_FIELDS,
  acceptAll,
  allowVendor,
  applyChoice,
  applyVendorChoices,
  choiceNeedsReload,
  deriveConsentPolicy,
  detectSiteEmbedVendors,
  embedAllowed,
  embedVendorName,
  grantsFrom,
  parseConsentCookie,
  rejectAll,
  requiresConsent,
  serializeConsentCookie,
  shouldShowBanner,
  vendorForEmbedUrl,
  videoSectionVendor,
  type ConsentRecord,
  type SiteEmbedsData,
} from '@/lib/consent'
import { siteEmbedsQuery } from '@/lib/sanity/queries'
import type { ProjectIntegrations } from '@/lib/sanity/types'

const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-10-05T10:00:00Z')
const after = (days: number) => new Date(T0.getTime() + days * DAY)

const ga: ProjectIntegrations = {
  integrationConfigs: [{ integrationId: 'google-analytics', enabled: true, values: { measurementId: 'G-TEST123' } }],
}
const vimeo = { id: 'vimeo', name: 'Vimeo' }
const maps = { id: 'google-maps', name: 'Google Maps' }
const youtube = { id: 'youtube', name: 'YouTube' }

// ── Vendor registry ──────────────────────────────────────────────────────────

describe('embed vendor registry', () => {
  it('youtube, vimeo, cloudflare-stream and google-maps — all External content', () => {
    expect(EMBED_VENDOR_REGISTRY.map((v) => v.id).sort()).toEqual(['cloudflare-stream', 'google-maps', 'vimeo', 'youtube'])
    expect(EMBED_VENDOR_REGISTRY.every((v) => v.purpose === 'externalContent')).toBe(true)
  })
  it('names are proper nouns; host vendors read back as their host', () => {
    expect(embedVendorName('youtube')).toBe('YouTube')
    expect(embedVendorName('cloudflare-stream')).toBe('Cloudflare Stream')
    expect(embedVendorName('embed:player_twitch_tv')).toBe('player.twitch.tv')
  })
  it('classifies iframe URLs; unknown hosts become cookie-safe host vendors', () => {
    expect(vendorForEmbedUrl('https://www.youtube.com/embed/abc')).toBe('youtube')
    expect(vendorForEmbedUrl('https://www.youtube-nocookie.com/embed/abc')).toBe('youtube')
    expect(vendorForEmbedUrl('https://player.vimeo.com/video/1')).toBe('vimeo')
    expect(vendorForEmbedUrl('https://customer-x.cloudflarestream.com/u/iframe')).toBe('cloudflare-stream')
    expect(vendorForEmbedUrl('https://www.google.com/maps/embed/v1/place?q=x')).toBe('google-maps')
    const host = vendorForEmbedUrl('https://player.twitch.tv/?channel=x')!
    expect(host).toBe('embed:player_twitch_tv')
    // Round-trips through the cookie parser (id charset / length).
    const rec = allowVendor(null, host, T0)
    expect(parseConsentCookie(serializeConsentCookie(rec))!.vendors[host]).toBeDefined()
  })
  it('relative or non-http URLs are not third-party vendors', () => {
    expect(vendorForEmbedUrl('/embed/local.html')).toBeNull()
    expect(vendorForEmbedUrl('')).toBeNull()
  })
  it('videoSectionVendor: per provider; direct files and empty sources need no consent', () => {
    expect(videoSectionVendor({ provider: 'youtube', videoId: 'a' })).toBe('youtube')
    expect(videoSectionVendor({ provider: 'vimeo', videoId: '1' })).toBe('vimeo')
    expect(videoSectionVendor({ provider: 'cloudflare', videoId: 'u' })).toBe('cloudflare-stream')
    expect(videoSectionVendor({ provider: 'youtube' })).toBeNull()
    expect(videoSectionVendor({ provider: 'url', videoUrl: 'https://cdn.sanity.io/files/x/y/clip.mp4' })).toBeNull()
    expect(videoSectionVendor({ provider: 'url', videoUrl: 'https://vimeo.com/123' })).toBe('vimeo')
  })
})

// ── Site vendor detection ────────────────────────────────────────────────────

describe('detectSiteEmbedVendors', () => {
  const data = (sections: SiteEmbedsData['docs'], site?: SiteEmbedsData['site']): SiteEmbedsData => ({ docs: sections, site })
  const on = { mapsEmbedEnabled: true }

  it('no embeds → empty', () => {
    expect(detectSiteEmbedVendors(null, on)).toEqual([])
    expect(detectSiteEmbedVendors(data([{ sections: [{ _type: 'heroSection' }] }]), on)).toEqual([])
  })
  it('videos by provider across documents, deduplicated, maps last', () => {
    const out = detectSiteEmbedVendors(
      data(
        [
          { sections: [{ _type: 'videoSection', provider: 'vimeo', videoId: '1' }, { _type: 'contactSection' }] },
          { sections: [{ _type: 'videoSection', provider: 'vimeo', videoId: '2' }] },
          { sections: null },
        ],
        { hasAddress: true }
      ),
      on
    )
    expect(out).toEqual([vimeo, maps])
  })
  it('maps need the section map on, a mappable address, and the platform key', () => {
    const contact = [{ sections: [{ _type: 'contactSection' }] }]
    expect(detectSiteEmbedVendors(data(contact, { hasAddress: true }), { mapsEmbedEnabled: false })).toEqual([])
    expect(detectSiteEmbedVendors(data(contact, { hasAddress: false }), on)).toEqual([])
    expect(detectSiteEmbedVendors(data([{ sections: [{ _type: 'contactSection', showMap: false }] }], { hasAddress: true }), on)).toEqual([])
    const loc = [{ sections: [{ _type: 'locationsSection' }] }]
    expect(detectSiteEmbedVendors(data(loc, { mappableLocations: 0 }), on)).toEqual([])
    expect(detectSiteEmbedVendors(data(loc, { mappableLocations: 2 }), on)).toEqual([maps])
  })
  it('a direct video file adds no vendor', () => {
    const d = data([{ sections: [{ _type: 'videoSection', provider: 'url', videoUrl: 'https://cdn.sanity.io/a.mp4' }] }])
    expect(detectSiteEmbedVendors(d, on)).toEqual([])
  })
  it('siteEmbedsQuery projects every registered section type and field, scoped to the project', () => {
    for (const t of EMBED_SECTION_TYPES) expect(siteEmbedsQuery).toContain(`"${t}"`)
    for (const f of SITE_EMBED_SECTION_FIELDS) expect(siteEmbedsQuery).toContain(f)
    expect(siteEmbedsQuery.match(/projectSlug == \$projectSlug/g)?.length).toBe(2)
  })
})

// ── Banner trigger ───────────────────────────────────────────────────────────

describe('banner trigger with External content', () => {
  it('no tracking and no embeds → no banner', () => {
    expect(requiresConsent(deriveConsentPolicy(undefined, []))).toBe(false)
  })
  it('embeds only → banner with just the External content category', () => {
    const p = deriveConsentPolicy(undefined, [vimeo, maps])
    expect(requiresConsent(p)).toBe(true)
    expect(Object.keys(p.purposes)).toEqual(['externalContent'])
    expect(p.purposes.externalContent!.vendors.map((v) => v.name)).toEqual(['Vimeo', 'Google Maps'])
    expect(shouldShowBanner(null, p, T0)).toBe(true)
  })
  it('tracking only → exactly as before (no externalContent)', () => {
    const p = deriveConsentPolicy(ga)
    expect(Object.keys(p.purposes)).toEqual(['analytics'])
  })
  it('the tracking kill switch blanks scripts, not page embeds', () => {
    const p = deriveConsentPolicy({ ...ga, privacy: { trackingKillSwitch: true } }, [youtube])
    expect(Object.keys(p.purposes)).toEqual(['externalContent'])
  })
  it('custom scripts cannot claim externalContent', () => {
    const p = deriveConsentPolicy({
      integrationConfigs: [
        { integrationId: 'custom-scripts', enabled: true, values: { scripts: [{ label: 'x', code: 'x()', enabled: true, consentCategory: 'externalContent' }] } },
      ],
    })
    expect(requiresConsent(p)).toBe(false)
  })
  it('existing visitor (tracking-only record) is asked once more for the new category', () => {
    const before = deriveConsentPolicy(ga)
    const rec = applyChoice(null, before, acceptAll(before), T0)
    const now = deriveConsentPolicy(ga, [vimeo])
    // The old record still parses and keeps its analytics answer.
    const parsed = parseConsentCookie(serializeConsentCookie(rec))!
    expect(parsed.purposes.externalContent).toBeUndefined()
    expect(grantsFrom(parsed, now, after(1)).analytics).toBe(true)
    expect(grantsFrom(parsed, now, after(1)).externalContent).toBe(false)
    expect(shouldShowBanner(parsed, now, after(1))).toBe(true)
    // Answering records the new category; no banner after that.
    const answered = applyChoice(parsed, now, { analytics: true, externalContent: false }, after(1))
    expect(shouldShowBanner(answered, now, after(2))).toBe(false)
  })
  it('a site that adds a new embed vendor re-asks an accepted category, not a refused one (< 6 months)', () => {
    const p1 = deriveConsentPolicy(undefined, [vimeo])
    const p2 = deriveConsentPolicy(undefined, [vimeo, youtube])
    const accepted = applyChoice(null, p1, acceptAll(p1), T0)
    const refused = applyChoice(null, p1, rejectAll(), T0)
    expect(shouldShowBanner(accepted, p2, after(10))).toBe(true)
    expect(shouldShowBanner(refused, p2, after(10))).toBe(false)
    expect(shouldShowBanner(refused, p2, after(200))).toBe(true)
  })
})

// ── Grants interplay ─────────────────────────────────────────────────────────

describe('purpose grant × per-vendor allow', () => {
  const policy = deriveConsentPolicy(ga, [vimeo, maps])

  it('nothing decided → no embed loads', () => {
    expect(embedAllowed(null, policy, 'vimeo', T0)).toBe(false)
  })
  it('purpose granted → every vendor listed under it loads', () => {
    const rec = applyChoice(null, policy, { externalContent: true }, T0)
    expect(embedAllowed(rec, policy, 'vimeo', after(1))).toBe(true)
    expect(embedAllowed(rec, policy, 'google-maps', after(1))).toBe(true)
    // …but not a vendor the visitor was never shown (detection miss) — fail closed.
    expect(embedAllowed(rec, policy, 'youtube', after(1))).toBe(false)
  })
  it('purpose refused + "always allow" one vendor → only that vendor loads', () => {
    let rec: ConsentRecord = applyChoice(null, policy, rejectAll(), T0)
    rec = allowVendor(rec, 'google-maps', T0)
    expect(embedAllowed(rec, policy, 'google-maps', after(1))).toBe(true)
    expect(embedAllowed(rec, policy, 'vimeo', after(1))).toBe(false)
  })
  it('settings can revoke both: purpose off and vendor withdrawn', () => {
    let rec: ConsentRecord = applyChoice(null, policy, { externalContent: true }, T0)
    rec = allowVendor(rec, 'google-maps', T0)
    rec = applyChoice(rec, policy, { externalContent: false }, after(1))
    expect(embedAllowed(rec, policy, 'vimeo', after(1))).toBe(false)
    expect(embedAllowed(rec, policy, 'google-maps', after(1))).toBe(true) // per-vendor allow survives
    rec = applyVendorChoices(rec, { 'google-maps': false }, after(1))
    expect(embedAllowed(rec, policy, 'google-maps', after(1))).toBe(false)
  })
  it('the purpose grant expires after 12 months like every decision', () => {
    const rec = applyChoice(null, policy, { externalContent: true }, T0)
    expect(embedAllowed(rec, policy, 'vimeo', after(366))).toBe(false)
  })
  it('reload only for newly granted script purposes, never for External content alone', () => {
    const none = grantsFrom(null, policy, T0)
    const ext = grantsFrom(applyChoice(null, policy, { externalContent: true }, T0), policy, T0)
    const all = grantsFrom(applyChoice(null, policy, acceptAll(policy), T0), policy, T0)
    expect(choiceNeedsReload(none, ext)).toBe(false)
    expect(choiceNeedsReload(none, all)).toBe(true)
    expect(choiceNeedsReload(ext, ext)).toBe(false)
  })
})
