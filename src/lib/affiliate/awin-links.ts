/**
 * Awin links — pure, browser-safe, no React, no network.
 *
 * The tenant pastes an ordinary product URL (e.g. https://www.ibs.it/…). We keep
 * it as stored and build the tracked link on read:
 *   https://www.awin1.com/cread.php?awinmid=<advertiser>&awinaffid=<publisher>&ued=<encoded product URL>
 * (Awin's documented deep-link format.) An Awin link the tenant pasted
 * (awin1.com/cread.php?…&ued=…) is read back to its product URL, so the shop is
 * still recognised and the tenant's own publisher ID can replace the pasted one.
 * Abluo never adds an ID the tenant did not configure.
 */

import { awinShopForHost, type AffiliateShop } from './shops'

const AWIN_HOSTS = new Set(['awin1.com', 'www.awin1.com'])
/** Tracking/campaign parameters removed from the product URL (never needed to show the product). */
const DROP_PARAM = /^(utm_.+|gclid|gbraid|wbraid|fbclid|msclkid|awc|awin.*|sv1|sv_campaign_id|sv_tax.*|_ga|mc_.+)$/i

function toUrl(input: string): URL | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** An Awin publisher ID: digits only (Awin IDs are numeric), 3–10 long. */
export function looksLikeAwinPublisherId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{3,10}$/.test(v.trim())
}

export type ParsedAwinUrl = {
  shop: AffiliateShop
  /** Clean product URL (https, tracking parameters removed, no fragment). */
  productUrl: string
  /** Publisher ID carried by a pasted Awin link, when it looks valid. */
  pastedPublisherId?: string
}

/** Reads a pasted URL as a product of a known Awin shop (directly or wrapped in an Awin link), else null. */
export function parseAwinUrl(input: string): ParsedAwinUrl | null {
  const u = toUrl(input)
  if (!u) return null
  let pastedPublisherId: string | undefined
  let target = u
  if (AWIN_HOSTS.has(u.hostname.toLowerCase()) && u.pathname.toLowerCase() === '/cread.php') {
    const ued = u.searchParams.get('ued') ?? u.searchParams.get('p')
    const inner = ued ? toUrl(ued) : null
    if (!inner) return null
    const aff = u.searchParams.get('awinaffid')
    if (looksLikeAwinPublisherId(aff)) pastedPublisherId = aff!.trim()
    target = inner
  }
  const shop = awinShopForHost(target.hostname)
  if (!shop) return null
  const clean = new URL(target.toString())
  clean.protocol = 'https:'
  clean.hash = ''
  for (const k of [...clean.searchParams.keys()]) if (DROP_PARAM.test(k)) clean.searchParams.delete(k)
  return { shop, productUrl: clean.toString(), ...(pastedPublisherId ? { pastedPublisherId } : {}) }
}

/** The Awin deep link for one product. */
export function buildAwinUrl(advertiserId: number, publisherId: string, productUrl: string): string {
  return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${encodeURIComponent(publisherId.trim())}&ued=${encodeURIComponent(productUrl)}`
}
