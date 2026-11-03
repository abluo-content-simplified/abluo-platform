// ── Pack declaration validation (contract C7.3) ──────────────────────────────
// Pure. `validatePackDeclaration(pack, ctx) → PackIssue[]` with the stable C7.3
// codes, run by a vitest over the whole registry (build-time validation) against
// the CURRENT schema/config rules: term keys (isValidTermKey), channel keys (C2),
// tree rules (C1 buildTree), schedules (C5a scheduleIssues), the segment rule
// (validateSegment), profiles (PROFILES), C3 format quantities, limits (C1.3).

import { isValidTermKey } from '@/lib/taxonomy/ids'
import { scheduleIssues } from '../commerce/availability-schedule'
import { isValidChannelKey } from '../commerce/channels'
import { CHANNEL_LIMIT, isChannelAvailabilityState, type ChannelAvailabilityRule, type ScheduledOverride } from '../commerce/commerce-types'
import { QUANTITY_UNITS } from '../commerce/formats'
import { isItemProfile } from '../profiles'
import { validateSegment } from '../segment'
import { MAX_CATEGORIES, MAX_TAGS } from '../taxonomy/limits'
import { buildTree } from '../taxonomy/tree'
import type { CategoryNode } from '../taxonomy/types'
import type { PackAvailabilityRule, PackDeclaration, PackLocalized, PackSection, PackWeeklyOverride } from './types'

export type PackIssueCode =
  | 'pack_id_invalid'
  | 'pack_id_duplicate'
  | 'pack_version_invalid'
  | 'pack_label_missing'
  | 'pack_key_invalid'
  | 'pack_key_duplicate'
  | 'pack_parent_unknown'
  | 'pack_cycle'
  | 'pack_depth'
  | 'pack_channel_default_missing'
  | 'pack_schedule_invalid'
  | 'pack_rule_channel_unknown'
  | 'pack_empty_not_empty'
  | 'pack_segment_invalid'
  | 'pack_profile_unknown'
  | 'pack_currency_present'
  /** C7.2 "forbidden content": an `_id`, an applied-pack reference, a money amount, a Studio reference. */
  | 'pack_forbidden_content'
  | 'pack_too_large'
  | 'pack_option_ref_unknown'
  /** An option group without choices, min > max, or a format with an invalid quantity (the dashboard would refuse them). */
  | 'pack_shape_invalid'
  | 'pack_runtime_branch'
  /** D-22 (C1.12.8): a root category or option group of a non-empty pack without "Use for". */
  | 'pack_use_for_missing'
  /** D-22: "Use for" on a child category (descendants inherit their root's). */
  | 'pack_use_for_not_root'

export type PackIssue = { code: PackIssueCode; path: string; message: string }

export type PackValidationContext = {
  /** Released versions of this pack id (registry snapshot); the declared version must exceed every earlier one. */
  released?: readonly number[]
  /** Other ids in the registry (for pack_id_duplicate). */
  otherIds?: readonly string[]
}

/** The launch locales every pack label carries. */
export const PACK_LOCALES = ['en', 'it', 'de'] as const
export const PACK_LABEL_MAX = 80
export const PACK_TEXT_MAX = 200
/** Packs guide to ≤ 4 levels (storage allows more). */
export const PACK_MAX_DEPTH = 4

