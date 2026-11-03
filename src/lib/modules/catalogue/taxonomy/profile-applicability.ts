// ── Catalogue — profile applicability, "Use for" (contract C1.12, decision D-22) ──
//
// THE one implementation of "is this category / tag / option list used for this
// item's profile?". Pure: no React, no I/O, no clock — imported by the item
// writer, the publish gate, readiness, Studio validation, the pickers, Setup,
// packs and the read-only report script. Nothing re-implements it.
//
// Model (C1.12.1): an optional `useFor: ItemProfile[]` on ROOT categories (all
// descendants inherit; a child's own value is ignored), on each Catalogue tag and
// on each option list. Absent or empty = every profile ("All item types") — no
// sentinel is stored. A stored list holding only unknown ids applies to NO
// profile (`useForCorrupt`): a corrupt value never widens applicability.

import { PROFILE_ORDER, isItemProfile, type ItemProfile } from '../profiles'
import { ancestorsOf } from './tree'
import type { CategoryAssignment, CategoryKey, CategoryTree, TagNode, UseFor } from './types'

export type { UseFor }

/** Anything that carries a "Use for" (a root category node, a tag node, an option list). */
export type UseForCarrier = { useFor?: UseFor; useForCorrupt?: true }

// ── reading and writing the stored value ────────────────────────────────────

/** Stored value → profiles (deduplicated, PROFILE_ORDER). `unknownOnly` when a non-empty list held no known id. */
export function readUseFor(raw: unknown): { profiles: ItemProfile[]; unknownOnly: boolean } {
  if (!Array.isArray(raw) || raw.length === 0) return { profiles: [], unknownOnly: false }
  const known = new Set(raw.filter(isItemProfile))
  const profiles = PROFILE_ORDER.filter((p) => known.has(p))
  return { profiles, unknownOnly: profiles.length === 0 }
}

/** The node fields a reader sets from a stored value (spread into CategoryNode / TagNode / option-list rows). */
export function fieldsFromUseFor(raw: unknown): UseForCarrier {
  const r = readUseFor(raw)
  if (r.unknownOnly) return { useFor: [], useForCorrupt: true }
  return r.profiles.length ? { useFor: r.profiles } : {}
}

/**
 * Writer input → the profiles to store, or null when the input is malformed (not an array, an
 * unknown id). `[]` = "All item types" (the writer UNSETS the field).
 */
export function cleanUseFor(raw: unknown): ItemProfile[] | null {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > PROFILE_ORDER.length * 2) return null
  if (!raw.every(isItemProfile)) return null
  const set = new Set(raw)
  return PROFILE_ORDER.filter((p) => set.has(p))
}

/** What a writer stores: the list, or undefined (= unset the field; "All item types"). */
export const storedUseFor = (profiles: readonly ItemProfile[]): ItemProfile[] | undefined => (profiles.length ? [...profiles] : undefined)

/** The effective list of a carrier (empty = all). */
export const profilesOf = (c: UseForCarrier | undefined): ItemProfile[] => (c?.useFor ? [...c.useFor] : [])

export const sameUseFor = (a: readonly ItemProfile[], b: readonly ItemProfile[]): boolean => a.length === b.length && a.every((p, i) => b[i] === p)

// ── the rule ────────────────────────────────────────────────────────────────

/** True when `carrier` is used for `profile`. Absent / empty = every profile; a corrupt list = none. */
export function appliesTo(carrier: UseForCarrier | undefined, profile: ItemProfile): boolean {
  if (!carrier) return true
  if (carrier.useForCorrupt) return false
  return !carrier.useFor || carrier.useFor.length === 0 || carrier.useFor.includes(profile)
}

/** The root of `key`'s path in the built tree (itself for a root); null for an unknown key. */
export function rootOf(tree: CategoryTree, key: CategoryKey): CategoryKey | null {
  if (!tree.nodes.has(key)) return null
  return ancestorsOf(tree, key).at(-1) ?? key
}

/** C1.12.2: the profiles a category serves = its ROOT's "Use for" ([] = all). Unknown key → [] (reported elsewhere). */
export function effectiveProfiles(tree: CategoryTree, key: CategoryKey): ItemProfile[] {
  const root = rootOf(tree, key)
  return root === null ? [] : profilesOf(tree.nodes.get(root))
}

