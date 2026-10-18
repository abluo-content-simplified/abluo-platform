/**
 * Amazon product links — pure, browser-safe, no React, no network.
 *
 * Tenants paste a product link copied from amazon.de / amazon.it (or the
 * Amazon app). This file reads it ({marketplace, asin}), and builds the final
 * clean link (`https://www.amazon.de/dp/<ASIN>` plus `?tag=<id>`). Nothing is
 * ever injected that the tenant did not configure: no Abluo tracking ID.
 *
 * Which marketplace a VISITOR gets is decided elsewhere, from their country
 * (src/lib/modules/catalogue/amazon-delivery.ts), never from the site language.
 */

import { AMAZON_MARKETPLACES, looksLikeTrackingId, type AmazonMarketplace } from './amazon-marketplaces'

export type ParsedAmazonUrl = {
  marketplace: AmazonMarketplace
  asin: string
  /** The `tag` the pasted link carried (probably the tenant's own), when it looks like a tracking ID. */
  tag?: string
}

export type AmazonParseError = 'invalid' | 'not_amazon' | 'short_link' | 'no_product'
export type AmazonParseResult = ({ ok: true } & ParsedAmazonUrl) | { ok: false; error: AmazonParseError }

const ASIN = /^[A-Z0-9]{10}$/
/** Subdomains Amazon links are seen with. Anything else is not treated as Amazon. */
const SUBDOMAINS = new Set(['www', 'smile', 'm'])
/** Path segments after which the ASIN follows (lowercase). */
const ASIN_AFTER = new Set(['dp', 'product', 'asin', 'obidos', 'offer-listing', 'd', '-'])

const SHORT_HOSTS = new Set(['amzn.to', 'amzn.eu', 'amzn.asia', 'amzn.in', 'a.co', 'amzn.com'])

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

function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/\.$/, '')
}

/** `amzn.eu`, `amzn.to`, `a.co`, `amzn.asia` … (the App's "Share" links). */
export function isAmazonShortLink(url: string): boolean {
  const u = toUrl(url)
  if (!u) return false
  const host = hostOf(u)
  // amzn.com/<ASIN> is a legacy product link, not a shortener; only /d/… paths are short links there.
  if (host === 'amzn.com' || host === 'www.amzn.com') return u.pathname.startsWith('/d/')
  return SHORT_HOSTS.has(host.replace(/^www\./, ''))
}

/** The marketplace a host belongs to (`www.`, `smile.`, `m.` allowed), or null. */
export function marketplaceOfHost(host: string): AmazonMarketplace | null {
  const h = host.toLowerCase().replace(/\.$/, '')
  for (const m of AMAZON_MARKETPLACES) {
    const bare = m.host.replace(/^www\./, '')
    if (h === bare) return m.id
    if (h.endsWith(`.${bare}`) && SUBDOMAINS.has(h.slice(0, -(bare.length + 1)))) return m.id
  }
  return null
}

function asinFromPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean)
  for (let i = 0; i < segs.length - 1; i++) {
    if (!ASIN_AFTER.has(segs[i].toLowerCase())) continue
    // /exec/obidos/tg/detail/-/ASIN: skip the words between the marker and the ASIN.
    for (let j = i + 1; j < segs.length && j <= i + 4; j++) {
      const s = segs[j].toUpperCase()
      if (ASIN.test(s)) return s
      if (!['tg', 'detail', '-', 'asin'].includes(segs[j].toLowerCase())) break
    }
  }
  return null
}

export function parseAmazonUrl(url: string): AmazonParseResult {
  const u = toUrl(typeof url === 'string' ? url : '')
  if (!u) return { ok: false, error: 'invalid' }
  if (isAmazonShortLink(u.href)) return { ok: false, error: 'short_link' }
  const marketplace = marketplaceOfHost(hostOf(u))
  if (!marketplace) return { ok: false, error: 'not_amazon' }
  let asin = asinFromPath(u.pathname)
  if (!asin) {
    const q = u.searchParams.get('asin') ?? u.searchParams.get('ASIN')
    const up = q?.trim().toUpperCase()
    if (up && ASIN.test(up)) asin = up
  }
  if (!asin) return { ok: false, error: 'no_product' }
  const tag = u.searchParams.get('tag')?.trim()
  return { ok: true, marketplace, asin, ...(tag && looksLikeTrackingId(tag) ? { tag } : {}) }
}

/**
 * The final link: `https://<host>/dp/<ASIN>` and `?tag=<id>` when there is an ID.
 * Every other parameter of the pasted link (including any existing `tag`) is dropped.
 * With no `trackingId`, the tag that was pasted is kept (probably the tenant's own);
 * without one, the link carries no tag at all.
 */
export function buildAffiliateUrl(parsed: ParsedAmazonUrl, trackingId?: string | null): string {
  const host = AMAZON_MARKETPLACES.find((m) => m.id === parsed.marketplace)!.host
  const id = trackingId?.trim() || parsed.tag
  return `https://${host}/dp/${parsed.asin}${id ? `?tag=${encodeURIComponent(id)}` : ''}`
}

/** True when the pasted text is, or looks like it is meant to be, an Amazon link (marketplace host or short link). */
export function looksLikeAmazon(url: string): boolean {
  const u = toUrl(url)
  return !!u && (isAmazonShortLink(u.href) || marketplaceOfHost(hostOf(u)) !== null)
}
