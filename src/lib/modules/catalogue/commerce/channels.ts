// ── Catalogue commerce — the channel model (C2) ───────────────────────────────
//
// Authority: contract C2-C5-C10 §C2 (Rev 4); Tom D-1, D-5, D-21.
//
// Channels stay in the Catalogue module configuration
// (`moduleInstallations[catalogue].config.serviceChannels`, `value` = the
// stable key). Each entry may carry `active`, `defaultAvailability` and
// `defaultSchedule`; read defaults for entries written before this contract:
//   active absent              ⇒ true
//   defaultAvailability absent ⇒ 'unavailable'  (never silently available, brief §27)
//   defaultSchedule absent     ⇒ []
// A project whose entries lack an explicit `defaultAvailability` is
// UNMIGRATED (C10-4): commerceOf then derives item rules from legacy offers so
// behaviour is the old one before the data migration runs.

import { readSchedule, scheduleIssues } from './availability-schedule'
import {
  CHANNEL_LIMIT,
  asChannelKey,
  isChannelAvailabilityState,
  type ChannelAvailabilityRule,
  type ChannelAvailabilityState,
  type ChannelIssueCode,
  type ChannelKey,
  type IssueLevel,
  type Locale,
  type LocalizedText,
  type OfferingContext,
  type ScheduledOverride,
  type AvailabilityIssueCode,
} from './commerce-types'
import { readFormatDocs } from './read'
import { legacyOffersToFormats } from './legacy-commerce'

export const CHANNEL_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const CHANNEL_KEY_MAX = 40

export type Channel = {
  key: ChannelKey
  /** Required in the site default locale. A string when GROQ already resolved it for the request locale. */
  label: LocalizedText
  /** Inactive = hidden from editors and from every public/derived output. */
  active: boolean
  /** Baseline of the PROJECT DEFAULT rule for this channel (C5 level 0). */
  defaultAvailability: ChannelAvailabilityState
  /** Optional weekly overrides of that baseline (C5a); [] = baseline all week. */
  defaultSchedule: readonly ScheduledOverride[]
  /** The config entry's Sanity `_key` (identity for keyImmutable); null when not stored/projected. */
  entryKey: string | null
  /** True when `defaultAvailability` was stored explicitly (false = read default of a legacy entry). */
  explicitDefault: boolean
}

/** Normalised, ordered, read-only view used by every resolver. */
export type ChannelSet = {
  all: readonly Channel[]
  active: readonly Channel[]
  byKey: ReadonlyMap<ChannelKey, Channel>
  /** true when no ACTIVE channel exists → the website is in the 'general' context (K-3 rule 7). */
  none: boolean
  /** true when some entry lacks an explicit defaultAvailability (C10-4 transition: legacy derivation applies). */
  unmigrated: boolean
}

export type ChannelIssue = { code: ChannelIssueCode | AvailabilityIssueCode; level: IssueLevel; key?: string; index?: number; usage?: ChannelUsage }

export const channelDefaultRule = (c: Channel): ChannelAvailabilityRule => ({ state: c.defaultAvailability, overrides: c.defaultSchedule })

export function channelSetOf(channels: readonly Channel[]): ChannelSet {
  const active = channels.filter((c) => c.active)
  return {
    all: channels,
    active,
    byKey: new Map(channels.map((c) => [c.key, c])),
    none: active.length === 0,
    unmigrated: channels.some((c) => !c.explicitDefault),
  }
}

export const EMPTY_CHANNELS: ChannelSet = channelSetOf([])

export const isValidChannelKey = (k: unknown): k is string => typeof k === 'string' && k.length <= CHANNEL_KEY_MAX && CHANNEL_KEY_PATTERN.test(k)

/**
 * True when the raw `serviceChannels` list is UNMIGRATED (C10-4): some entry lacks an explicit
 * `defaultAvailability`. Same rule as ChannelSet.unmigrated, decided on the raw entries so the
 * reader knows which key rule applies before any entry is read.
 */
export function rawChannelsUnmigrated(raw: unknown): boolean {
  return (Array.isArray(raw) ? raw : []).some((e) => !!e && typeof e === 'object' && !isChannelAvailabilityState((e as Record<string, unknown>).defaultAvailability))
}

/**
 * One stored/projected entry → Channel, or null when malformed.
 *
 * Key rule: migrated / new data must match CHANNEL_KEY_PATTERN. While the channel set is UNMIGRATED
 * (`legacy: true`, R1 dual-read) an entry without an explicit default keeps ANY non-empty `value`,
 * exactly as the pre-R1 vocabulary reader did — R1 is byte-identical for legacy data, and the D2
 * preflight refuses non-conforming values before the migration writes explicit defaults.
 */