export function isCategoryCompatible(tree: CategoryTree, key: CategoryKey, profile: ItemProfile): boolean {
  const root = rootOf(tree, key)
  return root === null || appliesTo(tree.nodes.get(root), profile)
}

/** An unknown tag (undefined) is compatible here: unknown keys are an integrity question, not a profile one. */
export const isTagCompatible = (tag: UseForCarrier | undefined, profile: ItemProfile): boolean => appliesTo(tag, profile)

export const isOptionListCompatible = (list: UseForCarrier | undefined, profile: ItemProfile): boolean => appliesTo(list, profile)

// ── item findings ───────────────────────────────────────────────────────────

export type ProfileFindingKind = 'primary' | 'additional' | 'tag' | 'option'

export type ProfileFinding =
  | { kind: 'primary' | 'additional'; key: CategoryKey; root: CategoryKey; useFor: ItemProfile[] }
  | { kind: 'tag'; key: string; useFor: ItemProfile[] }
  | { kind: 'option'; key: string; useFor: ItemProfile[] }

/** What the rule needs about one item. `profile` null = no valid profile yet (no findings; `profileMissing` covers it). */
export type ApplicabilityItem = {
  profile: ItemProfile | null
  assignment: CategoryAssignment
  tags: readonly string[]
  /** Attached option list ids (base ids, attachment order). */
  optionListIds: readonly string[]
}

export type ApplicabilityTaxonomy = { tree: CategoryTree; tags: readonly Pick<TagNode, 'key' | 'useFor' | 'useForCorrupt'>[] }

/** Option list id (base id) → its "Use for" (undefined = unknown list / all). */
export type OptionListUseFor = ReadonlyMap<string, UseForCarrier | undefined>

const NO_LISTS: OptionListUseFor = new Map()

/**
 * C1.12.3: every assignment of `item` whose "Use for" excludes its profile, in the fixed order
 * primary → additional (stored order) → tags (stored order) → option lists (attachment order).
 * Both primary AND additional categories must be compatible.
 */
export function incompatibleAssignments(item: ApplicabilityItem, taxonomy: ApplicabilityTaxonomy, optionLists: OptionListUseFor = NO_LISTS): ProfileFinding[] {
  const p = item.profile
  if (!p) return []
  const out: ProfileFinding[] = []
  const cat = (kind: 'primary' | 'additional', key: CategoryKey) => {
    if (isCategoryCompatible(taxonomy.tree, key, p)) return
    const root = rootOf(taxonomy.tree, key) ?? key
    out.push({ kind, key, root, useFor: profilesOf(taxonomy.tree.nodes.get(root)) })
  }
  if (item.assignment.primary !== null) cat('primary', item.assignment.primary)
  for (const k of item.assignment.additional) cat('additional', k)
  const tags = new Map(taxonomy.tags.map((t) => [t.key, t]))
  const seenTags = new Set<string>()
  for (const k of item.tags) {
    if (seenTags.has(k)) continue
    seenTags.add(k)
    const tag = tags.get(k)
    if (!isTagCompatible(tag, p)) out.push({ kind: 'tag', key: k, useFor: profilesOf(tag) })
  }
  const seenLists = new Set<string>()
  for (const id of item.optionListIds) {
    if (seenLists.has(id)) continue
    seenLists.add(id)
    const list = optionLists.get(id)
    if (!isOptionListCompatible(list, p)) out.push({ kind: 'option', key: id, useFor: profilesOf(list) })
  }
  return out
}

const assigned = (item: ApplicabilityItem, f: ProfileFinding): boolean => {
  switch (f.kind) {
    case 'primary':
    case 'additional':
      return item.assignment.primary === f.key || item.assignment.additional.includes(f.key)
    case 'tag':
      return item.tags.includes(f.key)
    case 'option':
      return item.optionListIds.includes(f.key)
  }
}

/**
 * The writer's rule (C1.12.4): findings of `after` for terms that `before` did not already carry.
 * A profile change alone therefore never refuses (existing assignments are kept and surface as
 * findings); ADDING an incompatible category, tag or option list does.
 */
