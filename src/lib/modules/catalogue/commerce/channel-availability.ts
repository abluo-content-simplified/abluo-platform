// ── Catalogue commerce — the availability resolver (C5) ───────────────────────
//
// Authority: contract C2-C5-C10 §C5 / §C5a (Rev 4); ADR-033 K-3 rule 4;
// Tom D-4, D-6 (replace, never merge — D-6.1), D-21.
//
// For a channel c, format f, item i, ONE complete rule is chosen, then evaluated:
//   L0 project default   { state: channel.defaultAvailability, overrides: channel.defaultSchedule } — always defined
//   L1 primary category  C1 categoryChannelRule(tree, primary, c) — C1's single implementation, injected
//   L2 item rule         i.itemRules.get(c)
//   L3 format rule       f.availability.get(c)   (never on an implicit format, I-C3-4)
// The HIGHEST level with a rule wins, completely: nothing from a lower level survives.
//
// Additional categories and collections are NOT inputs (K-3 rule 5, D-6.2).
// Availability never reads prices (I-C5-6). Instant-free outputs carry no
// "now"; instant-based outputs carry `at`, `timeZone`, `nextTransition`.
//
// C1 (taxonomy/tree.ts) owns the category walk. Its two functions reach the
// resolver through `AvailabilityInputs.category` (CATEGORY_RULES = the real
// ones); a caller without a loaded taxonomy passes TAXONOMY_NOT_LOADED (no
// category level — exactly the pre-taxonomy behaviour).

import {
  availableSometime,
  evaluateRule,
  nextAvailabilityTransition,
  overrideEndsAt,
  readChannelRule,
  ruleFromProfile,
  scheduleIssues,
  unionProfile,
  weekProfile,
  type AvailableNow,
} from './availability-schedule'
import { channelDefaultRule, type ChannelSet } from './channels'
import type {
  AvailabilityIssueCode,
  ChannelAvailabilityRule,
  ChannelAvailabilityState,
  ChannelKey,
  FormatKey,
  IssueLevel,
  OfferingContext,
  ScheduledOverride,
  WeekProfile,
} from './commerce-types'
import type { Format } from './formats'
import { categoryChannelRule, primaryPath } from '../taxonomy/tree'
import type { CategoryKey, CategoryTree } from '../taxonomy/types'

export type { AvailableNow } from './availability-schedule'

/** C1's two functions, injected (see header). */
export type CategoryRuleLookup = { categoryChannelRule: typeof categoryChannelRule; primaryPath: typeof primaryPath }

/** The real C1 category level (taxonomy/tree.ts). */
export const CATEGORY_RULES: CategoryRuleLookup = { categoryChannelRule, primaryPath }

export type AvailabilityInputs = {
  /** C2 — each active channel carries its default rule (baseline + optional schedule). */
  channels: ChannelSet
  /** C1 buildTree() over the project's catalogueTaxonomy categories. */
  tree: CategoryTree
  /** C1 categoryChannelRule + primaryPath (owner: C1). */
  category: CategoryRuleLookup
}

export const EMPTY_TREE: CategoryTree = {
  nodes: new Map(),
  roots: [],
  childrenOf: new Map(),
  parentOf: new Map(),
  depthOf: new Map(),
  issues: [],
}

/**
 * The category level when the project's taxonomy is not loaded (R1: no
 * category rules exist anywhere — C10-3 "No category rules are written").
 * Not tree logic: it contributes nothing and reports no path.
 */
export const TAXONOMY_NOT_LOADED: CategoryRuleLookup = {
  categoryChannelRule: () => ({ rule: 'inherit', sourceKey: null }),
  primaryPath: () => ({ kind: 'none' }),
}

export const availabilityInputsOf = (channels: ChannelSet, taxonomy?: { tree: CategoryTree; category: CategoryRuleLookup } | null): AvailabilityInputs => ({
  channels,
  tree: taxonomy?.tree ?? EMPTY_TREE,
  category: taxonomy?.category ?? TAXONOMY_NOT_LOADED,
})

