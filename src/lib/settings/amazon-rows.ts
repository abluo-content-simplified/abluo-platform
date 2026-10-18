/**
 * Settings → Amazon: the pure view-model of the tracking-ID rows (browser-safe,
 * no React). One row = one Amazon store (marketplace) + the client's own
 * Associates tracking ID for it. Suggestions come from the site languages
 * (`suggestedMarketplaces`), but any marketplace can be added.
 */
import {
  AMAZON_MARKETPLACES,
  isAmazonMarketplace,
  looksLikeTrackingId,
  suggestedMarketplaces,
  type AmazonMarketplace,
  type AmazonTrackingId,
} from '@/lib/affiliate/amazon-marketplaces'

export const MAX_AMAZON_ROWS = AMAZON_MARKETPLACES.length
export const MAX_TRACKING_ID_LENGTH = 64

/** A row as the screen holds it: the marketplace may not be chosen yet, the ID may be half typed. */
export type AmazonRow = { key: string; marketplace: AmazonMarketplace | ''; trackingId: string }

export type AmazonRowsError = 'invalid_marketplace' | 'duplicate_marketplace' | 'too_many' | 'invalid_value'

/** Deterministic Sanity array key for a stored row. */
export const rowKeyFor = (marketplace: AmazonMarketplace): string => `amz-${marketplace.replace(/\./g, '-')}`

/** Trimmed, control characters removed. */
export function cleanTrackingId(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''
}

/** Stored rows → screen rows (entries with an unknown marketplace are not shown). */
export function rowsFromStored(stored: ReadonlyArray<Partial<AmazonTrackingId>> | null | undefined): AmazonRow[] {
  const out: AmazonRow[] = []
  for (const s of stored ?? []) {
    if (!isAmazonMarketplace(s?.marketplace) || out.some((r) => r.marketplace === s.marketplace)) continue
    out.push({ key: rowKeyFor(s.marketplace), marketplace: s.marketplace, trackingId: cleanTrackingId(s.trackingId) })
  }
  return out
}

/** Marketplaces suggested by the site languages that have no row yet. */
export function pendingSuggestions(locales: readonly string[], rows: readonly AmazonRow[]): AmazonMarketplace[] {
  const used = new Set(rows.map((r) => r.marketplace))
  return suggestedMarketplaces(locales).filter((m) => !used.has(m))
}

/** Marketplaces a row's picker offers: its own choice plus every one no other row uses. */
export function marketplaceOptions(rows: readonly AmazonRow[], current: AmazonMarketplace | ''): { id: AmazonMarketplace; label: string }[] {
  const taken = new Set(rows.map((r) => r.marketplace).filter((m) => m && m !== current))
  return AMAZON_MARKETPLACES.filter((m) => !taken.has(m.id)).map((m) => ({ id: m.id, label: m.label }))
}

export const marketplaceLabel = (id: string): string => AMAZON_MARKETPLACES.find((m) => m.id === id)?.label ?? id

/** True when every marketplace is already used (nothing left to add). */
export const canAddRow = (rows: readonly AmazonRow[]): boolean => rows.length < MAX_AMAZON_ROWS

/** Appends a row (marketplace given = a quick-add suggestion; none = a blank row to fill in). */
export function addRow(rows: readonly AmazonRow[], marketplace: AmazonMarketplace | '' = ''): AmazonRow[] {
  if (!canAddRow(rows)) return [...rows]
  if (marketplace && rows.some((r) => r.marketplace === marketplace)) return [...rows]
  const taken = new Set(rows.map((r) => r.key))
  let n = rows.length + 1
  let key = marketplace ? rowKeyFor(marketplace) : `new-${n}`
  while (taken.has(key)) key = `new-${++n}`
  return [...rows, { key, marketplace, trackingId: '' }]
}

export const removeRow = (rows: readonly AmazonRow[], key: string): AmazonRow[] => rows.filter((r) => r.key !== key)

export function updateRow(rows: readonly AmazonRow[], key: string, change: Partial<Pick<AmazonRow, 'marketplace' | 'trackingId'>>): AmazonRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...change } : r))
}

/** A marketplace chosen twice (only possible mid-edit; the picker offers each once). */
export function duplicateMarketplaces(rows: readonly AmazonRow[]): AmazonMarketplace[] {
  const seen = new Set<string>()
  const dup = new Set<AmazonMarketplace>()
  for (const r of rows) {
    if (!r.marketplace) continue
    if (seen.has(r.marketplace)) dup.add(r.marketplace)
    seen.add(r.marketplace)
  }
  return [...dup]
}

/** Soft hint only: "name-21" shape. Never blocks saving; empty gives no hint. */
export const trackingIdLooksOff = (v: string): boolean => cleanTrackingId(v) !== '' && !looksLikeTrackingId(cleanTrackingId(v))

/** Rows that are only half filled in (nothing is saved for them yet). */
export const isIncomplete = (r: AmazonRow): boolean => !r.marketplace || cleanTrackingId(r.trackingId) === ''

/**
 * Rows → what is stored. Half-filled rows are left out (a row with no tracking
 * ID, or no marketplace, means nothing to the website). Refuses a marketplace
 * that is not on the list, the same marketplace twice, or an over-long ID.
 * Format is NEVER checked here.
 */
export function toStored(rows: ReadonlyArray<{ marketplace?: unknown; trackingId?: unknown }> | null | undefined):
  | { ok: true; value: Array<Required<Pick<AmazonTrackingId, '_key' | 'marketplace' | 'trackingId'>> & { _type: 'amazonTrackingId' }> }
  | { ok: false; error: AmazonRowsError } {
  if (!Array.isArray(rows)) return { ok: false, error: 'invalid_value' }
  if (rows.length > MAX_AMAZON_ROWS * 2) return { ok: false, error: 'too_many' }
  const value: Array<Required<Pick<AmazonTrackingId, '_key' | 'marketplace' | 'trackingId'>> & { _type: 'amazonTrackingId' }> = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'invalid_value' }
    const trackingId = cleanTrackingId(r.trackingId)
    if (trackingId === '') continue
    if (!isAmazonMarketplace(r.marketplace)) return { ok: false, error: 'invalid_marketplace' }
    if (trackingId.length > MAX_TRACKING_ID_LENGTH) return { ok: false, error: 'invalid_value' }
    if (value.some((v) => v.marketplace === r.marketplace)) return { ok: false, error: 'duplicate_marketplace' }
    value.push({ _type: 'amazonTrackingId', _key: rowKeyFor(r.marketplace), marketplace: r.marketplace, trackingId })
  }
  if (value.length > MAX_AMAZON_ROWS) return { ok: false, error: 'too_many' }
  return { ok: true, value }
}