export function newIncompatibleAssignments(before: ApplicabilityItem, after: ApplicabilityItem, taxonomy: ApplicabilityTaxonomy, optionLists: OptionListUseFor = NO_LISTS): ProfileFinding[] {
  return incompatibleAssignments(after, taxonomy, optionLists).filter((f) => !assigned(before, f))
}

/**
 * C1.12.6 narrowing impact: items (drafts included; one per id) that have NO finding under `before`
 * for the changed term but do under `after`. Pure over what the service read.
 */
export function narrowingImpact(
  items: readonly { id: string; item: ApplicabilityItem }[],
  before: { taxonomy: ApplicabilityTaxonomy; optionLists?: OptionListUseFor },
  after: { taxonomy: ApplicabilityTaxonomy; optionLists?: OptionListUseFor },
): { items: number; sample: string[] } {
  const key = (f: ProfileFinding) => `${f.kind === 'additional' || f.kind === 'primary' ? 'category' : f.kind}:${f.key}`
  const ids = new Set<string>()
  for (const { id, item } of items) {
    const was = new Set(incompatibleAssignments(item, before.taxonomy, before.optionLists).map(key))
    if (incompatibleAssignments(item, after.taxonomy, after.optionLists).some((f) => !was.has(key(f)))) ids.add(id)
  }
  return { items: ids.size, sample: [...ids].slice(0, 10) }
}

// ── stored documents ────────────────────────────────────────────────────────

const baseId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

/** Attached option list ids of a stored item (`optionLists[].list._ref`), base ids, attachment order. */
export function optionListIdsOf(doc: { optionLists?: unknown } | null | undefined): string[] {
  const out: string[] = []
  for (const a of Array.isArray(doc?.optionLists) ? doc!.optionLists : []) {
    const ref = (a as { list?: { _ref?: unknown } } | null)?.list?._ref
    if (typeof ref === 'string' && ref && !out.includes(baseId(ref))) out.push(baseId(ref))
  }
  return out
}

/** Stored tag keys of an item. */
export const tagKeysOf = (doc: { tags?: unknown } | null | undefined): string[] => (Array.isArray(doc?.tags) ? doc!.tags.filter((t): t is string => typeof t === 'string' && t !== '') : [])

/**
 * Option list rows (drafts and published; `{ _id, useFor }`) → id → carrier, with the C1.12 copy
 * rule shared by gate, writer and Studio: the PUBLISHED list's value, else its draft's.
 */
export function optionListUseForOf(rows: readonly ({ _id?: unknown; useFor?: unknown } | null | undefined)[] | null | undefined): Map<string, UseForCarrier> {
  const published = new Map<string, UseForCarrier>()
  const drafts = new Map<string, UseForCarrier>()
  for (const r of rows ?? []) {
    if (!r || typeof r._id !== 'string') continue
    ;(r._id.startsWith('drafts.') ? drafts : published).set(baseId(r._id), fieldsFromUseFor(r.useFor))
  }
  const out = new Map(drafts)
  for (const [k, v] of published) out.set(k, v)
  return out
}

/** Dashboard vocabulary terms (`{ value, label, useFor? }`, CatalogueTerm) → the rule's tags (with labels for names). */
export function applicabilityTagsOf(terms: readonly ({ value: string; label?: Record<string, string> } & UseForCarrier)[]): ({ key: string; label?: Record<string, string> } & UseForCarrier)[] {
  return terms.map((t) => ({ key: t.value, ...(t.label && { label: t.label }), ...(t.useFor && { useFor: t.useFor }), ...(t.useForCorrupt && { useForCorrupt: true as const }) }))
}

/** A short, English sentence for Studio validation and scripts (the dashboard uses its own i18n). */
export function describeProfileFinding(f: ProfileFinding, profile: ItemProfile, labelOf: (f: ProfileFinding) => string = (x) => x.key): string {
  const what = f.kind === 'primary' ? 'Main category' : f.kind === 'additional' ? 'Category' : f.kind === 'tag' ? 'Tag' : 'Option list'
  return `${what} "${labelOf(f)}" isn't used for ${profile}. Remove or replace it before publishing.`
}
