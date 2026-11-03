// ── Pack planning (contract C7.4, C7.6, C7.8) ────────────────────────────────
// Pure: no I/O, no clock. `planPack(current, pack, selection)` is EXACTLY what
// the preview renders and what application executes (the service recomputes it
// from fresh state and compares `fingerprint`).
//
// Equivalence is by STABLE KEY only (deterministic document ids for collections
// and option lists). A label match is a PROPOSAL, never merged: the default for
// an unanswered proposal is "add anyway". A pack adds what is missing, never
// changes or deletes what exists, never touches currency, never activates a
// channel the person did not tick, never writes a rule on a channel that is not
// active afterwards.

import { SLUG_PART_PATTERN } from '@/lib/taxonomy/ids'
import { ORDER_STEP } from '@/lib/taxonomy/rules'
import { CHANNEL_LIMIT, type ChannelAvailabilityRule, type ChannelAvailabilityState, type ScheduledOverride } from '../commerce/commerce-types'
import type { Channel } from '../commerce/channels'
import type { ItemProfile } from '../profiles'
import { validateSegment, type SegmentClash } from '../segment'
import { MAX_CATEGORIES, MAX_TAGS } from '../taxonomy/limits'
import type { CategoryNode, Localized, TagNode } from '../taxonomy/types'
import { fingerprintOf, type StoredRow } from '../taxonomy/write-model'
import type { AppliedPackRecord, PackDeclaration, PackId, PackLocalized } from './types'
import { flattenSections, toOverride, toRule } from './validate'

// ── State (read by the service, passed in so planning stays pure) ───────────

export type ExistsAs = 'draft' | 'published' | 'both'

