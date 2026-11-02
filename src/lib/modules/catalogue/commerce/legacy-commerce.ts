// ── Catalogue commerce — legacy offers ⇄ formats (C10-3, C10-4) ───────────────
//
// THE single mapping used by BOTH the dual-read (commerceOf, R1) and the data
// migration (scripts/catalogue/migrate-commerce.mjs, D2) — never two.
//
//   offers[]            → formats[0] = implicit format `_key: 'default'`
//   offer._key          → price._key (same value, D14 identity)
//   offer.channel       → price.channel (absent = standard price)
//   offer.price / priceNote / availability[] → amount / note / windows[] (window `_key`s kept)
//   offer.currency, offer.locationKey → NOT copied; the pre-flight refuses such documents (REVIEW X-14)
//   implied availability ("sold where an offer exists") → explicit rules, baseline only (D-10)
//
// Pure: no I/O, no clock.

import { readFormatDocs, readRuleRows } from './read'
import {
  asChannelKey,
  type AvailabilityIssueCode,
  type ChannelAvailabilityRule,
  type ChannelAvailabilityState,
  type ChannelKey,
} from './commerce-types'
import type { ChannelSet } from './channels'
import type { Format } from './formats'
import { IMPLICIT_FORMAT_KEY } from './format-key'

export type RawLegacyOffer = {
  _key?: unknown
  _type?: unknown
  channel?: unknown
  price?: unknown
  priceNote?: unknown
  availability?: unknown
  currency?: unknown
  locationKey?: unknown
}

export type CatalogueWeeklyWindowDoc = { _key: string; _type: 'catalogueWeeklyWindow'; days?: string[]; from?: string; to?: string }
export type CataloguePriceDoc = { _key: string; _type: 'cataloguePrice'; amount: number; channel?: string; note?: unknown; windows?: CatalogueWeeklyWindowDoc[] }
export type CatalogueChannelRuleDoc = { _key: string; _type: 'catalogueChannelRule'; channel: string; state: ChannelAvailabilityState }
export type CatalogueFormatDoc = { _key: string; _type: 'catalogueFormat'; prices: CataloguePriceDoc[]; label?: unknown; channelAvailability?: CatalogueChannelRuleDoc[] }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** "valid" = exactly what the legacy website kept (resolveOffers): a string `_key` and a finite price ≥ 0. */
export const isValidLegacyOffer = (o: unknown): o is RawLegacyOffer & { _key: string; price: number } =>
  !!o && typeof o === 'object' && typeof (o as RawLegacyOffer)._key === 'string' && finite((o as RawLegacyOffer).price) && ((o as RawLegacyOffer).price as number) >= 0

/** The scope an offer competes in (null = standard). Same rule as offers.ts scopeOf: a channel literally named "default" stays a channel. */
export const legacyScopeOf = (o: RawLegacyOffer): string | null => (typeof o.channel === 'string' && o.channel !== '' ? o.channel : null)

function toWindow(raw: unknown, i: number): CatalogueWeeklyWindowDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const days = Array.isArray(w.days) ? w.days.filter((d): d is string => typeof d === 'string') : []
  return {
    _key: typeof w._key === 'string' && w._key ? w._key : `w${i}`,
    _type: 'catalogueWeeklyWindow',
    ...(days.length ? { days } : {}),
    ...(typeof w.from === 'string' && w.from ? { from: w.from } : {}),
    ...(typeof w.to === 'string' && w.to ? { to: w.to } : {}),
  }
}

function toPrice(o: RawLegacyOffer & { _key: string; price: number }): CataloguePriceDoc {
  const windows = (Array.isArray(o.availability) ? o.availability : []).map(toWindow).filter((w): w is CatalogueWeeklyWindowDoc => w !== null)
  const scope = legacyScopeOf(o)
  const hasNote = typeof o.priceNote === 'string' ? o.priceNote !== '' : !!o.priceNote && typeof o.priceNote === 'object'
  return {
    _key: o._key,
    _type: 'cataloguePrice',
    amount: o.price,
    ...(scope ? { channel: scope } : {}),
    ...(hasNote ? { note: o.priceNote } : {}),
    ...(windows.length ? { windows } : {}),
  }
}

