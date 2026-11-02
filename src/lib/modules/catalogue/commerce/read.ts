// ── Catalogue commerce — tolerant readers of the NEW stored shapes ────────────
//
// `catalogueFormat`, `cataloguePrice` (+ `catalogueWeeklyWindow`) and
// `catalogueChannelRule` rows → the in-memory model. Total, never throw.
// Legacy `offers[]` are mapped to these doc shapes by legacy-commerce.ts first
// (one mapping for dual-read and migration, C10-3), then read here — so there
// is exactly one reader of each shape.
//
// Reserved price fields (`currency`, `locationKey`) are never read (D7, A5).

import { readChannelRule } from './availability-schedule'
import {
  asChannelKey,
  asFormatKey,
  type AvailabilityIssueCode,
  type ChannelAvailabilityRule,
  type ChannelKey,
  type LocalizedText,
  type WeeklyWindow,
} from './commerce-types'
import type { Format, FormatIdentifiers, QuantityUnit } from './formats'
import type { Price } from './prices'

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Localized text as stored (object) or already resolved by GROQ (string); null when absent/empty. */
export function readText(v: unknown): LocalizedText | null {
  if (typeof v === 'string') return v.trim() ? v : null
  if (!v || typeof v !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith('_') && typeof s === 'string') out[k] = s
  return Object.keys(out).length ? out : null
}

/** One stored window. Null entries are dropped by the caller; non-string times are dropped (never evaluated). */
export function readWindow(raw: unknown): WeeklyWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  return {
    ...(Array.isArray(w.days) ? { days: w.days.filter((d): d is string => typeof d === 'string') } : {}),
    from: nonEmpty(w.from),
    to: nonEmpty(w.to),
  }
}

/**
 * A stored price row → Price, or null when it cannot be a price: no string
 * `_key`, or an amount that is not a finite number ≥ 0 — exactly the rows the
 * legacy website dropped (resolveOffers), so both shapes keep the same set.
 */
export function readPriceDoc(raw: unknown): Price | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p._key !== 'string' || !finite(p.amount) || p.amount < 0) return null
  const channel = nonEmpty(p.channel)
  return {
    key: p._key,
    scope: channel ? asChannelKey(channel) : null,
    amount: p.amount,
    note: readText(p.note),
    windows: (Array.isArray(p.windows) ? p.windows : []).map(readWindow).filter((w): w is WeeklyWindow => w !== null),
  }
}

function readIdentifiers(raw: unknown): FormatIdentifiers {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  return {
    ...(nonEmpty(r.sku) ? { sku: (r.sku as string).trim() } : {}),
    ...(nonEmpty(r.isbn) ? { isbn: (r.isbn as string).trim() } : {}),
    ...(nonEmpty(r.gtin) ? { gtin: (r.gtin as string).trim() } : {}),
  }
}

/** Kept as stored (validated by formatIssues), so an invalid quantity is reported rather than silently dropped. */
function readQuantity(raw: unknown): Format['quantity'] {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Record<string, unknown>
  if (q.value === undefined && q.unit === undefined) return null
  return { value: q.value as number, unit: q.unit as QuantityUnit }
}

/**
 * Availability rows of one level → rules by channel. "Inherit" = no row.
 * Two rows for one channel: identical → one rule + `duplicateChannel`;
 * different → the level is treated as UNSET for that channel +
 * `conflictingRows` (D-21: never an arbitrary winner).
 */
export function readRuleRows(rows: unknown): { rules: Map<ChannelKey, ChannelAvailabilityRule>; issues: AvailabilityIssueCode[] } {
  const rules = new Map<ChannelKey, ChannelAvailabilityRule>()
  const issues: AvailabilityIssueCode[] = []
  const conflicted = new Set<string>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const channel = nonEmpty(r.channel) ?? nonEmpty(r._key)
    if (!channel) continue
    const { rule, issues: ruleIssues } = readChannelRule(row)
    issues.push(...ruleIssues)
    if (!rule) continue
    const key = asChannelKey(channel)
    if (conflicted.has(channel)) continue
    const existing = rules.get(key)
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(rule)) issues.push('availability.duplicateChannel')
      else {
        rules.delete(key)
        conflicted.add(channel)
        issues.push('availability.conflictingRows')
      }
      continue
    }
    rules.set(key, rule)
  }
  return { rules, issues }
}

/** One stored `catalogueFormat` → Format (implicit decided by readFormatDocs). */
export function readFormatDoc(raw: unknown): Format | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f._key !== 'string' || f._key === '') return null
  return {
    key: asFormatKey(f._key),
    label: readText(f.label),
    identifiers: readIdentifiers(f.identifiers),
    quantity: readQuantity(f.quantity),
    templateKey: nonEmpty(f.templateKey),
    availability: readRuleRows(f.channelAvailability).rules,
    prices: (Array.isArray(f.prices) ? f.prices : []).map(readPriceDoc).filter((p): p is Price => p !== null),
    implicit: false,
  }
}

/** Stored `formats[]` → ordered formats; `implicit` = the sole format without a label (I-C3-1). */
export function readFormatDocs(raw: readonly unknown[]): Format[] {
  const formats = raw.map(readFormatDoc).filter((f): f is Format => f !== null)
  return withImplicit(formats)
}

export function withImplicit(formats: Format[]): Format[] {
  const sole = formats.length === 1
  return formats.map((f) => ({ ...f, implicit: sole && f.label === null }))
}
