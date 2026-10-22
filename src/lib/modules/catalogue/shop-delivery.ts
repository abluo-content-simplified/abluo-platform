// ── Catalogue — shop buy links (Amazon + Awin shops), delivery ────────────────
//
// Pure, browser-safe. Builds on amazon-delivery: Amazon links are localised first
// (visitor country + the tenant's tracking ID), then every remaining buy link whose
// address is a known Awin shop is resolved with the tenant's own publisher ID and
// approved shops. A shop that is not approved / no ID = plain clean link (resolveShopLink).
// Old links are untouched and, when nothing changes, the same objects are returned.

import { looksLikeAmazon } from '@/lib/affiliate/amazon-links'
import { parseAwinUrl } from '@/lib/affiliate/awin-links'
import type { AffiliateShopId } from '@/lib/affiliate/shops'
import { resolveShopLink, type AffiliateSettings } from '@/lib/affiliate/affiliate-settings'
import { localizeBuyLinks } from './amazon-delivery'
import type { CatalogueCollectionDTO, CatalogueItemDTO, CatalogueItemLinkDTO, CatalogueSectionDTO } from './dto'

export type ShopDeliveryContext = { country: string | null | undefined; settings: AffiliateSettings | null | undefined }

/** A known Awin shop page, or an Awin wrapper link of one (recognised by parseAwinUrl). */
const isAwinShopUrl = (url: string): boolean => parseAwinUrl(url) !== null

/** Cheap pre-check: any buy link that is an Amazon page or a known Awin shop. */
export const linksHaveShop = (links: readonly CatalogueItemLinkDTO[] | null | undefined): boolean =>
  (links ?? []).some((l) => l.kind === 'buy' && (looksLikeAmazon(l.url) || isAwinShopUrl(l.url)))

const sectionsHaveShop = (sections: readonly CatalogueSectionDTO[]): boolean =>
  sections.some((s) => s.items.some((i) => linksHaveShop(i.links)) || sectionsHaveShop(s.children))
export const collectionHasShop = (c: Pick<CatalogueCollectionDTO, 'sections'>): boolean => sectionsHaveShop(c.sections)

export function deliverBuyLinks(links: readonly CatalogueItemLinkDTO[], ctx: ShopDeliveryContext): CatalogueItemLinkDTO[] {
  const amazon = localizeBuyLinks(links, { country: ctx.country, trackingIds: ctx.settings?.amazonTrackingIds })
  let changed = amazon !== (links as CatalogueItemLinkDTO[])
  const out = amazon.map((l) => {
    if (l.kind !== 'buy') return l
    if (l.amazon === true) {
      changed = true
      return { ...l, shop: 'amazon' as AffiliateShopId }
    }
    const r = resolveShopLink(l.url, ctx.settings)
    if (r.provider !== 'awin') return l
    changed = true
    return { ...l, url: r.href, shop: r.shop.id, affiliate: l.affiliate || r.tracked }
  })
  return changed ? out : (links as CatalogueItemLinkDTO[])
}

export function deliverItem<T extends Pick<CatalogueItemDTO, 'links'>>(item: T, ctx: ShopDeliveryContext): T {
  const links = deliverBuyLinks(item.links, ctx)
  return links === item.links ? item : { ...item, links }
}

function deliverSections(sections: readonly CatalogueSectionDTO[], ctx: ShopDeliveryContext): CatalogueSectionDTO[] {
  let changed = false
  const out = sections.map((s) => {
    const items = s.items.map((i) => deliverItem(i, ctx))
    const children = deliverSections(s.children, ctx)
    if (items.some((x, n) => x !== s.items[n]) || children !== s.children) {
      changed = true
      return { ...s, items, children }
    }
    return s
  })
  return changed ? out : (sections as CatalogueSectionDTO[])
}

export function deliverCollection(c: CatalogueCollectionDTO, ctx: ShopDeliveryContext): CatalogueCollectionDTO {
  const sections = deliverSections(c.sections, ctx)
  return sections === c.sections ? c : { ...c, sections }
}

/** Stable sort by the tenant's shop order; links with no recognised shop keep their stored order after the known ones. */
export function sortByShopOrder<T extends { shop?: AffiliateShopId }>(links: readonly T[], order: readonly AffiliateShopId[] | null | undefined): T[] {
  const rank = (l: T): number => {
    const i = l.shop ? (order ?? []).indexOf(l.shop) : -1
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  return links.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l)
}
