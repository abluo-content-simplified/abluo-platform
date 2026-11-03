// ── Catalogue packs — types (contract C7.2 / C7.5) ───────────────────────────
// History records (R1 reader) and pack declarations (R2). Pack identity is
// installation history: only Setup may read it (C7.9 guard,
// applied-preset-guard.test.ts).

import type { ChannelAvailabilityState, Weekday } from '../commerce/commerce-types'
import type { QuantityUnit } from '../commerce/formats'
import type { ItemProfile } from '../profiles'

export type PackId = 'pizzeria' | 'traditional-restaurant' | 'fine-dining' | 'cafe-and-bar' | 'wine-bar' | 'empty' | 'bookshop'

/**
 * Ids that exist only in legacy `appliedPreset` records (D-1 starter presets):
 * the history reader surfaces them unchanged so nothing is lost; no pack carries them.
 */
export type LegacyPresetId = 'restaurant'

export type AppliedPackAdded = {
  categories: string[]
  tags: string[]
  collections: string[]
  sections: string[]
  optionGroups: string[]
  channels: string[]
  formats: string[]
  settings: string[]
}

export type AppliedPackRecord = {
  /** `${id}@${version}` — one entry per pack version. */
  _key: string
  id: PackId | LegacyPresetId
  version: number
  appliedAt: string
  /** User id, or 'migration' for a converted legacy record. */
  appliedBy: string
  /** Keys only. */
  added: AppliedPackAdded
  /** packKey -> existing key chosen by the person ("category:dolci": "desserts"). */
  mapped: Record<string, string>
  /** "<area>:<key>" unticked or not applicable. */
  skipped: string[]
}

/** A record as the reader returns it: stored, or the legacy `appliedPreset` read virtually (until D3 converts it). */
export type PackHistoryEntry = AppliedPackRecord & { source: 'history' | 'legacyPreset' }

// ── Declarations (contract C7.2) — R2 ───────────────────────────────────────
// A pack is typed, versioned, validated ORDINARY DATA. It never carries a
// currency, a money amount, an `_id`, an applied-pack reference, an external
// channel policy or a Studio reference (test-enforced: validate.ts).

/** Launch packs: en / it / de required (C7.3 `pack_label_missing`). */
export type PackLocalized = { en: string; it: string; de: string } & Record<string, string | undefined>

/** = C5a ScheduledOverride kind 'weekly'; `to <= from` = overnight (days name the START day); empty days = every day. */
export type PackWeeklyOverride = { key: string; days: Weekday[]; from: string | null; to: string | null; state: ChannelAvailabilityState }
/** A COMPLETE rule (D-6): baseline + optional weekly overrides. 'inherit' is not expressible. */
export type PackAvailabilityRule = { state: ChannelAvailabilityState; overrides?: PackWeeklyOverride[] }

export type PackCategory = {
  /** STABLE identity across versions; never a translated string. */
  key: string
  label: PackLocalized
  /** A key declared in this pack; tree order = array order among siblings. */
  parent: string | null
  /** Suggested complete rules, only for channels this pack also suggests. */
  channelRules?: Record<string, PackAvailabilityRule>
  /** PackOptionGroup keys; defaults for NEW items only. */
  defaultOptionGroups?: string[]
}
export type PackTag = { key: string; label: PackLocalized }

/** Never auto-activated: applied only if the person ticks it in the preview (K-6). */
export type PackChannelSuggestion = {
  key: string
  label: PackLocalized
  preselected: boolean
  /** REQUIRED (X-11): written explicitly with the channel. */
  defaultAvailability: ChannelAvailabilityState
  /** Optional weekly overrides of that baseline (C2 `defaultSchedule`, e.g. delivery only in the evening). */
  defaultSchedule?: PackWeeklyOverride[]
  /** Used when the person declines schedules (`channelRules: 'skip'`) and the baseline is unavailable only because of the schedule. */
  defaultAvailabilityWithoutSchedule?: ChannelAvailabilityState
}

export type PackSection = { key: string; name: PackLocalized; children?: PackSection[] }
export type PackCollection = { key: string; name: PackLocalized; collectionType: 'menu' | 'list'; sections: PackSection[] }

export type PackOptionChoice = { key: string; label: PackLocalized; priceDelta: 0; kind: 'add' | 'remove' }
/** Shape = catalogueOptionList minus ids/lifecycle. min/max are the SUGGESTED attachment limits (they live on the attachment, ADR-033 D2). */
export type PackOptionGroup = { key: string; name: PackLocalized; min: number; max: number | null; choices: PackOptionChoice[] }

/** C3 project-level reusable format template (Glass 15 cl, Bottle 75 cl …). */
export type PackFormatTemplate = { key: string; label: PackLocalized; quantity?: { value: number; unit: QuantityUnit } }

/** C6: an INTERNAL tenant publication standard suggestion (never an external marketplace policy, brief 2.6). */
export type PackPolicySuggestion = { key: string; requirement: 'photo' | 'description'; level: 'recommended'; scope: { category?: string; profile?: ItemProfile } }

export type PackDeclaration = {
  id: PackId
  /** Positive integer; launch packs are v3 (continuing the preset numbering). */
  version: number
  name: PackLocalized
  description: PackLocalized
  /** Empty pack: every list below empty and every suggestion absent. */
  empty?: true
  /** C11; fill-if-empty, never overwrites. */
  suggestedPublicName?: PackLocalized
  /** D11 segment; applied only when no segment exists yet. */
  suggestedSegment?: string
  /** Existing PROFILES id; fill-if-empty. */
  suggestedDefaultProfile?: ItemProfile
  channels: PackChannelSuggestion[]
  categories: PackCategory[]
  tags: PackTag[]
  collections: PackCollection[]
  formatSuggestions: PackFormatTemplate[]
  optionGroups: PackOptionGroup[]
  policySuggestions: PackPolicySuggestion[]
}
