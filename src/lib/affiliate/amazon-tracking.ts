/**
 * Amazon links + a tenant's tracking IDs + a visitor's country. Pure.
 *
 * - trackingIdFor: the tenant's ID for one marketplace (siteConfig.amazonTrackingIds).
 * - marketplaceForCountry: the marketplace that serves a visitor country (never the site language).
 * - chooseAmazonUrl: among an item's Amazon URLs, the one for this visitor, else the primary.
 * - describeAmazonLink: what the editor shows under a pasted link.
 */

import { AMAZON_MARKETPLACES, isAmazonMarketplace, looksLikeTrackingId, type AmazonMarketplace } from './amazon-marketplaces'
import { buildAffiliateUrl, isAmazonShortLink, looksLikeAmazon, parseAmazonUrl, type ParsedAmazonUrl } from './amazon-links'

/** Tolerant input: siteConfig arrays come from Sanity and may hold junk or be missing. */
export type TrackingIdRows = readonly ({ marketplace?: unknown; trackingId?: unknown } | null | undefined)[] | null | undefined

export function trackingIdFor(rows: TrackingIdRows, marketplace: AmazonMarketplace): string | null {
  for (const r of rows ?? []) {
    if (r && r.marketplace === marketplace && typeof r.trackingId === 'string' && looksLikeTrackingId(r.trackingId)) return r.trackingId.trim()
  }
  return null
}

/** Visitor country (ISO 3166-1 alpha-2, any case; the `x-vercel-ip-country` value) → marketplace, or null. */
export function marketplaceForCountry(country: string | null | undefined): AmazonMarketplace | null {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!c) return null
  return AMAZON_MARKETPLACES.find((m) => (m.countries as readonly string[]).includes(c))?.id ?? null
}

export type ChosenAmazonUrl = { parsed: ParsedAmazonUrl; href: string; marketplace: AmazonMarketplace; tagged: boolean; ownId: boolean }

/**
 * Picks the URL for this visitor: the item's URL for the marketplace serving their
 * country when it has one, else the primary. Returns null when the primary is not a
 * readable Amazon product URL (then the link stays exactly as stored).
 */
export function chooseAmazonUrl(
  primary: string,
  more: readonly string[] | null | undefined,
  opts: { country?: string | null; trackingIds?: TrackingIdRows },
): ChosenAmazonUrl | null {
  const main = parseAmazonUrl(primary)
  if (!main.ok) return null
  let chosen: ParsedAmazonUrl = main
  const wanted = marketplaceForCountry(opts.country)
  if (wanted && wanted !== main.marketplace) {
    for (const u of more ?? []) {
      const p = parseAmazonUrl(u)
      if (p.ok && p.marketplace === wanted) {
        chosen = p
        break
      }
    }
  }
  const id = trackingIdFor(opts.trackingIds, chosen.marketplace)
  const href = buildAffiliateUrl(chosen, id)
  return { parsed: chosen, href, marketplace: chosen.marketplace, tagged: href.includes('?tag='), ownId: id !== null }
}

export type AmazonLinkInfo =
  | { state: 'none' }
  | { state: 'short' }
  | { state: 'unreadable' }
  | { state: 'ok'; marketplace: AmazonMarketplace; href: string; idSource: 'settings' | 'pasted' | 'none' }

/** The editor's view of one pasted URL: nothing to say, a short link, an Amazon link we cannot read, or the final link. */
export function describeAmazonLink(url: string, trackingIds: TrackingIdRows): AmazonLinkInfo {
  if (!url.trim() || !looksLikeAmazon(url)) return { state: 'none' }
  if (isAmazonShortLink(url)) return { state: 'short' }
  const p = parseAmazonUrl(url)
  if (!p.ok) return { state: 'unreadable' }
  const id = trackingIdFor(trackingIds, p.marketplace)
  return { state: 'ok', marketplace: p.marketplace, href: buildAffiliateUrl(p, id), idSource: id ? 'settings' : p.tag ? 'pasted' : 'none' }
}

export { isAmazonMarketplace }