export type CatalogueState = {
  projectSlug: string
  defaultLocale: string
  locales: readonly string[]
  categories: readonly CategoryNode[]
  tags: readonly TagNode[]
  /** C2 channels (key, label, active, defaultAvailability, defaultSchedule). */
  channels: readonly Channel[]
  /** Stored channels predate C2 (no explicit defaults): channels can be added once data step D2 ran. */
  channelsUnmigrated: boolean
  settings: {
    setupCompletedAt: string | null
    publicSegment: string | null
    publicSegmentHistory: readonly string[]
    publicName: Localized
    defaultItemProfile: ItemProfile | null
  }
  collections: readonly { id: string; exists: ExistsAs; name: Localized; slugs: Localized; sectionKeys: readonly string[] }[]
  /** Items + collections share one slug namespace (D11.1). */
  takenSlugs: readonly { locale: string; slug: string; id: string }[]
  optionLists: readonly { id: string; exists: ExistsAs; name: Localized }[]
  formatTemplates: readonly { key: string; label: Localized }[]
  pageFirstSegments: readonly string[]
  history: readonly AppliedPackRecord[]
  /** Revision tokens of the guarded set (C-10): '' = the document does not exist yet. Part of the fingerprint. */
  revisions: { project: string; taxonomy: string; history: string }
  /** Stored rows the mutation builder extends (existing rows are kept byte-identical). */
  raw: {
    categories: readonly StoredRow[]
    tags: readonly StoredRow[]
    serviceChannels: readonly unknown[]
    formatTemplates: readonly unknown[]
    /** Existing collection documents by base id: the draft and/or the published copy (update path adds sections). */
    collections: Readonly<Record<string, { draft?: Record<string, unknown> | null; published?: Record<string, unknown> | null }>>
  }
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export type PackArea = 'category' | 'tag' | 'collection' | 'section' | 'optionGroup' | 'formatSuggestion' | 'channelSuggestion' | 'setting' | 'policySuggestion'
export type PackSettingKey = 'publicName' | 'defaultItemProfile' | 'publicSegment'

export type PlanRule = { channel: string; rule: ChannelAvailabilityRule }

export type PlanItem = {
  area: PackArea
  /** Stable key (or setting id). */
  key: string
  parentKey?: string | null
  label: PackLocalized | Localized
  /** Deterministic document id for collections / option groups. */
  id?: string
  /** Channel suggestions and settings the person may decline. */
  requiresConfirmation?: boolean
  /** An equivalent node exists but is archived: left archived. */
  note?: 'archived_in_project' | 'not_available_yet' | 'declined' | 'excluded' | 'already_set'
  /** category (add): the complete rules written for active channels. */
  rules?: readonly PlanRule[]
  /** channelSuggestion (add): exactly what is written. */
  channel?: { defaultAvailability: ChannelAvailabilityState; defaultSchedule: readonly ScheduledOverride[] }
  /** setting (add): the value written. */
  value?: string | Localized
  /** category (equivalent): the person chose to use their own node. */
  mappedTo?: string
  /** collection (add): the slugs written per locale. */
  slugs?: Localized
  /** optionGroup: number of choices. */
  choices?: number
  /** category (add): default option lists for NEW items (deterministic ids of groups added or already present). */
  optionListIds?: readonly string[]
}

export type PackConflictCode =
  | 'pack_already_applied'
  | 'segment_clash'
  | 'slug_collision'
  | 'limit_exceeded'
  | 'parent_differs'
  | 'label_differs'
  | 'setting_differs'
  | 'rule_skipped_inactive_channel'
  /** Blocking (extension): a ticked channel cannot be added while the stored channels await data step D2 (C10-4). */
  | 'channel_migration_pending'

export type PlanConflict = { code: PackConflictCode; area: PackArea; key: string; blocking: boolean; detail?: Record<string, string> }

export type LabelProposal = { area: 'category' | 'tag'; packKey: string; existingKey: string; basis: 'default_locale_label' | 'any_locale_label' }

export type PackPlan = {
  pack: { id: PackId; version: number }
  add: readonly PlanItem[]
  equivalent: readonly PlanItem[]
  conflicts: readonly PlanConflict[]
  proposals: readonly LabelProposal[]
  /** Elements the pack offers that this selection does not add (unticked, declined, not available yet). The preview lists them with their tick box. */
  skipped: readonly PlanItem[]
  /** packKey → existing key the person chose ("category:desserts": "dolci"). */
  mapped: Readonly<Record<string, string>>
  fingerprint: string
  needsChunking: boolean
}

export type PackSelection = {
  /** Only these suggested channels are created, each `active: true` with the pack's declared default. */
  acceptChannels: readonly string[]
  acceptSettings: readonly PackSettingKey[]
  /** key "category:<packKey>" / "tag:<packKey>". */
  resolutions: Readonly<Record<string, { use: 'existing'; key: string } | { use: 'add' }>>
  /** "<area>:<key>" the person unticked (for categories, their whole subtree). */
  exclude: readonly string[]
  /** collection key → slug per locale, to clear slug_collision. */
  slugOverrides: Readonly<Record<string, Localized>>
  /** 'skip' writes no category rule and no channel default schedule. */
  channelRules: 'apply' | 'skip'
  /**
   * Review-step renames (brief §6 step 3): "<area>:<key>" (sections "section:<collection>.<key>") →
   * the person's name per language, used instead of the pack's for an element that is ADDED.
   * Never renames anything that exists.
   */
  labels?: Readonly<Record<string, Localized>>
  /** Review-step additions: the person's own categories / tags, added with the pack (keys made from the name). */
  extras?: { categories?: readonly { key: string; label: Localized; parent: string | null }[]; tags?: readonly { key: string; label: Localized }[] }
}

/** The preview's starting selection: preselected channels, every setting, schedules applied, nothing excluded. */
export function defaultSelection(pack: PackDeclaration): PackSelection {
  return { acceptChannels: pack.channels.filter((c) => c.preselected).map((c) => c.key), acceptSettings: ['publicName', 'defaultItemProfile', 'publicSegment'], resolutions: {}, exclude: [], slugOverrides: {}, channelRules: 'apply' }
}

/** Single-transaction budget (C7.5). */
export const PACK_MAX_MUTATIONS_PER_TX = 100

export const collectionIdFor = (projectSlug: string, key: string) => `catalogue-collection.${projectSlug}.${key.replace(/_/g, '-')}`
export const optionListIdFor = (projectSlug: string, key: string) => `catalogue-option-list.${projectSlug}.${key.replace(/_/g, '-')}`
export const historyKeyOf = (pack: { id: string; version: number }) => `${pack.id}@${pack.version}`

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** A pack label in the project's languages: every site locale the pack carries; the main language falls back to English. */
export function localizedFor(label: PackLocalized, site: { defaultLocale: string; locales: readonly string[] }): Localized {
  const out: Localized = {}
  for (const l of site.locales) {
    const v = label[l]
    if (typeof v === 'string' && v.trim()) out[l] = v
  }
  if (!out[site.defaultLocale]) out[site.defaultLocale] = label.en
  return out
}

/** The person's rename (review step), cleaned and restricted to the site languages, over the pack's label. */
function labelWith(selection: PackSelection, ref: string, base: Localized, site: { defaultLocale: string; locales: readonly string[] }): Localized {
  const override = selection.labels?.[ref]
  if (!override) return base
  const out: Localized = { ...base }
  for (const l of site.locales) {
    const v = override[l]
    if (typeof v === 'string' && v.trim()) out[l] = v.trim()
  }
  return out
}

/** A collection slug per locale, from its name (lower-case, ASCII, hyphens). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

const sameLocalized = (a: Localized, b: Localized, locale: string) => fold(a[locale] ?? '') === fold(b[locale] ?? '')
const sameRule = (a: ChannelAvailabilityRule | undefined, b: ChannelAvailabilityRule) =>
  !!a && a.state === b.state && JSON.stringify(a.overrides.map((o) => [o.days, o.from, o.to, o.state])) === JSON.stringify(b.overrides.map((o) => [o.days, o.from, o.to, o.state]))

/** Every pack key in the subtree of `key` (incl. itself), in declaration order. */
function packSubtree(pack: PackDeclaration, key: string): Set<string> {
  const out = new Set([key])
  let grew = true
  while (grew) {
    grew = false
    for (const c of pack.categories) {
      if (c.parent && out.has(c.parent) && !out.has(c.key)) {
        out.add(c.key)
        grew = true
      }
    }
  }
  return out
}

export function planPack(current: CatalogueState, pack: PackDeclaration, selection: PackSelection = defaultSelection(pack)): PackPlan {
  const add: PlanItem[] = []
  const equivalent: PlanItem[] = []
  const conflicts: PlanConflict[] = []
  const proposals: LabelProposal[] = []
  const skipped: PlanItem[] = []
  const mapped: Record<string, string> = {}
  const site = { defaultLocale: current.defaultLocale, locales: current.locales }
  const d = current.defaultLocale
  const excluded = new Set(selection.exclude)

  if (current.history.some((h) => h.id === pack.id && h.version === pack.version)) conflicts.push({ code: 'pack_already_applied', area: 'setting', key: historyKeyOf(pack), blocking: true })

  // ── channels ──
  const existingChannels = new Map(current.channels.map((c) => [c.key as string, c]))
  const activeAfter = new Set(current.channels.filter((c) => c.active).map((c) => c.key as string))
  let channelCount = current.channels.length
  for (const c of pack.channels) {
    const existing = existingChannels.get(c.key)
    const item: PlanItem = { area: 'channelSuggestion', key: c.key, label: localizedFor(c.label, site), requiresConfirmation: true }
    if (existing) {
      equivalent.push(item)
      continue
    }
    if (!selection.acceptChannels.includes(c.key)) {
      skipped.push({ ...item, note: 'declined' })
      continue
    }
    const withSchedule = selection.channelRules === 'apply'
    const schedule = withSchedule ? (c.defaultSchedule ?? []).map(toOverride) : []
    const state: ChannelAvailabilityState = withSchedule || !(c.defaultSchedule?.length) ? c.defaultAvailability : (c.defaultAvailabilityWithoutSchedule ?? c.defaultAvailability)
    add.push({ ...item, channel: { defaultAvailability: state, defaultSchedule: schedule } })
    activeAfter.add(c.key)
    channelCount++
    if (current.channelsUnmigrated) conflicts.push({ code: 'channel_migration_pending', area: 'channelSuggestion', key: c.key, blocking: true })
  }
  if (channelCount > CHANNEL_LIMIT) conflicts.push({ code: 'limit_exceeded', area: 'channelSuggestion', key: 'channels', blocking: true, detail: { max: String(CHANNEL_LIMIT) } })

  // ── option groups (before categories: defaults reference their ids) ──
  const groupIds = new Map<string, string>()
  for (const g of pack.optionGroups) {
    const id = optionListIdFor(current.projectSlug, g.key)
    const item: PlanItem = { area: 'optionGroup', key: g.key, label: labelWith(selection, `optionGroup:${g.key}`, localizedFor(g.name, site), site), id, choices: g.choices.length }
    if (current.optionLists.some((l) => l.id === id)) {
      equivalent.push(item)
      groupIds.set(g.key, id)
    } else if (excluded.has(`optionGroup:${g.key}`)) skipped.push({ ...item, note: 'excluded' })
    else {
      add.push(item)
      groupIds.set(g.key, id)
    }
  }

  // ── categories ──
  const byKey = new Map(current.categories.map((n) => [n.key, n]))
  const excludedCats = new Set<string>()
  for (const x of selection.exclude) if (x.startsWith('category:')) for (const k of packSubtree(pack, x.slice(9))) excludedCats.add(k)
  const target = (packKey: string | null): string | null => (packKey === null ? null : (mapped[`category:${packKey}`] ?? packKey))
  let addedCategories = 0
  const extraCategories = (selection.extras?.categories ?? []).filter((x) => !pack.categories.some((c) => c.key === x.key))
  const categoryList = [...pack.categories.map((c) => ({ ...c, label: localizedFor(c.label, site) })), ...extraCategories.map((x) => ({ key: x.key, label: x.label, parent: x.parent, channelRules: undefined, defaultOptionGroups: undefined }))]
  for (const c of categoryList) {
    const label = labelWith(selection, `category:${c.key}`, c.label, site)
    const resolution = selection.resolutions[`category:${c.key}`]
    const existing = byKey.get(c.key)
    if (existing) {
      const item: PlanItem = { area: 'category', key: c.key, parentKey: existing.parentKey, label: existing.label, ...(existing.archivedAt && { note: 'archived_in_project' as const }) }
      equivalent.push(item)
      const expectedParent = target(c.parent)
      if ((existing.parentKey ?? null) !== expectedParent) conflicts.push({ code: 'parent_differs', area: 'category', key: c.key, blocking: false, detail: { project: existing.parentKey ?? '', pack: expectedParent ?? '' } })
      if (!sameLocalized(existing.label, label, d)) conflicts.push({ code: 'label_differs', area: 'category', key: c.key, blocking: false })
      for (const [ch, r] of Object.entries(c.channelRules ?? {})) {
        if (selection.channelRules !== 'apply' || !activeAfter.has(ch)) continue
        if (!sameRule(existing.channelRules[ch as never], toRule(r))) conflicts.push({ code: 'setting_differs', area: 'category', key: c.key, blocking: false, detail: { channel: ch } })
      }
      continue
    }
    if (resolution?.use === 'existing' && byKey.has(resolution.key)) {
      mapped[`category:${c.key}`] = resolution.key
      equivalent.push({ area: 'category', key: c.key, label, mappedTo: resolution.key })
      continue
    }
    if (excludedCats.has(c.key) || (c.parent !== null && excludedCats.has(c.parent))) {
      excludedCats.add(c.key)
      skipped.push({ area: 'category', key: c.key, parentKey: c.parent, label, note: 'excluded' })
      continue
    }
    const rules: PlanRule[] = []
    for (const [ch, r] of Object.entries(c.channelRules ?? {})) {
      if (selection.channelRules !== 'apply') continue
      if (excluded.has(`rule:${c.key}:${ch}`)) {
        skipped.push({ area: 'category', key: c.key, label, note: 'excluded', rules: [{ channel: ch, rule: toRule(r) }] })
        continue
      }
      if (!activeAfter.has(ch)) {
        conflicts.push({ code: 'rule_skipped_inactive_channel', area: 'category', key: c.key, blocking: false, detail: { channel: ch } })
        continue
      }
      rules.push({ channel: ch, rule: toRule(r) })
    }
    const optionListIds = (c.defaultOptionGroups ?? []).flatMap((g) => (groupIds.has(g) ? [groupIds.get(g)!] : []))
    add.push({ area: 'category', key: c.key, parentKey: target(c.parent), label, ...(rules.length && { rules }), ...(optionListIds.length && { optionListIds }) })
    addedCategories++
    if (resolution?.use !== 'add') {
      const want = fold(label[d] ?? '')
      for (const n of current.categories) {
        if (n.key === c.key) continue
        const basis = fold(n.label[d] ?? '') === want ? 'default_locale_label' : Object.values(n.label).some((v) => fold(v) === want) ? 'any_locale_label' : null
        if (basis) {
          proposals.push({ area: 'category', packKey: c.key, existingKey: n.key, basis })
          break
        }
      }
    }
  }
  if (current.categories.length + addedCategories > MAX_CATEGORIES) conflicts.push({ code: 'limit_exceeded', area: 'category', key: 'categories', blocking: true, detail: { max: String(MAX_CATEGORIES) } })

  // ── tags ──
  const tagsByKey = new Map(current.tags.map((t) => [t.key, t]))
  let addedTags = 0
  const tagList = [...pack.tags.map((t) => ({ key: t.key, label: localizedFor(t.label, site) })), ...(selection.extras?.tags ?? []).filter((x) => !pack.tags.some((t) => t.key === x.key))]
  for (const t of tagList) {
    const label = labelWith(selection, `tag:${t.key}`, t.label, site)
    const existing = tagsByKey.get(t.key)
    const resolution = selection.resolutions[`tag:${t.key}`]
    if (existing) {
      equivalent.push({ area: 'tag', key: t.key, label: existing.label, ...(existing.archivedAt && { note: 'archived_in_project' as const }) })
      if (!sameLocalized(existing.label, label, d)) conflicts.push({ code: 'label_differs', area: 'tag', key: t.key, blocking: false })
      continue
    }
    if (resolution?.use === 'existing' && tagsByKey.has(resolution.key)) {
      mapped[`tag:${t.key}`] = resolution.key
      equivalent.push({ area: 'tag', key: t.key, label, mappedTo: resolution.key })
      continue
    }
    if (excluded.has(`tag:${t.key}`)) {
      skipped.push({ area: 'tag', key: t.key, label, note: 'excluded' })
      continue
    }
    add.push({ area: 'tag', key: t.key, label })
    addedTags++
    if (resolution?.use !== 'add') {
      const want = fold(label[d] ?? '')
      const hit = current.tags.find((n) => n.key !== t.key && Object.values(n.label).some((v) => fold(v) === want))
      if (hit) proposals.push({ area: 'tag', packKey: t.key, existingKey: hit.key, basis: fold(hit.label[d] ?? '') === want ? 'default_locale_label' : 'any_locale_label' })
    }
  }
  if (current.tags.length + addedTags > MAX_TAGS) conflicts.push({ code: 'limit_exceeded', area: 'tag', key: 'tags', blocking: true, detail: { max: String(MAX_TAGS) } })

  // ── collections + sections ──
  for (const col of pack.collections) {
    const id = collectionIdFor(current.projectSlug, col.key)
    const name = labelWith(selection, `collection:${col.key}`, localizedFor(col.name, site), site)
    const existing = current.collections.find((x) => x.id === id)
    const sections = flattenSections(col.sections)
    if (existing) {
      equivalent.push({ area: 'collection', key: col.key, label: existing.name, id })
      for (const s of sections) {
        const item: PlanItem = { area: 'section', key: s.key, parentKey: col.key, label: labelWith(selection, `section:${col.key}.${s.key}`, localizedFor(s.name, site), site), id }
        if (existing.sectionKeys.includes(s.key)) equivalent.push(item)
        else if (excluded.has(`section:${col.key}.${s.key}`)) skipped.push({ ...item, note: 'excluded' })
        else add.push(item)
      }
      continue
    }
    if (excluded.has(`collection:${col.key}`)) {
      skipped.push({ area: 'collection', key: col.key, label: name, id, note: 'excluded' })
      continue
    }
    const override = selection.slugOverrides[col.key]
    const slugs: Localized = {}
    for (const [l, v] of Object.entries(name)) {
      const s = slugify(override?.[l] ?? v)
      if (s) slugs[l] = s
    }
    for (const [l, s] of Object.entries(slugs)) {
      const taken = current.takenSlugs.find((x) => x.locale === l && x.slug === s && x.id.replace(/^drafts\./, '') !== id)
      if (taken || !SLUG_PART_PATTERN.test(s)) conflicts.push({ code: 'slug_collision', area: 'collection', key: col.key, blocking: true, detail: { locale: l, slug: s } })
    }
    add.push({ area: 'collection', key: col.key, label: name, id, slugs })
    for (const s of sections) {
      if (excluded.has(`section:${col.key}.${s.key}`)) skipped.push({ area: 'section', key: s.key, parentKey: col.key, label: localizedFor(s.name, site), id, note: 'excluded' })
      else add.push({ area: 'section', key: s.key, parentKey: col.key, label: labelWith(selection, `section:${col.key}.${s.key}`, localizedFor(s.name, site), site), id })
    }
  }

  // ── format templates ──
  for (const f of pack.formatSuggestions) {
    const item: PlanItem = { area: 'formatSuggestion', key: f.key, label: labelWith(selection, `formatSuggestion:${f.key}`, localizedFor(f.label, site), site) }
    if (current.formatTemplates.some((t) => t.key === f.key)) equivalent.push(item)
    else if (excluded.has(`formatSuggestion:${f.key}`)) skipped.push({ ...item, note: 'excluded' })
    else add.push(item)
  }

  // ── publication standard suggestions: the standards store is a later slice (C6 6.12) ──
  for (const p of pack.policySuggestions) skipped.push({ area: 'policySuggestion', key: p.key, label: { [d]: p.requirement }, note: 'not_available_yet' })

  // ── settings (fill-if-empty) ──
  const setting = (key: PackSettingKey, suggested: string | Localized | undefined, currentValue: string | Localized | null, same: boolean) => {
    if (suggested === undefined) return
    const label: Localized = typeof suggested === 'string' ? { [d]: suggested } : suggested
    const item: PlanItem = { area: 'setting', key, label, value: suggested, requiresConfirmation: true }
    const empty = currentValue === null || (typeof currentValue === 'object' && !Object.keys(currentValue).length)
    if (!empty) {
      if (same) equivalent.push({ ...item, note: 'already_set' })
      else conflicts.push({ code: 'setting_differs', area: 'setting', key, blocking: false })
      return
    }
    if (!selection.acceptSettings.includes(key)) return void skipped.push({ ...item, note: 'declined' })
    add.push(item)
    if (key === 'publicSegment') {
      const v = validateSegment(String(suggested), { pageFirstSegments: current.pageFirstSegments, history: current.settings.publicSegmentHistory })
      if (!v.ok) conflicts.push({ code: 'segment_clash', area: 'setting', key, blocking: true, detail: clashDetail(v.clash) })
    }
  }
  const s = current.settings
  if (pack.suggestedPublicName) {
    const name = localizedFor(pack.suggestedPublicName, site)
    setting('publicName', name, Object.keys(s.publicName).length ? s.publicName : null, sameLocalized(s.publicName, name, d))
  }
  setting('defaultItemProfile', pack.suggestedDefaultProfile, s.defaultItemProfile, s.defaultItemProfile === pack.suggestedDefaultProfile)
  setting('publicSegment', pack.suggestedSegment, s.publicSegment, s.publicSegment === pack.suggestedSegment)

  const mutations = 3 + add.filter((i) => i.area === 'collection' || i.area === 'optionGroup').length + new Set(add.filter((i) => i.area === 'section' && !add.some((c) => c.area === 'collection' && c.key === i.parentKey)).map((i) => i.parentKey)).size * 2
  const bytes = JSON.stringify(add).length * 3
  const needsChunking = mutations > PACK_MAX_MUTATIONS_PER_TX || bytes > 1_000_000
  const fingerprint = fingerprintOf({ pack: historyKeyOf(pack), add, equivalent, conflicts, proposals, skipped, mapped, revisions: current.revisions, selection })
  return { pack: { id: pack.id, version: pack.version }, add, equivalent, conflicts, proposals, skipped, mapped, fingerprint, needsChunking }
}

const clashDetail = (c: SegmentClash): Record<string, string> => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)]))

