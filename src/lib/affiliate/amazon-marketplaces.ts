/**
 * Amazon Associates marketplaces (shared contract).
 *
 * One tracking ID per marketplace, configured once per project in the tenant
 * dashboard's Settings (stored on siteConfig as `amazonTrackingIds`).
 * Website language and marketplace are separate concepts: a marketplace is
 * chosen from the visitor's COUNTRY (see `countries`), never from the locale.
 */

export const AMAZON_MARKETPLACES = [
  { id: 'amazon.it', host: 'www.amazon.it', label: 'Amazon.it', countries: ['IT', 'SM', 'VA'], suggestFor: ['it'] },
  { id: 'amazon.de', host: 'www.amazon.de', label: 'Amazon.de', countries: ['DE', 'AT', 'LI'], suggestFor: ['de'] },
  { id: 'amazon.fr', host: 'www.amazon.fr', label: 'Amazon.fr', countries: ['FR', 'MC', 'LU'], suggestFor: ['fr'] },
  { id: 'amazon.es', host: 'www.amazon.es', label: 'Amazon.es', countries: ['ES', 'AD'], suggestFor: ['es'] },
  { id: 'amazon.nl', host: 'www.amazon.nl', label: 'Amazon.nl', countries: ['NL'], suggestFor: ['nl'] },
  { id: 'amazon.com.be', host: 'www.amazon.com.be', label: 'Amazon.com.be', countries: ['BE'], suggestFor: [] },
  { id: 'amazon.se', host: 'www.amazon.se', label: 'Amazon.se', countries: ['SE'], suggestFor: ['sv'] },
  { id: 'amazon.pl', host: 'www.amazon.pl', label: 'Amazon.pl', countries: ['PL'], suggestFor: ['pl'] },
  { id: 'amazon.co.uk', host: 'www.amazon.co.uk', label: 'Amazon.co.uk', countries: ['GB', 'IE', 'GG', 'JE', 'IM'], suggestFor: [] },
  { id: 'amazon.com', host: 'www.amazon.com', label: 'Amazon.com', countries: ['US'], suggestFor: [] },
  { id: 'amazon.ca', host: 'www.amazon.ca', label: 'Amazon.ca', countries: ['CA'], suggestFor: [] },
  { id: 'amazon.com.mx', host: 'www.amazon.com.mx', label: 'Amazon.com.mx', countries: ['MX'], suggestFor: [] },
  { id: 'amazon.com.br', host: 'www.amazon.com.br', label: 'Amazon.com.br', countries: ['BR'], suggestFor: ['pt-BR'] },
  { id: 'amazon.co.jp', host: 'www.amazon.co.jp', label: 'Amazon.co.jp', countries: ['JP'], suggestFor: ['ja'] },
  { id: 'amazon.com.au', host: 'www.amazon.com.au', label: 'Amazon.com.au', countries: ['AU', 'NZ'], suggestFor: [] },
  { id: 'amazon.in', host: 'www.amazon.in', label: 'Amazon.in', countries: ['IN'], suggestFor: [] },
] as const

export type AmazonMarketplace = (typeof AMAZON_MARKETPLACES)[number]['id']

/** One row in Settings: a marketplace and the tenant's own tracking ID for it (e.g. "tmz01-21"). */
export type AmazonTrackingId = { _key?: string; marketplace: AmazonMarketplace; trackingId: string }

export const AMAZON_MARKETPLACE_IDS: readonly AmazonMarketplace[] = AMAZON_MARKETPLACES.map((m) => m.id)

export function isAmazonMarketplace(v: unknown): v is AmazonMarketplace {
  return typeof v === 'string' && (AMAZON_MARKETPLACE_IDS as readonly string[]).includes(v)
}

/** Tracking IDs look like "name-21": letters, digits and hyphens, 3–64 chars. Soft check only. */
export function looksLikeTrackingId(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{1,62}[A-Za-z0-9]$/.test(v.trim())
}

/** Marketplaces suggested for a project's website languages (a suggestion, never a rule). */
export function suggestedMarketplaces(locales: readonly string[]): AmazonMarketplace[] {
  return AMAZON_MARKETPLACES.filter((m) => locales.some((l) => (m.suggestFor as readonly string[]).includes(l))).map((m) => m.id)
}