/** Legacy offers → formats. Deterministic: same input → byte-identical output (stable keys, stored order). */
export function legacyOffersToFormats(offers: readonly unknown[] | null | undefined): CatalogueFormatDoc[] {
  const list = (offers ?? []).filter((o) => o !== null && o !== undefined)
  if (list.length === 0) return []
  return [{ _key: IMPLICIT_FORMAT_KEY, _type: 'catalogueFormat', prices: list.filter(isValidLegacyOffer).map(toPrice) }]
}

/** old(item, c) = isSoldOn(offers, c) ≡ ∃ offer with scope c or scope null (time ignored, C10-2). */
export function legacySoldOn(offers: readonly unknown[] | null | undefined, channel: string): boolean {
  return (offers ?? []).some((o) => {
    if (!o || typeof o !== 'object') return false
    const s = legacyScopeOf(o as RawLegacyOffer)
    return s === channel || s === null
  })
}

/**
 * Legacy implied availability → explicit project defaults + item overrides.
 * Decided — Tom 2026-11-02, D-10: "Project default unavailable + explicit
 * available rules for everything the old model considered sold. A migration
 * must never make a new or existing item available through an additional
 * channel." Baseline only — no schedules, no category rules, no format rules.
 */
export function legacyAvailability(
  channelKeys: readonly (ChannelKey | string)[],
  items: readonly { id: string; offers: readonly unknown[] | null | undefined }[],
): { defaults: Record<string, ChannelAvailabilityState>; itemRules: Record<string, Record<string, ChannelAvailabilityState>> } {
  const defaults: Record<string, ChannelAvailabilityState> = {}
  for (const c of channelKeys) defaults[c] = 'unavailable'
  const itemRules: Record<string, Record<string, ChannelAvailabilityState>> = {}
  for (const item of items) {
    const rows: Record<string, ChannelAvailabilityState> = {}
    for (const c of channelKeys) if (legacySoldOn(item.offers, c)) rows[c] = 'available'
    if (Object.keys(rows).length) itemRules[item.id] = rows
  }
  return { defaults, itemRules }
}

/** The stored rows the migration writes for one item (`_key` = channel key, C5-7), in channel order. */
export function legacyItemRuleRows(channelKeys: readonly string[], offers: readonly unknown[] | null | undefined): CatalogueChannelRuleDoc[] {
  return channelKeys.filter((c) => legacySoldOn(offers, c)).map((c) => ({ _key: c, _type: 'catalogueChannelRule', channel: c, state: 'available' }))
}

// ── The D2 data step, as pure functions (C10-6; the script only batches them) ─

/**
 * The commerce patch D2 writes on ONE item document (published and draft get the same function):
 * `formats` from the offers, item rules only in a channel project; `offers` KEPT (additive). null = skip
 * (idempotency guard: `formats` already present, or no offers).
 */
export function migrateCommerceDoc(doc: { formats?: unknown; offers?: unknown }, channelKeys: readonly string[]): { formats: CatalogueFormatDoc[]; channelAvailability?: CatalogueChannelRuleDoc[] } | null {
  if (Array.isArray(doc.formats) && doc.formats.length > 0) return null
  const offers = Array.isArray(doc.offers) ? doc.offers : []
  if (offers.filter((o) => o !== null && o !== undefined).length === 0) return null
  const rows = legacyItemRuleRows(channelKeys, offers)
  return { formats: legacyOffersToFormats(offers), ...(channelKeys.length ? { channelAvailability: rows } : {}) }
}

/** D2 on the project config: every channel entry gains `active: true` and the D-10 default (`unavailable`); entries keep everything else. */
export function migrateChannelEntries(entries: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.map((e) => ({ ...e, active: e.active === false ? false : true, defaultAvailability: e.defaultAvailability === 'available' || e.defaultAvailability === 'unavailable' ? e.defaultAvailability : 'unavailable' }))
}

// ── Pre-flight (C10-6 step P) ─────────────────────────────────────────────────

export type LegacyRefusal =
  | { kind: 'invalidOffer'; key: string | null }
  | { kind: 'unknownChannel'; key: string; channel: string }
  | { kind: 'reservedField'; key: string | null; field: 'currency' | 'locationKey' }