export type ItemAvailabilityInput = {
  itemId: string
  /** additionalCategories deliberately NOT an input (K-3 rule 5). */
  primaryCategory: CategoryKey | null
  itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
  formats: readonly Pick<Format, 'key' | 'availability' | 'implicit'>[]
}

export type AvailabilitySource =
  | { level: 'noChannels' }
  | { level: 'channelInactive' }
  | { level: 'projectDefault'; channel: ChannelKey }
  | { level: 'category'; channel: ChannelKey; categoryKey: CategoryKey; path: readonly CategoryKey[]; inheritedFromAncestor: boolean }
  | { level: 'item'; channel: ChannelKey }
  | { level: 'format'; channel: ChannelKey; formatKey: FormatKey }
  | { level: 'anyChannel'; channels: readonly ChannelKey[] }

/** Instant-free: WHICH complete rule governs (format, context) and where it comes from. */
export type EffectiveRule = {
  rule: ChannelAvailabilityRule
  source: AvailabilitySource
  /** The complete upstream rule "Use category default" would restore (null when the source is already inherited). */
  inherited: { rule: ChannelAvailabilityRule; source: AvailabilitySource } | null
  issues: readonly AvailabilityIssueCode[]
}

/** At an instant. */
export type AvailabilityExplanation = EffectiveRule & {
  state: ChannelAvailabilityState
  /** The override in force at the instant, or null when the baseline applies. `endsAt` null = it never ends (covers the week). */
  activeOverride: { key: string; kind: ScheduledOverride['kind']; endsAt: Date | null } | null
  /** First instant > `at` at which `state` differs; null = never changes. */
  nextTransition: Date | null
  at: Date
  timeZone: string
}

export type FormatAvailabilityMap = ReadonlyMap<'general' | ChannelKey, EffectiveRule>

const CONSTANT_AVAILABLE: ChannelAvailabilityRule = { state: 'available', overrides: [] }
const CONSTANT_UNAVAILABLE: ChannelAvailabilityRule = { state: 'unavailable', overrides: [] }

function channelRule(inputs: AvailabilityInputs, item: ItemAvailabilityInput, formatKey: FormatKey, channel: ChannelKey): EffectiveRule {
  const ch = inputs.channels.byKey.get(channel)
  if (!ch || !ch.active) {
    return { rule: CONSTANT_UNAVAILABLE, source: { level: 'channelInactive' }, inherited: null, issues: ch ? [] : ['availability.unknownChannel'] }
  }
  const issues: AvailabilityIssueCode[] = []
  const levels: { rule: ChannelAvailabilityRule; source: AvailabilitySource }[] = [{ rule: channelDefaultRule(ch), source: { level: 'projectDefault', channel } }]

  const path = inputs.category.primaryPath(inputs.tree, item.primaryCategory)
  if (path.kind === 'broken') issues.push('availability.primaryCategoryBroken')
  const cat = inputs.category.categoryChannelRule(inputs.tree, item.primaryCategory, channel)
  if (cat.rule !== 'inherit' && cat.sourceKey !== null) {
    levels.push({
      rule: cat.rule,
      source: {
        level: 'category',
        channel,
        categoryKey: cat.sourceKey,
        path: path.kind === 'none' ? [] : path.keys,
        inheritedFromAncestor: cat.sourceKey !== item.primaryCategory,
      },
    })
  }
  const itemRule = item.itemRules.get(channel)
  if (itemRule) levels.push({ rule: itemRule, source: { level: 'item', channel } })
  const format = item.formats.find((f) => f.key === formatKey)
  const formatRule = format && !format.implicit ? format.availability.get(channel) : undefined
  if (formatRule) levels.push({ rule: formatRule, source: { level: 'format', channel, formatKey } })

  const top = levels[levels.length - 1]
  const upstream = levels.length >= 2 ? levels[levels.length - 2] : null
  const inherited = top.source.level === 'item' || top.source.level === 'format' ? upstream : null
  return { rule: top.rule, source: top.source, inherited, issues }
}