export const isBlocked = (plan: Pick<PackPlan, 'conflicts'>) => plan.conflicts.some((c) => c.blocking)

// ── Update offer (C7.6) ──────────────────────────────────────────────────────

const ADDED_AREA: Record<keyof AppliedPackRecord['added'], PackArea> = {
  categories: 'category',
  tags: 'tag',
  collections: 'collection',
  sections: 'section',
  optionGroups: 'optionGroup',
  channels: 'channelSuggestion',
  formats: 'formatSuggestion',
  settings: 'setting',
}

/** Every key a declaration offers, per area (sections as "<collection>.<section>"). */
function declaredKeys(pack: PackDeclaration): Map<PackArea, Set<string>> {
  const out = new Map<PackArea, Set<string>>()
  const put = (a: PackArea, k: string) => (out.get(a) ?? out.set(a, new Set()).get(a)!).add(k)
  pack.categories.forEach((c) => put('category', c.key))
  pack.tags.forEach((t) => put('tag', t.key))
  pack.collections.forEach((c) => {
    put('collection', c.key)
    flattenSections(c.sections).forEach((s) => put('section', `${c.key}.${s.key}`))
  })
  pack.optionGroups.forEach((g) => put('optionGroup', g.key))
  pack.channels.forEach((c) => put('channelSuggestion', c.key))
  pack.formatSuggestions.forEach((f) => put('formatSuggestion', f.key))
  if (pack.suggestedPublicName) put('setting', 'publicName')
  if (pack.suggestedDefaultProfile) put('setting', 'defaultItemProfile')
  if (pack.suggestedSegment) put('setting', 'publicSegment')
  return out
}