export function readChannelEntry(raw: unknown, opts: { legacy?: boolean } = {}): Channel | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const legacyValue = opts.legacy === true && !isChannelAvailabilityState(e.defaultAvailability) && typeof e.value === 'string' && e.value.trim() !== ''
  if (!legacyValue && !isValidChannelKey(e.value)) return null
  const label: LocalizedText =
    typeof e.label === 'string'
      ? e.label
      : e.label && typeof e.label === 'object'
        ? Object.fromEntries(Object.entries(e.label as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string')) as Record<string, string>
        : {}
  const explicitDefault = isChannelAvailabilityState(e.defaultAvailability)
  return {
    key: asChannelKey(e.value as string),
    label,
    active: e.active !== false,
    defaultAvailability: explicitDefault ? (e.defaultAvailability as ChannelAvailabilityState) : 'unavailable',
    defaultSchedule: readSchedule(e.defaultSchedule).overrides,
    entryKey: typeof e._key === 'string' ? e._key : null,
    explicitDefault,
  }
}

/** Raw module config value (`serviceChannels`) → ChannelSet. Total: never throws; malformed entries are dropped and reported. */
export function readChannels(raw: unknown): { channels: ChannelSet; issues: ChannelIssue[] } {
  const issues: ChannelIssue[] = []
  const out: Channel[] = []
  const seen = new Set<string>()
  const legacy = rawChannelsUnmigrated(raw)
  ;(Array.isArray(raw) ? raw : []).forEach((entry, index) => {
    const c = readChannelEntry(entry, { legacy })
    if (!c || seen.has(c.key)) {
      issues.push({ code: 'channel.malformedEntry', level: 'warning', index, ...(c ? { key: c.key } : {}) })
      return
    }
    seen.add(c.key)
    out.push(c)
  })
  return { channels: channelSetOf(out), issues }
}

/** Which contexts a public caller must iterate: the active channels, or exactly [general] when none. */
export function publicContexts(channels: ChannelSet): readonly OfferingContext[] {
  return channels.none ? [{ kind: 'general' }] : channels.active.map((c) => ({ kind: 'channel' as const, channel: c.key }))
}

// ── Usage (deletion guard, I-C2-2) ────────────────────────────────────────────

export type ChannelUsage = { prices: number; itemRules: number; formatRules: number; categoryRules: number }

/** Every document version that may name a channel: item docs (drafts included) and category rule rows. */
export type CommerceUsageInput = {
  items: readonly { formats?: unknown; offers?: unknown; channelAvailability?: unknown }[]
  categories?: readonly { channelRules?: unknown }[]
}

const rowsNaming = (rows: unknown, key: string) =>
  (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && ((r as { channel?: unknown }).channel === key || (r as { _key?: unknown })._key === key)).length

/** Counts every price row and availability row (items, formats, categories) that names `key`, drafts included. */
export function channelUsage(key: ChannelKey, docs: CommerceUsageInput): ChannelUsage {
  const usage: ChannelUsage = { prices: 0, itemRules: 0, formatRules: 0, categoryRules: 0 }
  for (const item of docs.items) {
    // Both shapes count: a stored `offers[]` row naming the channel is as real as a price row.
    const formatsRaw = Array.isArray(item.formats) ? item.formats : []
    const formats = readFormatDocs(formatsRaw.length ? formatsRaw : legacyOffersToFormats(Array.isArray(item.offers) ? item.offers : []))
    for (const f of formats) {
      usage.prices += f.prices.filter((p) => p.scope === key).length
    }
    for (const raw of formatsRaw) usage.formatRules += rowsNaming((raw as { channelAvailability?: unknown })?.channelAvailability, key)
    usage.itemRules += rowsNaming(item.channelAvailability, key)
  }
  for (const c of docs.categories ?? []) usage.categoryRules += rowsNaming(c.channelRules, key)
  return usage
}

const used = (u: ChannelUsage) => u.prices + u.itemRules + u.formatRules + u.categoryRules > 0

/** Save-time validation of a whole proposed list against the previously stored list. */
export function channelListIssues(
  next: readonly Channel[],
  previous: readonly Channel[],
  ctx: { defaultLocale: Locale; usage?: CommerceUsageInput },
): ChannelIssue[] {
  const out: ChannelIssue[] = []
  if (next.length > CHANNEL_LIMIT) out.push({ code: 'channel.limitExceeded', level: 'error' })
  const seen = new Set<string>()
  next.forEach((c, index) => {
    if (!isValidChannelKey(c.key)) out.push({ code: 'channel.keyInvalid', level: 'error', key: c.key, index })
    if (seen.has(c.key)) out.push({ code: 'channel.keyDuplicate', level: 'error', key: c.key, index })
    seen.add(c.key)
    const label = typeof c.label === 'string' ? c.label : c.label[ctx.defaultLocale]
    if (!label || !label.trim()) out.push({ code: 'channel.labelMissing', level: 'error', key: c.key, index })
    if (!isChannelAvailabilityState(c.defaultAvailability)) out.push({ code: 'channel.defaultAvailabilityInvalid', level: 'error', key: c.key, index })
    for (const s of scheduleIssues(channelDefaultRule(c))) out.push({ code: s.code, level: s.level, key: c.key, index })
    const before = c.entryKey ? previous.find((p) => p.entryKey === c.entryKey) : undefined
    if (before && before.key !== c.key) out.push({ code: 'channel.keyImmutable', level: 'error', key: before.key, index })
  })
  if (ctx.usage) {
    const nextKeys = new Set(next.map((c) => c.key as string))
    for (const p of previous) {
      if (nextKeys.has(p.key)) continue
      // A renamed entry is already refused as keyImmutable; usage is still reported for the old key.
      const usage = channelUsage(p.key, ctx.usage)
      if (used(usage)) out.push({ code: 'channel.deleteReferenced', level: 'error', key: p.key, usage })
    }
  }
  return out
}