/**
 * Instant-free: which complete rule governs, with its source.
 *   'channel' → the complete rule chosen by C5-3.
 *   'general' → ChannelSet.none: constant available (noChannels); otherwise the ANY-CHANNEL UNION — a synthetic
 *               rule whose weekProfile is available wherever ≥ 1 active channel's effective rule is (anyChannel).
 */
export function effectiveRule(inputs: AvailabilityInputs, item: ItemAvailabilityInput, formatKey: FormatKey, ctx: OfferingContext): EffectiveRule {
  if (ctx.kind === 'channel') return channelRule(inputs, item, formatKey, ctx.channel)
  if (inputs.channels.none) return { rule: CONSTANT_AVAILABLE, source: { level: 'noChannels' }, inherited: null, issues: [] }
  const members = inputs.channels.active.map((c) => ({ key: c.key, e: channelRule(inputs, item, formatKey, c.key) }))
  const union = unionProfile(members.map((m) => weekProfile(m.e.rule)))
  return {
    rule: ruleFromProfile(union, 'any'),
    source: { level: 'anyChannel', channels: members.filter((m) => availableSometime(m.e.rule)).map((m) => m.key) },
    inherited: null,
    issues: [...new Set(members.flatMap((m) => m.e.issues))],
  }
}

function explainRule(e: EffectiveRule, at: Date, timeZone: string): AvailabilityExplanation {
  if (e.source.level === 'channelInactive' || e.source.level === 'noChannels') {
    // Constant by construction; still validate the zone so a bad zone never passes silently.
    evaluateRule(e.rule, at, timeZone)
    return { ...e, state: e.rule.state, activeOverride: null, nextTransition: null, at, timeZone }
  }
  const { state, activeOverride } = evaluateRule(e.rule, at, timeZone)
  return {
    ...e,
    state,
    activeOverride: activeOverride ? { key: activeOverride.key, kind: activeOverride.kind, endsAt: overrideEndsAt(e.rule, activeOverride, at, timeZone) } : null,
    nextTransition: nextAvailabilityTransition(e.rule, at, timeZone),
    at,
    timeZone,
  }
}

const earliest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((min, d) => (d && (!min || d.getTime() < min.getTime()) ? d : min), null)

/** At an instant, in the project zone (both required). */
export function explainAvailability(
  inputs: AvailabilityInputs,
  item: ItemAvailabilityInput,
  formatKey: FormatKey,
  ctx: OfferingContext,
  at: Date,
  timeZone: string,
): AvailabilityExplanation {
  if (ctx.kind === 'channel' || inputs.channels.none) return explainRule(effectiveRule(inputs, item, formatKey, ctx), at, timeZone)
  // General with channels: available iff available on ≥ 1 active channel at t; the transition bound is the
  // earliest member transition (the aggregate can only change when a member changes — early, never late).
  const members = inputs.channels.active.map((c) => ({ key: c.key, x: explainRule(channelRule(inputs, item, formatKey, c.key), at, timeZone) }))
  const union = effectiveRule(inputs, item, formatKey, ctx)
  const availableOn = members.filter((m) => m.x.state === 'available').map((m) => m.key)
  return {
    ...union,
    source: { level: 'anyChannel', channels: availableOn },
    state: availableOn.length > 0 ? 'available' : 'unavailable',
    activeOverride: null,
    nextTransition: earliest(members.map((m) => m.x.nextTransition)),
    at,
    timeZone,
  }
}