const itemKey = (i: PlanItem) => (i.area === 'section' ? `${i.parentKey}.${i.key}` : i.key)

export type PackUpdatePlan = PackPlan & { from: number; removedByTenant: readonly PlanItem[]; noLongerInPack: readonly PlanItem[] }

/**
 * The optional update to a newer version: `add` = elements of `next` absent from the project,
 * EXCEPT those the earlier record added and the tenant has since removed (`removedByTenant`, never
 * re-added). Elements dropped from `next` are `noLongerInPack` — kept, never deleted. Never automatic.
 */
export function planPackUpdate(current: CatalogueState, applied: AppliedPackRecord, previous: PackDeclaration | null, next: PackDeclaration, selection: PackSelection = defaultSelection(next)): PackUpdatePlan {
  const base = planPack(current, next, selection)
  const earlier = new Map<PackArea, Set<string>>()
  for (const [field, area] of Object.entries(ADDED_AREA) as [keyof AppliedPackRecord['added'], PackArea][]) earlier.set(area, new Set(applied.added[field]))
  const removedByTenant = base.add.filter((i) => i.area !== 'setting' && earlier.get(i.area)?.has(itemKey(i)))
  const add = base.add.filter((i) => !removedByTenant.includes(i))
  const nextKeys = declaredKeys(next)
  const noLongerInPack: PlanItem[] = []
  const prevKeys = previous ? declaredKeys(previous) : earlier
  for (const [area, keys] of prevKeys) for (const k of keys) if (!nextKeys.get(area)?.has(k)) noLongerInPack.push({ area, key: k, label: {} })
  const fingerprint = fingerprintOf({ base: base.fingerprint, removedByTenant, noLongerInPack, from: applied.version })
  return { ...base, add, fingerprint, from: applied.version, removedByTenant, noLongerInPack }
}

export type PackUpdateOffer = { id: PackId; fromVersion: number; toVersion: number }

/** Offered in Setup when the registry has a version greater than the highest applied version of that pack id (C7.6). */
export function packUpdateOffers(history: readonly AppliedPackRecord[], registry: readonly PackDeclaration[]): PackUpdateOffer[] {
  const out: PackUpdateOffer[] = []
  for (const p of registry) {
    if (p.empty) continue
    const applied = history.filter((h) => h.id === p.id).map((h) => h.version)
    if (!applied.length) continue
    const highest = Math.max(...applied)
    if (p.version > highest) out.push({ id: p.id, fromVersion: highest, toVersion: p.version })
  }
  return out
}

/** The new categories' order: after the last existing sibling (new nodes append, existing order untouched). */
export function appendOrder(existing: readonly { parentKey: string | null; order: number }[], parentKey: string | null): number {
  const orders = existing.filter((n) => (n.parentKey ?? null) === parentKey).map((n) => n.order)
  return (orders.length ? Math.max(...orders) : 0) + ORDER_STEP
}
