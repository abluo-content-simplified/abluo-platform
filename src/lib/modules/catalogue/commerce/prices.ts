// ── Catalogue commerce — the price model (C4; supersedes offers.ts) ───────────
//
// Authority: contract C2-C5-C10 §C4 (Rev 4); ADR-033 D7/A6 (currency), A3
// (non-overlap per scope), A4/K-3 rule 11 (ambiguity is never a pick).
//
// Answers "how much", and only that. A price never activates a channel; a price
// window chooses WHICH price applies and never decides availability; a missing
// price never means unavailable (D-6 independence). Availability enters only
// as an INPUT (displayPrices, priceCoverage) — nothing here reads a schedule.

import { availableSometime } from './availability-schedule'
import {
  type ChannelKey,
  type IssueLevel,
  type LocalizedText,
  type OfferingContext,
  type PriceIssueCode,
  type WeekProfile,
  type WeeklyWindow,
} from './commerce-types'
import type { ChannelSet } from './channels'
import type { FormatAvailabilityMap } from './channel-availability'
import type { Format } from './formats'
import { MINUTES_PER_WEEK, evaluateWindows, windowIssues, windowListRanges, windowsOverlap, type WeekRange } from './windows'

export type Price = {
  /** Sanity `_key` — stable identity (D14), carried over from the legacy offer. */
  key: string
  /** null = STANDARD price; a key = channel-specific price. Never a string sentinel (I-C4-3). */
  scope: ChannelKey | null
  /** ≥ 0, ≤ 2 decimals; 0 = free. */
  amount: number
  /** "per 100 g", "from" — displayed, never parsed. A string when GROQ already resolved it. */
  note: LocalizedText | null
  /** [] = always. */
  windows: readonly WeeklyWindow[]
  // reserved, never read (D7, D14, A5): currency, locationKey
}

export type PriceSource =
  | { kind: 'channel'; channel: ChannelKey; priceKey: string }
  | { kind: 'standard'; priceKey: string; fallbackFrom: ChannelKey | null }

export type PriceResolution =
  | { kind: 'price'; price: Price; source: PriceSource; currency: string }
  | { kind: 'noPrice'; reason: 'noPrices' | 'outsideWindows' }
  | { kind: 'ambiguous'; scope: ChannelKey | null; priceKeys: string[] }
  | { kind: 'indeterminate'; reason: 'timeZoneMissing' }

export type { FormatAvailabilityMap } from './channel-availability'

/** project.currency, full stop (D7/A6). `price.currency` is never read. */
export function effectiveCurrency(project: { currency: string }): string {
  return project.currency
}

const activeChannel = (channels: ChannelSet, key: ChannelKey) => channels.byKey.get(key)?.active === true

/**
 * The price of ONE format in ONE context at ONE instant. Knows nothing about availability.
 * 'channel' c: (1) channel prices of c applying at instant: 1 → price; ≥2 → ambiguous{c} (never falls through);
 *              (2) otherwise standard prices applying: 1 → price{standard, fallbackFrom: c}; ≥2 → ambiguous{null};
 *              (3) otherwise noPrice ('noPrices' when the format has no standard and no c price at all).
 * 'general': step 2 only. Prices of an inactive or unknown channel are never candidates.
 * A windowed candidate with timeZone === null → indeterminate (checked before counting, never guessed — A8).
 */
export function resolvePrice(
  format: Pick<Format, 'prices'>,
  ctx: OfferingContext,
  instant: Date,
  timeZone: string | null,
  channels: ChannelSet,
  project: { currency: string },
): PriceResolution {
  const currency = effectiveCurrency(project)
  const steps: (ChannelKey | null)[] = ctx.kind === 'channel' ? [ctx.channel, null] : [null]
  let anyCandidate = false
  for (const scope of steps) {
    if (scope !== null && !activeChannel(channels, scope)) continue
    const candidates = format.prices.filter((p) => p.scope === scope)
    if (candidates.length === 0) continue
    anyCandidate = true
    if (timeZone === null && candidates.some((p) => p.windows.length > 0)) return { kind: 'indeterminate', reason: 'timeZoneMissing' }
    const applying = candidates.filter((p) => p.windows.length === 0 || evaluateWindows(p.windows, instant, timeZone!) === 'inWindow')
    if (applying.length > 1) return { kind: 'ambiguous', scope, priceKeys: applying.map((p) => p.key) }
    if (applying.length === 1) {
      const price = applying[0]
      const source: PriceSource =
        scope === null
          ? { kind: 'standard', priceKey: price.key, fallbackFrom: ctx.kind === 'channel' ? ctx.channel : null }
          : { kind: 'channel', channel: scope, priceKey: price.key }
      return { kind: 'price', price, source, currency }
    }
  }
  return { kind: 'noPrice', reason: anyCandidate ? 'outsideWindows' : 'noPrices' }
}