/** Instant-free: the effective rule of every (format × public context), plus `general`. */
export function availabilityMatrix(inputs: AvailabilityInputs, item: ItemAvailabilityInput): ReadonlyMap<FormatKey, FormatAvailabilityMap> {
  const out = new Map<FormatKey, FormatAvailabilityMap>()
  for (const f of item.formats) {
    const m = new Map<'general' | ChannelKey, EffectiveRule>()
    m.set('general', effectiveRule(inputs, item, f.key, { kind: 'general' }))
    for (const c of inputs.channels.active) m.set(c.key, effectiveRule(inputs, item, f.key, { kind: 'channel', channel: c.key }))
    out.set(f.key, m)
  }
  return out
}

/** Item-level state at t on a context: available iff ANY format is; nextTransition = earliest among its formats. */
export function itemAvailabilityAt(
  inputs: AvailabilityInputs,
  item: ItemAvailabilityInput,
  ctx: OfferingContext,
  at: Date,
  timeZone: string,
): { state: ChannelAvailabilityState; nextTransition: Date | null } {
  const xs = item.formats.map((f) => explainAvailability(inputs, item, f.key, ctx, at, timeZone))
  return { state: xs.some((x) => x.state === 'available') ? 'available' : 'unavailable', nextTransition: earliest(xs.map((x) => x.nextTransition)) }
}

/**
 * The one entry point for "available now" (C5a-4). `formatKey` null = item level (any format).
 * No zone (or an invalid one) → scheduleOnly — never the server's zone, never a guess.
 */
export function availableNow(
  inputs: AvailabilityInputs,
  item: ItemAvailabilityInput,
  formatKey: FormatKey | null,
  ctx: OfferingContext,
  at: Date,
  timeZone: string | null,
): AvailableNow {
  const keys = formatKey === null ? item.formats.map((f) => f.key) : [formatKey]
  const profile = unionProfile(keys.map((k) => weekProfile(effectiveRule(inputs, item, k, ctx).rule)))
  if (!timeZone) return { kind: 'scheduleOnly', reason: 'timeZoneMissing', profile }
  try {
    const xs = keys.map((k) => explainAvailability(inputs, item, k, ctx, at, timeZone))
    return {
      kind: 'known',
      state: xs.some((x) => x.state === 'available') ? 'available' : 'unavailable',
      evaluatedAt: at,
      timeZone,
      validUntil: earliest(xs.map((x) => x.nextTransition)),
    }
  } catch {
    return { kind: 'scheduleOnly', reason: 'timeZoneMissing', profile }
  }
}

export type AvailabilityRowIssue = { code: AvailabilityIssueCode; level: IssueLevel; channel?: string; index: number; keys?: string[] }

/** Save-time validation of rows on items, formats (and, via C1, categories; and C2 channel defaults through scheduleIssues). */
export function availabilityRowIssues(rows: readonly unknown[], channels: ChannelSet): AvailabilityRowIssue[] {
  const out: AvailabilityRowIssue[] = []
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const channel = typeof r.channel === 'string' && r.channel ? r.channel : typeof r._key === 'string' ? r._key : ''
    if (r._key !== r.channel) out.push({ code: 'availability.keyMismatch', level: 'error', channel, index })
    if (seen.has(channel)) out.push({ code: 'availability.duplicateChannel', level: 'error', channel, index })
    seen.add(channel)
    const c = channels.byKey.get(channel as ChannelKey)
    if (!c) out.push({ code: 'availability.unknownChannel', level: 'error', channel, index })
    else if (!c.active) out.push({ code: 'availability.inactiveChannel', level: 'warning', channel, index })
    const { rule, issues } = readChannelRule(row)
    for (const code of issues) out.push({ code, level: 'error', channel, index })
    if (rule) for (const s of scheduleIssues(rule)) out.push({ code: s.code, level: s.level, channel, index, keys: s.keys })
  })
  return out
}

/** Rows stored on an implicit format are refused (I-C3-4). */
export function implicitFormatRowIssues(format: Pick<Format, 'implicit' | 'availability'>): AvailabilityRowIssue[] {
  return format.implicit && format.availability.size > 0 ? [{ code: 'availability.scheduleOnImplicitFormat', level: 'error', index: 0 }] : []
}

export type { WeekProfile }
