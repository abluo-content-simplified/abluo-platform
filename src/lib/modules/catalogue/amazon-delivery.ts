// ── Catalogue — Amazon buy links (delivery + validation) ──────────────────────
//
// Pure, browser-safe. A buy link whose address is an Amazon product page is
// rewritten for each request: the item's URL for the marketplace serving the
// VISITOR'S COUNTRY (else the primary), carrying the tenant's own tracking ID
// for that marketplace. Done on the server per request, never cached across
// visitors (the website routes are force-dynamic). Old links are untouched:
// a link that is not a readable Amazon product URL is returned as stored, and
// when nothing changes the same objects are returned.

import { chooseAmazonUrl, type TrackingIdRows } from '@/lib/affiliate/amazon-tracking'
import { isAmazonShortLink, looksLikeAmazon, parseAmazonUrl } from '@/lib/affiliate/amazon-links'
import { catalogueLinkUrl } from './links'
import type { CatalogueCollectionDTO, CatalogueItemDTO, CatalogueItemLinkDTO, CatalogueSectionDTO } from './dto'

export const MAX_MORE_AMAZON_URLS = 8

/**
 * Server-side validation of a buy link's `moreUrls` (never trust the client).
 * Each must be an http(s) Amazon product URL (or an app short link, kept as typed);
 * the main address must itself be Amazon; a second URL for the same store is dropped.
 */
export function cleanMoreAmazonUrls(value: unknown, primaryUrl: string, fail: (message: string) => never): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_MORE_AMAZON_URLS) fail('Too many Amazon links.')
  const rows = (value as unknown[]).filter((v) => typeof v === 'string' && v.trim() !== '')
  if (rows.length === 0) return []
  if (!looksLikeAmazon(primaryUrl)) fail('Add the main Amazon link first.')
  const main = parseAmazonUrl(primaryUrl)
  const seen = new Set<string>(main.ok ? [main.marketplace] : [])
  const out: string[] = []
  for (const v of rows) {
    const url = catalogueLinkUrl(v)
    if (!url || !looksLikeAmazon(url)) fail('Use an Amazon product link.')
    const p = parseAmazonUrl(url!)
    if (!p.ok && !isAmazonShortLink(url!)) fail('Use an Amazon product link.')
    const key = p.ok ? p.marketplace : url!
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url!)
  }
  return out
}

export type AmazonDeliveryContext = { country: string | null | undefined; trackingIds: TrackingIdRows }

/** True when any link in these is an Amazon buy link (cheap pre-check before fetching tracking IDs). */
export const linksHaveAmazon = (links: readonly CatalogueItemLinkDTO[] | null | undefined): boolean =>
  (links ?? []).some((l) => l.kind === 'buy' && looksLikeAmazon(l.url))

export function localizeBuyLinks(links: readonly CatalogueItemLinkDTO[], ctx: AmazonDeliveryContext): CatalogueItemLinkDTO[] {
  let changed = false
  const out = links.map((l) => {
    if (l.kind !== 'buy') return l
    const c = chooseAmazonUrl(l.url, l.moreUrls, ctx)
    if (!c) return l
    changed = true
    // Affiliate when the final link carries an ID (the tenant's own, or the one they pasted) or they flagged it.
    const { moreUrls: _more, ...rest } = l
    void _more
    return { ...rest, url: c.href, affiliate: l.affiliate || c.tagged, amazon: true }
  })
  return changed ? out : (links as CatalogueItemLinkDTO[])
}

export function localizeItem<T extends Pick<CatalogueItemDTO, 'links'>>(item: T, ctx: AmazonDeliveryContext): T {
  const links = localizeBuyLinks(item.links, ctx)
  return links === item.links ? item : { ...item, links }
}

function localizeSections(sections: readonly CatalogueSectionDTO[], ctx: AmazonDeliveryContext): CatalogueSectionDTO[] {
  let changed = false
  const out = sections.map((s) => {
    const items = s.items.map((i) => localizeItem(i, ctx))
    const children = localizeSections(s.children, ctx)
    if (items.some((x, n) => x !== s.items[n]) || children !== s.children) {
      changed = true
      return { ...s, items, children }
    }
    return s
  })
  return changed ? out : (sections as CatalogueSectionDTO[])
}

export function localizeCollection(c: CatalogueCollectionDTO, ctx: AmazonDeliveryContext): CatalogueCollectionDTO {
  const sections = localizeSections(c.sections, ctx)
  return sections === c.sections ? c : { ...c, sections }
}

const itemsHaveAmazon = (sections: readonly CatalogueSectionDTO[]): boolean =>
  sections.some((s) => s.items.some((i) => linksHaveAmazon(i.links)) || itemsHaveAmazon(s.children))
export const collectionHasAmazon = (c: Pick<CatalogueCollectionDTO, 'sections'>): boolean => itemsHaveAmazon(c.sections)

/** An Amazon link that renders as an affiliate link (after localizeBuyLinks). */
export const isAmazonAffiliateLink = (l: Pick<CatalogueItemLinkDTO, 'amazon' | 'affiliate' | 'kind'>): boolean => l.kind === 'buy' && l.amazon === true && l.affiliate === true
export const hasAmazonAffiliateLink = (links: readonly CatalogueItemLinkDTO[] | null | undefined): boolean => (links ?? []).some(isAmazonAffiliateLink)

const sectionsHaveAmazonAffiliate = (sections: readonly CatalogueSectionDTO[]): boolean =>
  sections.some((s) => s.items.some((i) => hasAmazonAffiliateLink(i.links)) || sectionsHaveAmazonAffiliate(s.children))
export const collectionHasAmazonAffiliateLink = (c: Pick<CatalogueCollectionDTO, 'sections'>): boolean => sectionsHaveAmazonAffiliate(c.sections)

/** An item with an Amazon buy link shows no manually entered price (Amazon's rules). */
export const itemHasAmazonLink = (item: Pick<CatalogueItemDTO, 'links'>): boolean => item.links.some((l) => l.kind === 'buy' && l.amazon === true)