/**
 * Instant-free: the prices a PUBLIC page lists for a format, stored order:
 *   - a standard price iff the format is available at SOME time of the week in ≥ 1 public context
 *     (always true when ChannelSet.none — the general context is constant available);
 *   - a channel price iff its channel is active AND the format is available on it at some time.
 * A breakfast-only dish keeps its listed price at 16:00 (D-6). Windows are carried, not rendered in R1 (REVIEW C-2).
 *
 * R1 dual-read (C10-5 E6): while the channel set is UNMIGRATED every stored price is listed, in stored
 * order — exactly the pre-R1 website (`resolveOffers` listed every valid offer, whatever its channel,
 * including one scoped to a channel no longer configured). The rules above apply once the data
 * migration has written explicit channel defaults.
 */
export function displayPrices(format: Pick<Format, 'prices'>, availability: FormatAvailabilityMap, channels: ChannelSet): readonly Price[] {
  if (channels.unmigrated) return format.prices
  const sometime = (ctx: 'general' | ChannelKey) => {
    const e = availability.get(ctx)
    return e ? availableSometime(e.rule) : false
  }
  const standardListed = [...availability.values()].some((e) => availableSometime(e.rule))
  return format.prices.filter((p) => (p.scope === null ? standardListed : activeChannel(channels, p.scope) && sometime(p.scope)))
}

export type PriceCoverage = { kind: 'full' } | { kind: 'partial'; gaps: { start: number; end: number }[] } | { kind: 'none' }

const merge = (ranges: WeekRange[]): WeekRange[] => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: WeekRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

const subtract = (from: WeekRange[], cut: WeekRange[]): WeekRange[] => {
  let out = from.map((r) => ({ ...r }))
  for (const c of cut) {
    out = out.flatMap((r) => {
      if (c.end <= r.start || c.start >= r.end) return [r]
      const parts: WeekRange[] = []
      if (c.start > r.start) parts.push({ start: r.start, end: c.start })
      if (c.end < r.end) parts.push({ start: c.end, end: r.end })
      return parts
    })
  }
  return out
}

/**
 * Static coverage for readiness (C6): does some price apply at every minute of the week AT WHICH THE FORMAT IS
 * AVAILABLE in this context? Gaps only inside available minutes (a breakfast item priced 07:00–11:00 is 'full').
 * 'none' = no candidate price ever applies at an available minute. A format never available is 'full' (nothing to price).
 */
export function priceCoverage(format: Pick<Format, 'prices'>, ctx: OfferingContext, channels: ChannelSet, availability: WeekProfile): PriceCoverage {
  const available = merge(availability.filter((p) => p.state === 'available').map((p) => ({ start: p.start, end: p.end })))
  if (available.length === 0) return { kind: 'full' }
  const candidates = format.prices.filter((p) => p.scope === null || (ctx.kind === 'channel' && p.scope === ctx.channel && activeChannel(channels, p.scope)))
  const covered = merge(candidates.flatMap((p) => windowListRanges(p.windows)))
  const gaps = subtract(available, covered)
  const availableTotal = available.reduce((n, r) => n + r.end - r.start, 0)
  const gapTotal = gaps.reduce((n, r) => n + r.end - r.start, 0)
  if (gapTotal === 0) return { kind: 'full' }
  if (gapTotal === availableTotal) return { kind: 'none' }
  return { kind: 'partial', gaps }
}

export type PriceIssue = { code: PriceIssueCode; level: IssueLevel; keys: string[]; scope?: ChannelKey | null }

/** Save-time validation (supersedes offerIssues). */
export function priceIssues(format: Pick<Format, 'prices'>, channels: ChannelSet): PriceIssue[] {
  const out: PriceIssue[] = []
  for (const p of format.prices) {
    if (!Number.isFinite(p.amount) || p.amount < 0) out.push({ code: 'price.amountInvalid', level: 'error', keys: [p.key] })
    else if (Math.round(p.amount * 100) !== Number((p.amount * 100).toFixed(4))) out.push({ code: 'price.tooManyDecimals', level: 'error', keys: [p.key] })
    if (p.scope !== null) {
      const c = channels.byKey.get(p.scope)
      if (!c) out.push({ code: 'price.unknownChannel', level: 'error', keys: [p.key], scope: p.scope })
      else if (!c.active) out.push({ code: 'price.inactiveChannel', level: 'warning', keys: [p.key], scope: p.scope })
    }
    for (const w of p.windows) {
      for (const i of windowIssues(w)) {
        const code: PriceIssueCode =
          i.kind === 'invalidTime' ? 'price.windowInvalidTime' : i.kind === 'incompleteWindow' ? 'price.windowIncomplete' : i.kind === 'zeroLengthWindow' ? 'price.windowZeroLength' : 'price.windowUnknownDay'
        out.push({ code, level: 'error', keys: [p.key] })
      }
    }
  }
  const byScope = new Map<ChannelKey | null, Price[]>()
  for (const p of format.prices) byScope.set(p.scope, [...(byScope.get(p.scope) ?? []), p])
  for (const [scope, bucket] of byScope) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (windowsOverlap(bucket[i].windows, bucket[j].windows)) out.push({ code: 'price.overlap', level: 'error', keys: [bucket[i].key, bucket[j].key], scope })
      }
    }
  }
  return out
}

export const WHOLE_WEEK: WeekProfile = [{ start: 0, end: MINUTES_PER_WEEK, state: 'available' }]