const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** ISO 4217 codes a pack must never carry as a value (the manifest's list and the common rest). */
const CURRENCY_VALUES = new Set(['EUR', 'CHF', 'GBP', 'USD', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'JPY', 'CNY', 'INR', 'BRL', 'MXN', 'ZAR', 'TRY'])
const FORBIDDEN_KEYS = /^(_id|_ref|appliedPack.*|appliedPreset|amount|price|prices|studio.*)$/i

/** A pack override → the C5a stored-shape member type (`kind: 'weekly'`). */
export const toOverride = (o: PackWeeklyOverride): ScheduledOverride => ({ kind: 'weekly', key: o.key, days: [...o.days], from: o.from, to: o.to, state: o.state })
/** A pack rule → a complete C5a rule. */
export const toRule = (r: PackAvailabilityRule): ChannelAvailabilityRule => ({ state: r.state, overrides: (r.overrides ?? []).map(toOverride) })

/** The pack's categories as C1 nodes (for buildTree): order = declaration order among siblings. */
export function packCategoryNodes(pack: Pick<PackDeclaration, 'categories'>): CategoryNode[] {
  return pack.categories.map((c, i) => ({ key: c.key, label: { ...c.label } as Record<string, string>, parentKey: c.parent, order: (i + 1) * 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null }))
}

/** Every section of a collection tree, depth first. */
export function flattenSections(sections: readonly PackSection[], parentKey: string | null = null): { key: string; name: PackLocalized; parentKey: string | null }[] {
  return sections.flatMap((s) => [{ key: s.key, name: s.name, parentKey }, ...flattenSections(s.children ?? [], s.key)])
}

export function validatePackDeclaration(pack: PackDeclaration, ctx: PackValidationContext = {}): PackIssue[] {
  const out: PackIssue[] = []
  const add = (code: PackIssueCode, path: string, message: string) => out.push({ code, path, message })

  // id + version
  if (!PACK_ID.test(pack.id ?? '')) add('pack_id_invalid', 'id', `"${pack.id}" is not kebab-case.`)
  if (ctx.otherIds?.includes(pack.id)) add('pack_id_duplicate', 'id', `"${pack.id}" is declared twice.`)
  if (!Number.isInteger(pack.version) || pack.version < 1) add('pack_version_invalid', 'version', 'The version must be a positive integer.')
  else {
    const earlier = (ctx.released ?? []).filter((v) => v !== pack.version)
    if (earlier.some((v) => v > pack.version)) add('pack_version_invalid', 'version', `v${pack.version} is not greater than every released version (${earlier.join(', ')}).`)
  }

  // labels
  const label = (path: string, l: PackLocalized | undefined, max: number) => {
    for (const loc of PACK_LOCALES) {
      const v = l?.[loc]
      if (typeof v !== 'string' || !v.trim()) add('pack_label_missing', `${path}.${loc}`, `Missing ${loc} text.`)
      else if (v.length > max) add('pack_label_missing', `${path}.${loc}`, `Longer than ${max} characters.`)
    }
  }
  label('name', pack.name, PACK_TEXT_MAX)
  label('description', pack.description, PACK_TEXT_MAX)
  if (pack.suggestedPublicName) label('suggestedPublicName', pack.suggestedPublicName, PACK_LABEL_MAX)

  const unique = (area: string, keys: readonly string[], valid: (k: string) => boolean) => {
    const seen = new Set<string>()
    keys.forEach((k, i) => {
      if (!valid(k)) add('pack_key_invalid', `${area}[${i}]`, `"${k}" is not a valid key.`)
      if (seen.has(k)) add('pack_key_duplicate', `${area}[${i}]`, `"${k}" is declared twice.`)
      seen.add(k)
    })
  }

  // empty
  if (pack.empty) {
    const content = pack.channels.length + pack.categories.length + pack.tags.length + pack.collections.length + pack.formatSuggestions.length + pack.optionGroups.length + pack.policySuggestions.length
    if (content > 0 || pack.suggestedPublicName || pack.suggestedSegment || pack.suggestedDefaultProfile) add('pack_empty_not_empty', 'empty', 'An empty pack carries no content and no suggestion.')
  }

  // channels
  unique('channels', pack.channels.map((c) => c.key), isValidChannelKey)
  if (pack.channels.length > CHANNEL_LIMIT) add('pack_too_large', 'channels', `More than ${CHANNEL_LIMIT} channels.`)
  const channelKeys = new Set(pack.channels.map((c) => c.key))
  pack.channels.forEach((c, i) => {
    label(`channels[${i}].label`, c.label, PACK_LABEL_MAX)
    if (!isChannelAvailabilityState(c.defaultAvailability)) add('pack_channel_default_missing', `channels[${i}].defaultAvailability`, `Channel "${c.key}" has no explicit default availability.`)
    else schedule(`channels[${i}].defaultSchedule`, { state: c.defaultAvailability, overrides: c.defaultSchedule })
    if (c.defaultAvailabilityWithoutSchedule !== undefined && !isChannelAvailabilityState(c.defaultAvailabilityWithoutSchedule)) add('pack_channel_default_missing', `channels[${i}].defaultAvailabilityWithoutSchedule`, 'Invalid state.')
  })
  function schedule(path: string, r: PackAvailabilityRule) {
    const errors = scheduleIssues(toRule(r)).filter((x) => x.level === 'error')
    for (const e of errors) add('pack_schedule_invalid', path, e.code)
    for (const o of r.overrides ?? []) if (!/^[A-Za-z0-9_-]{1,40}$/.test(o.key)) add('pack_schedule_invalid', path, `availability.scheduleInvalidKey:${o.key}`)
  }

  // categories
  unique('categories', pack.categories.map((c) => c.key), isValidTermKey)
  if (pack.categories.length > MAX_CATEGORIES) add('pack_too_large', 'categories', `More than ${MAX_CATEGORIES} categories.`)
  const categoryKeys = new Set(pack.categories.map((c) => c.key))
  const groupKeys = new Set(pack.optionGroups.map((g) => g.key))
  pack.categories.forEach((c, i) => {
    label(`categories[${i}].label`, c.label, PACK_LABEL_MAX)
    if (c.parent !== null && !categoryKeys.has(c.parent)) add('pack_parent_unknown', `categories[${i}].parent`, `"${c.parent}" is not a category of this pack.`)
    for (const [ch, rule] of Object.entries(c.channelRules ?? {})) {
      if (!channelKeys.has(ch)) add('pack_rule_channel_unknown', `categories[${i}].channelRules.${ch}`, `"${ch}" is not a channel this pack suggests.`)
      if (!isChannelAvailabilityState(rule?.state)) add('pack_schedule_invalid', `categories[${i}].channelRules.${ch}`, 'availability.stateInvalid')
      else schedule(`categories[${i}].channelRules.${ch}`, rule)
    }
    for (const g of c.defaultOptionGroups ?? []) if (!groupKeys.has(g)) add('pack_option_ref_unknown', `categories[${i}].defaultOptionGroups`, `"${g}" is not an option group of this pack.`)
    // D-22 (C1.12.8): roots declare "Use for"; children inherit it.
    if (c.parent !== null && c.useFor !== undefined) add('pack_use_for_not_root', `categories[${i}].useFor`, `"${c.key}" is not top-level: it inherits its root's "Use for".`)
    if (c.parent === null && !c.useFor?.length) add('pack_use_for_missing', `categories[${i}].useFor`, `Top-level category "${c.key}" declares no "Use for".`)
    useFor(`categories[${i}].useFor`, c.useFor)
  })
  function useFor(path: string, v: readonly unknown[] | undefined) {
    for (const p of v ?? []) if (!isItemProfile(p)) add('pack_profile_unknown', path, `"${String(p)}" is not a profile.`)
  }
  const tree = buildTree(packCategoryNodes(pack))
  for (const issue of tree.issues) {
    // Orphans are reported above as pack_parent_unknown; duplicates as pack_key_duplicate.
    if (issue.code === 'cycle') add('pack_cycle', `categories.${issue.key}`, 'The categories form a cycle.')
  }
  for (const [key, depth] of tree.depthOf) if (depth >= PACK_MAX_DEPTH) add('pack_depth', `categories.${key}`, `Deeper than ${PACK_MAX_DEPTH} levels.`)

  // tags
  unique('tags', pack.tags.map((t) => t.key), isValidTermKey)
  if (pack.tags.length > MAX_TAGS) add('pack_too_large', 'tags', `More than ${MAX_TAGS} tags.`)
  pack.tags.forEach((t, i) => {
    label(`tags[${i}].label`, t.label, PACK_LABEL_MAX)
    useFor(`tags[${i}].useFor`, t.useFor)
  })

  // collections + sections
  unique('collections', pack.collections.map((c) => c.key), isValidTermKey)
  pack.collections.forEach((c, i) => {
    label(`collections[${i}].name`, c.name, PACK_LABEL_MAX)
    if (c.collectionType !== 'menu' && c.collectionType !== 'list') add('pack_shape_invalid', `collections[${i}].collectionType`, 'Unknown collection type.')
    const sections = flattenSections(c.sections)
    unique(`collections[${i}].sections`, sections.map((s) => s.key), (k) => /^[A-Za-z0-9_-]{1,48}$/.test(k))
    sections.forEach((s, j) => label(`collections[${i}].sections[${j}].name`, s.name, PACK_LABEL_MAX))
  })

  // formats
  unique('formatSuggestions', pack.formatSuggestions.map((f) => f.key), isValidTermKey)
  pack.formatSuggestions.forEach((f, i) => {
    label(`formatSuggestions[${i}].label`, f.label, PACK_LABEL_MAX)
    if (f.quantity && (!(f.quantity.value > 0) || !QUANTITY_UNITS.includes(f.quantity.unit))) add('pack_shape_invalid', `formatSuggestions[${i}].quantity`, 'Invalid quantity.')
  })

  // option groups
  unique('optionGroups', pack.optionGroups.map((g) => g.key), isValidTermKey)
  pack.optionGroups.forEach((g, i) => {
    label(`optionGroups[${i}].name`, g.name, PACK_LABEL_MAX)
    if (!g.useFor?.length) add('pack_use_for_missing', `optionGroups[${i}].useFor`, `Option group "${g.key}" declares no "Use for".`)
    useFor(`optionGroups[${i}].useFor`, g.useFor)
    if (g.choices.length === 0) add('pack_shape_invalid', `optionGroups[${i}].choices`, 'An option list needs at least one option.')
    if (!Number.isInteger(g.min) || g.min < 0 || (g.max !== null && (!Number.isInteger(g.max) || g.max < g.min))) add('pack_shape_invalid', `optionGroups[${i}]`, 'Invalid min / max.')
    unique(`optionGroups[${i}].choices`, g.choices.map((c) => c.key), isValidTermKey)
    g.choices.forEach((c, j) => {
      label(`optionGroups[${i}].choices[${j}].label`, c.label, PACK_LABEL_MAX)
      if (c.priceDelta !== 0) add('pack_forbidden_content', `optionGroups[${i}].choices[${j}].priceDelta`, 'A pack never suggests money.')
      if (c.kind !== 'add' && c.kind !== 'remove') add('pack_shape_invalid', `optionGroups[${i}].choices[${j}].kind`, 'Unknown kind.')
    })
  })

  // policy suggestions (internal standards only)
  pack.policySuggestions.forEach((p, i) => {
    if (p.scope.category && !categoryKeys.has(p.scope.category)) add('pack_parent_unknown', `policySuggestions[${i}].scope.category`, `"${p.scope.category}" is not a category of this pack.`)
    if (p.scope.profile && !isItemProfile(p.scope.profile)) add('pack_profile_unknown', `policySuggestions[${i}].scope.profile`, 'Unknown profile.')
  })

  // settings
  if (pack.suggestedSegment !== undefined && !validateSegment(pack.suggestedSegment).ok) add('pack_segment_invalid', 'suggestedSegment', `"${pack.suggestedSegment}" is not a valid web address segment.`)
  if (pack.suggestedDefaultProfile !== undefined && !isItemProfile(pack.suggestedDefaultProfile)) add('pack_profile_unknown', 'suggestedDefaultProfile', `"${pack.suggestedDefaultProfile}" is not a profile.`)

  // forbidden content (deep scan)
  const scan = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (CURRENCY_VALUES.has(v.trim())) add('pack_currency_present', path, `"${v}" is a currency.`)
      return
    }
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${path}[${i}]`))
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k
        if (/^currency$/i.test(k)) add('pack_currency_present', p, 'A pack never carries a currency.')
        else if (FORBIDDEN_KEYS.test(k)) add('pack_forbidden_content', p, `"${k}" may not appear in a pack.`)
        scan(x, p)
      }
    }
  }
  scan(pack, '')
  return out
}

/** Every declaration of a registry, with ids checked against each other. */
export function validateRegistry(packs: readonly PackDeclaration[], released: Readonly<Record<string, readonly number[]>>): PackIssue[] {
  return packs.flatMap((p, i) =>
    validatePackDeclaration(p, { released: released[p.id] ?? [], otherIds: packs.filter((_, j) => j !== i).map((x) => x.id) }).map((issue) => ({ ...issue, path: `${p.id}.${issue.path}` })),
  )
}
