// ─── Cookie consent — embed vendors (ADR-021) ────────────────────────────────
//
// Third-party content embedded in a page (videos, maps). Every vendor belongs
// to the `externalContent` purpose: accepting that purpose in the banner loads
// every embed of the vendors the site uses; without it each embed stays a
// click-to-load placeholder (ConsentEmbed) with a per-vendor "always allow".
//
// The id is what the consent cookie stores; the name is a proper noun shown to
// visitors (never translated). A new embed (Instagram, Spotify, Calendly…) is
// one entry here plus one <ConsentEmbed vendorId=…> at the point of use — and,
// if it lives in a section, one entry in EMBED_SECTIONS (site-embeds.ts).

import type { ConsentPurpose, ConsentVendor } from './types'

export interface EmbedVendor {
  id: string
  name: string
  purpose: Extract<ConsentPurpose, 'externalContent'>
}

export const EMBED_VENDOR_REGISTRY: readonly EmbedVendor[] = [
  { id: 'youtube', name: 'YouTube', purpose: 'externalContent' },
  { id: 'vimeo', name: 'Vimeo', purpose: 'externalContent' },
  // Our own video host, but a separate company on a separate domain — the
  // visitor's browser talks to Cloudflare, so it is external content too.
  { id: 'cloudflare-stream', name: 'Cloudflare Stream', purpose: 'externalContent' },
  { id: 'google-maps', name: 'Google Maps', purpose: 'externalContent' },
]

/** Back-compat map view of the registry. */
export const EMBED_VENDORS: Record<string, { name: string }> = Object.fromEntries(
  EMBED_VENDOR_REGISTRY.map((v) => [v.id, { name: v.name }])
)

/** Prefix of vendors derived from an arbitrary iframe URL's host. */
export const HOST_VENDOR_PREFIX = 'embed:'

/**
 * Vendor id for an iframe on an unknown host: `embed:<host>` with dots as `_`
 * (the cookie parser accepts only `[a-z0-9:_-]`, ≤ 64 chars).
 */
export function hostVendorId(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9-]/g, '_')
  return `${HOST_VENDOR_PREFIX}${h}`.slice(0, 64)
}

export function embedVendorName(id: string): string {
  const known = EMBED_VENDORS[id]?.name
  if (known) return known
  if (id.startsWith(HOST_VENDOR_PREFIX)) return id.slice(HOST_VENDOR_PREFIX.length).replace(/_/g, '.')
  return id
}

export function embedVendor(id: string): ConsentVendor {
  return { id, name: embedVendorName(id) }
}

/** Whether a vendor id is an embed vendor (registry or host-derived). */
export function isEmbedVendorId(id: string): boolean {
  return id in EMBED_VENDORS || id.startsWith(HOST_VENDOR_PREFIX)
}

/**
 * Classifies an iframe URL. Known hosts map to their registry vendor; any other
 * absolute http(s) URL becomes a host vendor. A relative or unparseable URL is
 * first-party (same origin) → null, no consent needed.
 */
export function vendorForEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const is = (d: string) => host === d || host.endsWith(`.${d}`)
  if (is('youtube.com') || is('youtube-nocookie.com') || is('youtu.be')) return 'youtube'
  if (is('vimeo.com')) return 'vimeo'
  if (is('cloudflarestream.com') || is('videodelivery.net')) return 'cloudflare-stream'
  if (is('google.com') && url.pathname.startsWith('/maps')) return 'google-maps'
  return hostVendorId(host)
}

/** Direct video files — rendered with <video>, not an iframe. */
export const DIRECT_VIDEO_FILE_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i

/**
 * The consent vendor of one VideoSection, or null when it needs no consent
 * (no source, or a direct video file). Shared by the renderer and the site
 * vendor detection so the two can never disagree.
 */
export function videoSectionVendor(section: {
  provider?: string | null
  videoId?: string | null
  videoUrl?: string | null
}): string | null {
  switch (section.provider) {
    case 'youtube':
      return section.videoId ? 'youtube' : null
    case 'vimeo':
      return section.videoId ? 'vimeo' : null
    case 'cloudflare':
      return section.videoId ? 'cloudflare-stream' : null
    case 'url':
      if (!section.videoUrl || DIRECT_VIDEO_FILE_RE.test(section.videoUrl)) return null
      return vendorForEmbedUrl(section.videoUrl)
    default:
      return null
  }
}
