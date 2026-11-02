// ── Catalogue commerce — shared vocabulary (contract C2-C5-C10 §0, Rev 4) ─────
//
// Types only. Every Catalogue workstream imports these names (K-9: one
// implementation per concept; owner names win, REVIEW X-2). The functions live
// in the sibling modules; this file also re-exports their public types so a
// consumer needs one import path.

import type { Weekday } from './windows'

export type { Weekday, WeeklyWindow, WindowState, WeekRange } from './windows'

/** A channel's stable machine key, e.g. "dine-in". Immutable once created. */
export type ChannelKey = string & { readonly __brand: 'ChannelKey' }
/** A format's stable key (its Sanity `_key` within the item). */
export type FormatKey = string & { readonly __brand: 'FormatKey' }

export const asChannelKey = (s: string) => s as ChannelKey
export const asFormatKey = (s: string) => s as FormatKey

/** The value a person can set at category, item and format level. Never stored as 'inherit'. */
export type AvailabilityRuleValue = 'inherit' | 'available' | 'unavailable'
/** An effective result. Two values only. Deliberately NOT named AvailabilityState (the deprecated window vocabulary). */
export type ChannelAvailabilityState = 'available' | 'unavailable'

export const CHANNEL_AVAILABILITY_STATES: readonly ChannelAvailabilityState[] = ['available', 'unavailable']
export const isChannelAvailabilityState = (v: unknown): v is ChannelAvailabilityState => v === 'available' || v === 'unavailable'

/**
 * WHERE a question is asked. 'general' = the item on the website with no
 * channel selected (K-3 rule 7).
 */
export type OfferingContext = { kind: 'channel'; channel: ChannelKey } | { kind: 'general' }

export type Locale = string
export type LocalizedString = Partial<Record<Locale, string>>
/**
 * Text as a reader receives it: a stored localized object, or a string GROQ
 * already resolved for the request locale (website projections use loc()).
 * Resolve with `text()` (resolve.ts) — the same fallback chain either way.
 */
export type LocalizedText = LocalizedString | string

// ── Schedules (C5a) ───────────────────────────────────────────────────────────

/** One weekly scheduled override. Stored as `catalogueWeeklyOverride`; `kind` is its `_type` discriminator. */
export type WeeklyOverride = {
  kind: 'weekly'
  key: string
  /** Empty = every day. Names the day an interval STARTS (A1). */
  days: readonly Weekday[]
  from: string | null
  to: string | null
  state: ChannelAvailabilityState
}

/**
 * Discriminated so later kinds are additive (D-6.4): a future
 * `{ kind: 'dated'; … }` (stored `catalogueDatedOverride`) joins this union
 * without rewriting any existing rule.
 */
export type ScheduledOverride = WeeklyOverride

/** A complete availability rule for ONE channel at ONE level (category, item, format, channel default). */
export type ChannelAvailabilityRule = {
  /** The BASELINE, in force whenever no override applies. */
  state: ChannelAvailabilityState
  /** [] = the baseline all week. */
  overrides: readonly ScheduledOverride[]
}

/** Instant-free weekly profile: the wall-clock week as half-open minute ranges [0,10080), merged and sorted. */
export type WeekProfile = readonly { start: number; end: number; state: ChannelAvailabilityState }[]

// ── Issue codes (C6 owns the table that maps them to readiness rules, REVIEW X-4) ─

export type ChannelIssueCode =
  | 'channel.keyInvalid'
  | 'channel.keyDuplicate'
  | 'channel.keyImmutable'
  | 'channel.labelMissing'
  | 'channel.defaultAvailabilityInvalid'
  | 'channel.deleteReferenced'
  | 'channel.limitExceeded'
  | 'channel.malformedEntry'

export type FormatIssueCode =
  | 'format.keyDuplicate'
  | 'format.labelRequired'
  | 'format.limitExceeded'
  | 'format.pricesLimitExceeded'
  | 'format.skuInvalid'
  | 'format.skuDuplicateInItem'
  | 'format.skuDuplicateInProject'
  | 'format.isbnInvalid'
  | 'format.isbnConflictsBook'
  | 'format.gtinInvalid'
  | 'format.quantityInvalid'
  | 'format.unitUnknown'
  | 'format.implicitOverride'

export type PriceIssueCode =
  | 'price.amountInvalid'
  | 'price.tooManyDecimals'
  | 'price.overlap'
  | 'price.unknownChannel'
  | 'price.inactiveChannel'
  | 'price.windowInvalidTime'
  | 'price.windowIncomplete'
  | 'price.windowZeroLength'
  | 'price.windowUnknownDay'
  | 'price.reservedFieldWritten'
  | 'price.ambiguous'
  | 'price.missing'
  | 'price.partialCoverage'
  | 'price.indeterminate'

export type AvailabilityIssueCode =
  | 'availability.keyMismatch'
  | 'availability.duplicateChannel'
  | 'availability.stateInvalid'
  | 'availability.unknownChannel'
  | 'availability.inactiveChannel'
  | 'availability.conflictingRows'
  | 'availability.primaryCategoryBroken'
  | 'availability.scheduleOverlap'
  | 'availability.scheduleInvalidTime'
  | 'availability.scheduleIncomplete'
  | 'availability.scheduleZeroLength'
  | 'availability.scheduleUnknownDay'
  | 'availability.scheduleUnknownKind'
  | 'availability.scheduleLimitExceeded'
  | 'availability.scheduleRedundant'
  | 'availability.scheduleOnImplicitFormat'

export type IssueLevel = 'error' | 'warning'

/** Limits (D-21, C3-4, C5a-2). */
export const CHANNEL_LIMIT = 12
export const FORMAT_LIMIT = 24
export const PRICES_PER_FORMAT_LIMIT = 50
export const OVERRIDES_PER_RULE_LIMIT = 14
