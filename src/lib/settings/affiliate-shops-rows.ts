/**
 * Settings → Affiliate Programs → Awin: the pure model of the publisher ID and
 * the ordered list of shops (browser-safe, no React). Contract (siteConfig):
 *   awinPublisherId   string, digits 3–10 (empty = unset)
 *   affiliateShops[]  { _key: 'shop-<id>', _type: 'affiliateShopSetting', shop } —
 *                     the shops the tenant is APPROVED for, in display order;
 *                     'amazon' may be listed only to place Amazon in the order.
 */
import { shopOrder } from '@/lib/affiliate/affiliate-settings'
import { looksLikeAwinPublisherId } from '@/lib/affiliate/awin-links'
import { AFFILIATE_SHOP_IDS, isAffiliateShopId, type AffiliateShopId } from '@/lib/affiliate/shops'

export const AWIN_PATH = 'awinPublisherId'
export const SHOPS_PATH = 'affiliateShops'
export const MAX_AWIN_ID_LENGTH = 10
export const MAX_SHOPS = AFFILIATE_SHOP_IDS.length

export type StoredShop = { _key: string; _type: 'affiliateShopSetting'; shop: AffiliateShopId }
export type ShopsError = 'invalid_value'

/** Digits only (spaces and anything else out). */
export const cleanAwinId = (v: unknown): string => (typeof v === 'string' ? v.replace(/\D+/g, '') : '')

/** '' = unset; a valid ID = the trimmed digits; anything else = null (refused). */
export function toStoredAwinId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return ''
  return looksLikeAwinPublisherId(t) ? t : null
}

/** Shop ids (or `{shop}` rows) → stored rows. Unknown or repeated shop, or too many → refused. */
export function toStoredShops(v: unknown): { ok: true; value: StoredShop[] } | { ok: false; error: ShopsError } {
  if (!Array.isArray(v) || v.length > MAX_SHOPS) return { ok: false, error: 'invalid_value' }
  const value: StoredShop[] = []
  for (const item of v) {
    const id = typeof item === 'string' ? item : (item as { shop?: unknown } | null)?.shop
    if (!isAffiliateShopId(id) || value.some((s) => s.shop === id)) return { ok: false, error: 'invalid_value' }
    value.push({ _key: `shop-${id}`, _type: 'affiliateShopSetting', shop: id })
  }
  return { ok: true, value }
}

/** Stored (possibly junk) rows → valid shop ids in order. */
export function shopsFromStored(stored: ReadonlyArray<{ shop?: unknown } | null | undefined> | null | undefined): AffiliateShopId[] {
  const out: AffiliateShopId[] = []
  for (const r of stored ?? []) if (r && isAffiliateShopId(r.shop) && !out.includes(r.shop)) out.push(r.shop)
  return out
}

/** `order` = Amazon + the shops the tenant is approved for, in website order. Shops not approved are not in it. */
export type ShopsState = { order: AffiliateShopId[] }

/** Stored ids → the ordered list the page shows (Amazon first unless placed, then ticked shops in their order). */
export function stateFromStored(shops: readonly AffiliateShopId[]): ShopsState {
  return { order: shopOrder({ affiliateShops: shops.map((shop) => ({ shop })) }).filter((id) => id === 'amazon' || shops.includes(id)) }
}

/** Shops not approved yet, in platform order (Amazon is never in this list). */
export const unapprovedShops = (state: ShopsState): AffiliateShopId[] => AFFILIATE_SHOP_IDS.filter((id) => id !== 'amazon' && !state.order.includes(id))

/** What is saved: the ordered list; Amazon only when it was moved off the first place. */
export function idsToSave(state: ShopsState): AffiliateShopId[] {
  return state.order.filter((id) => id !== 'amazon' || state.order[0] !== 'amazon')
}

/** Ticking adds the shop at the end of the ordered list; unticking takes it out. */
export function toggleApproved(state: ShopsState, id: AffiliateShopId, on: boolean): ShopsState {
  if (id === 'amazon') return state
  const rest = state.order.filter((s) => s !== id)
  return { order: on ? [...rest, id] : rest }
}

export function moveShop(state: ShopsState, id: AffiliateShopId, direction: -1 | 1): ShopsState {
  const from = state.order.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= state.order.length) return state
  const order = [...state.order]
  ;[order[from], order[to]] = [order[to], order[from]]
  return { order }
}

/** Drag-and-drop: move `id` to index `to` of the ordered list. */
export function moveShopTo(state: ShopsState, id: AffiliateShopId, to: number): ShopsState {
  const from = state.order.indexOf(id)
  if (from < 0) return state
  const order = [...state.order]
  const [x] = order.splice(from, 1)
  order.splice(Math.max(0, Math.min(order.length, to)), 0, x)
  return { order }
}
