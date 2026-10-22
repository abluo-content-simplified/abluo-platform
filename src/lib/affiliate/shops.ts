/**
 * Affiliate shops — the PLATFORM list of shops Abluo can make affiliate links for
 * (pure, browser-safe, no React, no network). Plan: claude/affiliate-module-awin-plan-2026-10-22.md
 *
 * A shop belongs to one provider (affiliate network):
 *   - `amazon`: Amazon Associates — one tracking ID per marketplace (amazon-*.ts).
 *   - `awin`:   Awin — one publisher ID per tenant + the shop's Awin advertiser ID (awin-links.ts).
 *
 * Advertiser IDs are the same for every publisher, so they live here, never in
 * tenant data. An advertiser ID of `null` means "not verified yet": that shop is
 * recognised but never gets a tracked link (plain link), so nothing is guessed.
 * Shop names are brand names: never translated.
 */

export const AFFILIATE_SHOP_IDS = ['amazon', 'ibs', 'lafeltrinelli', 'mondadori'] as const
export type AffiliateShopId = (typeof AFFILIATE_SHOP_IDS)[number]
export type AffiliateProvider = 'amazon' | 'awin'

export type AffiliateShop = {
  id: AffiliateShopId
  name: string
  provider: AffiliateProvider
  /** Registrable domains (no subdomain). Any subdomain of these matches (www., m., …). Amazon is matched by amazon-links.ts instead. */
  domains: readonly string[]
  /** Awin advertiser ID (`awinmid`). null = not verified yet → never tracked. */
  awinAdvertiserId: number | null
  /** Where the shop's own "join the programme" page is (shown in Settings). */
  joinUrl?: string
}

export const AFFILIATE_SHOPS: readonly AffiliateShop[] = [
  { id: 'amazon', name: 'Amazon', provider: 'amazon', domains: [], awinAdvertiserId: null },
  // IDs from the shops' own affiliate pages (22 Oct 2026); confirm in the Awin dashboard once approved.
  { id: 'ibs', name: 'IBS', provider: 'awin', domains: ['ibs.it'], awinAdvertiserId: 9777, joinUrl: 'https://www.ibs.it/affiliati/affiliazioni' },
  { id: 'lafeltrinelli', name: 'laFeltrinelli', provider: 'awin', domains: ['lafeltrinelli.it'], awinAdvertiserId: 9647, joinUrl: 'https://www.lafeltrinelli.it/affiliati/affiliazioni' },
  // Mondadori Store's page gives code 86228063, which does not look like an awinmid — set once read in the Awin dashboard.
  { id: 'mondadori', name: 'Mondadori Store', provider: 'awin', domains: ['mondadoristore.it'], awinAdvertiserId: null, joinUrl: 'https://www.mondadoristore.it/affiliazioni' },
]

export const AWIN_SHOPS: readonly AffiliateShop[] = AFFILIATE_SHOPS.filter((s) => s.provider === 'awin')

export const isAffiliateShopId = (v: unknown): v is AffiliateShopId => typeof v === 'string' && (AFFILIATE_SHOP_IDS as readonly string[]).includes(v)
export const shopById = (id: AffiliateShopId): AffiliateShop => AFFILIATE_SHOPS.find((s) => s.id === id)!

/** The Awin shop a host belongs to (exact domain or any subdomain of it), else null. */
export function awinShopForHost(host: string): AffiliateShop | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!h) return null
  return AWIN_SHOPS.find((s) => s.domains.some((d) => h === d || h.endsWith(`.${d}`))) ?? null
}
