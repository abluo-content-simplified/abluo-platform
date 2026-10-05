// ─── Cookie consent — which embed vendors a site uses (ADR-021, 2026-10-05) ──
//
// The `externalContent` banner category lists only the services the site
// actually embeds ("Vimeo · Google Maps"). They are derived server-side from
// one cheap GROQ read (siteEmbedsQuery) over the project's section-bearing
// documents plus the siteConfig fields the map sections read, then run through
// the registry below. Pure — no Sanity client, no env reads.
//
// Adding an embed-capable section type = one entry in EMBED_SECTIONS (and the
// fields it needs in SITE_EMBED_SECTION_FIELDS). Anything detection misses
// fails closed: the embed keeps its click-to-load placeholder.

import { embedVendor, videoSectionVendor } from './embeds'
import type { ConsentVendor } from './types'

/** One section as projected by siteEmbedsQuery. */
export interface EmbedSectionRow {
  _type: string
  provider?: string | null
  videoId?: string | null
  videoUrl?: string | null
  showMap?: boolean | null
}

/** Raw result of siteEmbedsQuery. */
export interface SiteEmbedsData {
  docs?: { sections?: EmbedSectionRow[] | null }[] | null
  site?: { hasAddress?: boolean | null; mappableLocations?: number | null } | null
}

export interface SiteEmbedContext {
  /** NEXT_PUBLIC_GOOGLE_MAPS_KEY present — without it maps are link-only. */
  mapsEmbedEnabled: boolean
  hasAddress: boolean
  mappableLocations: number
}

type SectionVendors = (section: EmbedSectionRow, ctx: SiteEmbedContext) => string | null

/** Embed-capable section types → the vendor each one loads (null = none here). */
export const EMBED_SECTIONS: Record<string, SectionVendors> = {
  videoSection: (s) => videoSectionVendor(s),
  contactSection: (s, ctx) =>
    s.showMap !== false && ctx.mapsEmbedEnabled && ctx.hasAddress ? 'google-maps' : null,
  locationsSection: (s, ctx) =>
    s.showMap !== false && ctx.mapsEmbedEnabled && ctx.mappableLocations > 0 ? 'google-maps' : null,
}

export const EMBED_SECTION_TYPES: readonly string[] = Object.keys(EMBED_SECTIONS)

/** Section fields the registry reads — the GROQ projection. */
export const SITE_EMBED_SECTION_FIELDS = ['_type', 'provider', 'videoId', 'videoUrl', 'showMap'] as const

/** Stable display order: videos, then other hosts (alphabetically), then maps. */
const ORDER = ['youtube', 'vimeo', 'cloudflare-stream', '*', 'google-maps']

export function detectSiteEmbedVendors(
  data: SiteEmbedsData | null | undefined,
  opts: { mapsEmbedEnabled: boolean }
): ConsentVendor[] {
  if (!data) return []
  const ctx: SiteEmbedContext = {
    mapsEmbedEnabled: opts.mapsEmbedEnabled,
    hasAddress: data.site?.hasAddress === true,
    mappableLocations: typeof data.site?.mappableLocations === 'number' ? data.site.mappableLocations : 0,
  }
  const ids = new Set<string>()
  for (const doc of data.docs ?? []) {
    for (const s of doc?.sections ?? []) {
      const fn = s && EMBED_SECTIONS[s._type]
      const id = fn ? fn(s, ctx) : null
      if (id) ids.add(id)
    }
  }
  const rank = (id: string) => {
    const i = ORDER.indexOf(id)
    return i === -1 ? ORDER.indexOf('*') : i
  }
  return [...ids]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(embedVendor)
}
