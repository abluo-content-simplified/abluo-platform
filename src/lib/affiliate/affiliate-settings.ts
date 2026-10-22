/**
 * The tenant's affiliate settings + one pasted URL → what the editor shows and
 * what the website links to. Pure, browser-safe. Provider-agnostic entry point
 * for Catalogue (and later other modules); Amazon keeps its own per-visitor
 * marketplace logic in amazon-tracking.ts and is only wrapped here.
 *
 * Stored on siteConfig (additive, all optional):
 *   amazonTrackingIds[] { marketplace, trackingId }      — unchanged
 *   awinPublisherId      string (digits)
 *   affiliateShops[]     { _key: 'shop-<id>', shop }     — shops the tenant was
 *                         APPROVED for, in the tenant's display order. 'amazon'
 *                         may appear to place Amazon; when absent Amazon goes first.
 */

import { describeAmazonLink, type AmazonLinkInfo, type TrackingIdRows } from './amazon-tracking'
import { looksLikeAmazon } from './amazon-links'
import { buildAwinUrl, looksLikeAwinPublisherId, parseAwinUrl } from './awin-links'
import { AFFILIATE_SHOP_IDS, isAffiliateShopId, type AffiliateShop, type AffiliateShopId } from './shops'

/** Tolerant input: siteConfig values come from Sanity and may hold junk or be missing. */
export type AffiliateSettings = {
  amazonTrackingIds?: TrackingIdRows
  awinPublisherId?: unknown
  affiliateShops?: readonly ({ shop?: unknown } | null | undefined)[] | null
}

/** The tenant's valid Awin publisher ID, else null. */
export const awinPublisherIdOf = (s: AffiliateSettings | null | undefined): string | null =>
  looksLikeAwinPublisherId(s?.awinPublisherId) ? (s!.awinPublisherId as string).trim() : null

/** Shops the tenant ticked as approved (Amazon not included unless listed), de-duplicated, in their order. */
export function approvedShops(s: AffiliateSettings | null | undefined): AffiliateShopId[] {
  const out: AffiliateShopId[] = []
  for (const r of s?.affiliateShops ?? []) if (r && isAffiliateShopId(r.shop) && !out.includes(r.shop)) out.push(r.shop)
  return out
}

/** Display order of every shop: the tenant's order; Amazon first when not placed; unlisted shops after, in platform order. */
export function shopOrder(s: AffiliateSettings | null | undefined): AffiliateShopId[] {
  const listed = approvedShops(s)
  const head: AffiliateShopId[] = listed.includes('amazon') ? [] : ['amazon']
  const ordered = [...head, ...listed]
  return [...ordered, ...AFFILIATE_SHOP_IDS.filter((id) => !ordered.includes(id))]
}

export type AwinLinkStatus =
  /** Tenant's own publisher ID added. */
  | 'tracked'
  /** Tenant has no usable ID/approval, but the pasted Awin link's ID is kept. */
  | 'pasted'
  /** No Awin publisher ID in Settings → plain link. */
  | 'no_publisher_id'
  /** Shop not ticked as approved in Settings → plain link. */
  | 'not_approved'
  /** Abluo has no verified advertiser ID for this shop yet → plain link. */
  | 'shop_not_ready'

export type ShopLink =
  | { provider: null; shop: null; href: string; tracked: false }
  | { provider: 'awin'; shop: AffiliateShop; href: string; tracked: boolean; status: AwinLinkStatus }

/**
 * A pasted URL → the Awin link to render (or the URL unchanged when it is not a
 * known Awin shop). Amazon URLs return provider null here: Amazon is handled by
 * amazon-delivery (per visitor country) and describeAmazonLink (editor).
 */
export function resolveShopLink(url: string, s: AffiliateSettings | null | undefined): ShopLink {
  const p = looksLikeAmazon(url) ? null : parseAwinUrl(url)
  if (!p) return { provider: null, shop: null, href: url, tracked: false }
  const own = awinPublisherIdOf(s)
  const approved = approvedShops(s).includes(p.shop.id)
  const mid = p.shop.awinAdvertiserId
  let status: AwinLinkStatus
  let publisher: string | null = null
  if (mid === null) status = 'shop_not_ready'
  else if (own && approved) (status = 'tracked'), (publisher = own)
  else if (p.pastedPublisherId) (status = 'pasted'), (publisher = p.pastedPublisherId)
  else status = own ? 'not_approved' : 'no_publisher_id'
  // Not tracked by Abluo → the link stays EXACTLY as stored (old links render unchanged).
  // A shop we cannot verify yet keeps a pasted Awin link as pasted too.
  if (mid === null) return { provider: 'awin', shop: p.shop, href: url.trim(), tracked: !!p.pastedPublisherId, status }
  if (!publisher) return { provider: 'awin', shop: p.shop, href: url.trim(), tracked: false, status }
  return { provider: 'awin', shop: p.shop, href: buildAwinUrl(mid, publisher, p.productUrl), tracked: true, status }
}

/** The editor's view of one pasted URL, for any provider. */
export type AffiliateLinkInfo =
  | { provider: 'amazon'; info: AmazonLinkInfo }
  | { provider: 'awin'; shop: AffiliateShop; href: string; status: AwinLinkStatus }
  | { provider: null }

export function describeAffiliateLink(url: string, s: AffiliateSettings | null | undefined): AffiliateLinkInfo {
  if (!url.trim()) return { provider: null }
  if (looksLikeAmazon(url)) return { provider: 'amazon', info: describeAmazonLink(url, s?.amazonTrackingIds) }
  const r = resolveShopLink(url, s)
  return r.provider === 'awin' ? { provider: 'awin', shop: r.shop, href: r.href, status: r.status } : { provider: null }
}