/** Why a document cannot be migrated as-is. Refusals stop the run (D-21); nothing is dropped silently. */
export function legacyOfferRefusals(offers: readonly unknown[] | null | undefined, channelKeys: readonly string[]): LegacyRefusal[] {
  const out: LegacyRefusal[] = []
  for (const raw of offers ?? []) {
    if (raw === null || raw === undefined) continue
    const o = raw as RawLegacyOffer
    const key = typeof o?._key === 'string' ? o._key : null
    if (!isValidLegacyOffer(o)) out.push({ kind: 'invalidOffer', key })
    const scope = o && typeof o === 'object' ? legacyScopeOf(o) : null
    if (scope !== null && !channelKeys.includes(scope)) out.push({ kind: 'unknownChannel', key: key ?? '', channel: scope })
    if (nonEmptyString(o?.currency)) out.push({ kind: 'reservedField', key, field: 'currency' })
    if (nonEmptyString(o?.locationKey)) out.push({ kind: 'reservedField', key, field: 'locationKey' })
  }
  return out
}

// ── Rollback (C10-7) ──────────────────────────────────────────────────────────

/** formats → legacy offers; exact for one format, lossy (listed) otherwise. */
export function formatsToLegacyOffers(formats: readonly CatalogueFormatDoc[]): { offers: Record<string, unknown>[]; lossy: string[] } {
  const lossy: string[] = []
  if (formats.length > 1) lossy.push('multipleFormats')
  if (formats.some((f) => (f.channelAvailability ?? []).length > 0)) lossy.push('formatRules')
  const offers = formats.flatMap((f) =>
    f.prices.map((p) => ({
      _key: p._key,
      _type: 'catalogueOffer',
      ...(p.channel ? { channel: p.channel } : {}),
      price: p.amount,
      ...(p.note !== undefined ? { priceNote: p.note } : {}),
      ...(p.windows?.length ? { availability: p.windows.map((w) => ({ ...w, _type: 'catalogueAvailability' })) } : {}),
    })),
  )
  return { offers, lossy }
}

// ── Dual-read (C10-4) ─────────────────────────────────────────────────────────

export type CommerceSource = 'formats' | 'legacy' | 'empty'
export type CommerceIssue = 'legacy.offersShadowed' | AvailabilityIssueCode

export type Commerce = {
  formats: readonly Format[]
  itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
  source: CommerceSource
  issues: readonly CommerceIssue[]
}

const IMPLICIT_EMPTY: Format = {
  key: IMPLICIT_FORMAT_KEY,
  label: null,
  identifiers: {},
  quantity: null,
  templateKey: null,
  availability: new Map(),
  prices: [],
  implicit: true,
}

/**
 * THE ONLY function that reads an item's commerce fields.
 *
 *   formats present (non-empty) → formats win; non-empty legacy offers alongside → ignored + 'legacy.offersShadowed'
 *   else legacy offers present  → legacyOffersToFormats(offers); item rules derived from them ONLY when the
 *                                 project has channels and no migrated defaults yet (ChannelSet.unmigrated)
 *   else                        → one implicit empty format
 * Stored item rules (`channelAvailability`) are read in every case; legacy derivation applies only when none are stored.
 */
export function commerceOf(raw: { formats?: unknown; offers?: unknown; channelAvailability?: unknown } | null | undefined, channels?: ChannelSet): Commerce {
  const r = raw ?? {}
  const formatsRaw = Array.isArray(r.formats) ? r.formats : []
  const offers = Array.isArray(r.offers) ? r.offers.filter((o) => o !== null && o !== undefined) : []
  const stored = readRuleRows(r.channelAvailability)
  const issues: CommerceIssue[] = [...stored.issues]
  const hasStoredRules = Array.isArray(r.channelAvailability) && r.channelAvailability.length > 0

  if (formatsRaw.length > 0) {
    if (offers.length > 0) issues.push('legacy.offersShadowed')
    const formats = readFormatDocs(formatsRaw)
    return { formats: formats.length ? formats : [IMPLICIT_EMPTY], itemRules: stored.rules, source: 'formats', issues }
  }

  let itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule> = stored.rules
  if (!hasStoredRules && channels && channels.all.length > 0 && channels.unmigrated) {
    const derived = new Map<ChannelKey, ChannelAvailabilityRule>()
    for (const c of channels.all) if (legacySoldOn(offers, c.key)) derived.set(asChannelKey(c.key), { state: 'available', overrides: [] })
    itemRules = derived
  }

  if (offers.length > 0) {
    const formats = readFormatDocs(legacyOffersToFormats(offers))
    return { formats: formats.length ? formats : [IMPLICIT_EMPTY], itemRules, source: 'legacy', issues }
  }
  return { formats: [IMPLICIT_EMPTY], itemRules, source: 'empty', issues }
}
