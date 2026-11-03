// ── Catalogue → Setup — the pure model of the Setup screens (ADR-042 N2a, spec §10, C8 §8.3a) ──
//
// No I/O, no React. Which sections a person sees, the screen-state → action payload mappings
// (channels, format templates, labels, deletion choices), the tree shapes the shared TreeEditor
// needs, and the server impact counts in the shape ImpactPreview reads. Every write is re-checked
// by the server; nothing here decides permissions on its own.

import { ancestorsOf, buildTree, searchCategories } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryKey, CategoryNode, CategoryTree, ChannelAvailabilityRule, DeletionBlocker, MoveRequest, PathContext } from '@/lib/modules/catalogue/taxonomy/types'
import type { AvailabilitySource } from '@/lib/modules/catalogue/commerce/channel-availability'
import { CHANNEL_KEY_MAX, CHANNEL_KEY_PATTERN } from '@/lib/modules/catalogue/commerce/channels'
import { asChannelKey, type ChannelAvailabilityState, type ScheduledOverride } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { QuantityUnit } from '@/lib/modules/catalogue/commerce/formats'
import { TERM_KEY_MAX_LENGTH, TERM_KEY_PATTERN } from '@/lib/taxonomy/ids'
import type { ChannelInput } from '@/lib/modules/catalogue/settings/model'

// ── Sections and who sees them ──────────────────────────────────────────────

/** Setup's sections in their order (spec §10). Publication standards and Import/Export come in later slices and have no entry yet. */
export const SETUP_SECTIONS = ['overview', 'starters', 'categories', 'channels', 'defaults', 'website'] as const
export type SetupSection = (typeof SETUP_SECTIONS)[number]

/** Route segment under `/catalogue/setup` ('' = the Overview itself). */
export const SETUP_SECTION_PATH: Readonly<Record<SetupSection, string>> = {
  overview: '',
  starters: 'starters',
  categories: 'categories',
  channels: 'channels',
  defaults: 'defaults',
  website: 'website',
}

/** What the person holds for this project: `catalogue.setup.manage` and `catalogue.taxonomy.write`. */
export type SetupAccess = { manage: boolean; taxonomy: boolean }

/** N2a / spec §9.2: the Setup permission opens every section; the category permission opens Categories & Tags only. */
export function canOpenSetupSection(section: SetupSection, access: SetupAccess): boolean {
  if (access.manage) return true
  return section === 'categories' && access.taxonomy
}

export const visibleSetupSections = (access: SetupAccess): SetupSection[] => SETUP_SECTIONS.filter((s) => canOpenSetupSection(s, access))

/** Where `/catalogue/setup` lands: the Overview with the Setup permission, Categories & Tags with only the category permission, nowhere otherwise. */
export function setupLanding(access: SetupAccess): SetupSection | null {
  return visibleSetupSections(access)[0] ?? null
}

export function setupHref(projectSlug: string, section: SetupSection): string {
  const path = SETUP_SECTION_PATH[section]
  return `/${projectSlug}/catalogue/setup${path ? `/${path}` : ''}`
}

// ── Localized labels ────────────────────────────────────────────────────────

export type Labels = Record<string, string>

/** A stored label in one language: the language, then the main language, then any language; '' when none. */
export function labelText(label: unknown, locale: string, defaultLocale: string): string {
  if (typeof label === 'string') return label
  if (!label || typeof label !== 'object') return ''
  const l = label as Record<string, unknown>
  const pick = (k: string) => (typeof l[k] === 'string' && (l[k] as string).trim() ? (l[k] as string) : '')
  return pick(locale) || pick(defaultLocale) || (Object.entries(l).find(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())?.[1] as string | undefined) || ''
}

/** A stored label as an editable map of the site's languages (missing ones as ''). */
export function labelsOf(label: unknown, locales: readonly string[]): Labels {
  const l = label && typeof label === 'object' ? (label as Record<string, unknown>) : {}
  return Object.fromEntries(locales.map((x) => [x, typeof l[x] === 'string' ? (l[x] as string) : '']))
}

/** The filled languages only, trimmed. */
export function cleanLabels(labels: Labels): Labels {
  return Object.fromEntries(Object.entries(labels).flatMap(([l, v]) => (typeof v === 'string' && v.trim() ? [[l, v.trim()]] : [])))
}

/** An update patch: changed languages with their text, emptied ones as null (removes that language). */
export function labelPatch(before: Labels, after: Labels): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const l of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = (before[l] ?? '').trim()
    const a = (after[l] ?? '').trim()
    if (a === b) continue
    out[l] = a ? a : null
  }
  return out
}

/** The site languages that have no text yet. */
export const missingLocales = (label: unknown, locales: readonly string[]): string[] =>
  locales.filter((l) => !(label && typeof label === 'object' && typeof (label as Record<string, unknown>)[l] === 'string' && ((label as Record<string, unknown>)[l] as string).trim()))

// ── Stable keys (never shown to editors) ────────────────────────────────────

function slugPart(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A stable key made from the name in the main language, unique among `taken`. Channels need a
 * leading letter (C2 key pattern, ≤ 40); format templates follow the term-key rule (≤ 48).
 */
export function keyFromLabel(text: string, taken: Iterable<string>, kind: 'channel' | 'template'): string {
  const used = new Set(taken)
  const max = kind === 'channel' ? CHANNEL_KEY_MAX : TERM_KEY_MAX_LENGTH
  const pattern = kind === 'channel' ? CHANNEL_KEY_PATTERN : TERM_KEY_PATTERN
  let base = slugPart(text)
  if (kind === 'channel' && base && !/^[a-z]/.test(base)) base = `c-${base}`
  if (!base) base = kind === 'channel' ? 'channel' : 'format'
  base = base.slice(0, max - 4).replace(/-+$/, '')
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (!used.has(candidate) && pattern.test(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, max)
}

// ── Channels (C2) ───────────────────────────────────────────────────────────

/** One channel as the Setup screen edits it (the settings view entry, label as a map). */
export type ChannelDraft = {
  key: string
  label: Labels
  active: boolean
  defaultAvailability: ChannelAvailabilityState
  defaultSchedule: readonly ScheduledOverride[]
  /** false = stored before C2 (no explicit default yet, C10-4). */
  explicitDefault: boolean
}

export function channelDraftsOf(channels: readonly { key: string; label: unknown; active: boolean; defaultAvailability: ChannelAvailabilityState; defaultSchedule: readonly ScheduledOverride[]; explicitDefault: boolean }[], locales: readonly string[]): ChannelDraft[] {
  return channels.map((c) => ({ key: c.key, label: cleanLabels(labelsOf(c.label, locales)), active: c.active, defaultAvailability: c.defaultAvailability, defaultSchedule: c.defaultSchedule, explicitDefault: c.explicitDefault }))
}

/** Stored channels predate C2: the server refuses edits until the data update runs (`channel_migration_pending`). */
export const channelsNeedMigration = (channels: readonly Pick<ChannelDraft, 'explicitDefault'>[]): boolean => channels.some((c) => !c.explicitDefault)

/** The whole list as `saveCatalogueChannelsAction` takes it (order = list order). */
export function channelInputs(list: readonly ChannelDraft[]): ChannelInput[] {
  return list.map((c) => ({
    key: c.key,
    label: cleanLabels(c.label),
    active: c.active,
    defaultAvailability: c.defaultAvailability,
    defaultSchedule: c.defaultSchedule.map((o) => ({ key: o.key, days: [...o.days], from: o.from, to: o.to, state: o.state })),
  }))
}

export const channelDefaultRuleOf = (c: Pick<ChannelDraft, 'defaultAvailability' | 'defaultSchedule'>): ChannelAvailabilityRule => ({ state: c.defaultAvailability, overrides: c.defaultSchedule })

/** Replace one channel (by key) in the list. */
export const withChannel = (list: readonly ChannelDraft[], next: ChannelDraft): ChannelDraft[] => list.map((c) => (c.key === next.key ? next : c))

// ── Impact (server counts → ImpactPreview) ──────────────────────────────────

/** C12 ImpactCounts as the server returns them. */
export type ServerImpact = { items: number; formats: number; toAvailable?: number; toUnavailable?: number; shieldedByOverride: number }

export const previewImpact = (i: ServerImpact) => ({ itemsChanged: i.items, formatsChanged: i.formats, shieldedByOverride: i.shieldedByOverride })

export const hasImpact = (i: ServerImpact) => i.items > 0 || i.formats > 0 || i.shieldedByOverride > 0

/** Several channel changes summed (one confirmation for one save). */
export function sumImpact(list: readonly ServerImpact[]): ServerImpact {
  return list.reduce<ServerImpact>((a, i) => ({ items: a.items + i.items, formats: a.formats + i.formats, shieldedByOverride: a.shieldedByOverride + i.shieldedByOverride }), { items: 0, formats: 0, shieldedByOverride: 0 })
}

// ── Category tree shapes (TreeEditor) ───────────────────────────────────────

/** A flat ordered list (tags, channels, format templates) as a one-level tree, for the shared TreeEditor. */
export function flatTree(keys: readonly string[]): CategoryTree {
  return buildTree(keys.map((key, i): CategoryNode => ({ key, label: {}, parentKey: null, order: (i + 1) * 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null })))
}

/** Matching categories (name or full path) with their ancestors, so the result keeps its structure. Archived ones match too. */
export function searchTree(tree: CategoryTree, query: string, ctx: PathContext): CategoryTree {
  const hits = searchCategories(tree, query, { ...ctx, includeArchived: true })
  const keep = new Set<string>()
  for (const k of hits) {
    keep.add(k)
    for (const a of ancestorsOf(tree, k)) keep.add(a)
  }
  return buildTree([...tree.nodes.values()].filter((n) => keep.has(n.key)))
}

/** A move that stays in the same parent is a reorder (taxonomy.write); anything else changes the structure (setup.manage). */
export const isReorder = (tree: CategoryTree, req: MoveRequest): boolean => (tree.parentOf.get(req.key) ?? null) === req.newParentKey

/** The parent's children in their new order after `req` (a reorder). */
export function reorderedSiblings(tree: CategoryTree, req: MoveRequest): string[] {
  const parent = req.newParentKey
  const siblings = [...(parent === null ? tree.roots : (tree.childrenOf.get(parent) ?? []))].filter((k) => k !== req.key)
  const at = req.index === undefined ? siblings.length : Math.max(0, Math.min(siblings.length, req.index))
  siblings.splice(at, 0, req.key)
  return siblings
}

/** The same for a flat list. */
export const reorderedList = (keys: readonly string[], req: MoveRequest): string[] => reorderedSiblings(flatTree(keys), { ...req, newParentKey: null })

/** Root first, the category last, as keys (AvailabilitySource path). */
export const pathKeys = (tree: CategoryTree, key: CategoryKey): CategoryKey[] => [...ancestorsOf(tree, key)].reverse().concat(key)

/**
 * What "Inherit" gives a category on one channel: the nearest ancestor's complete rule, else the
 * channel's default (C5 levels: project default → category). Never merges (D-6.1).
 */
export function inheritedCategoryRule(
  tree: CategoryTree,
  key: CategoryKey,
  channel: Pick<ChannelDraft, 'key' | 'defaultAvailability' | 'defaultSchedule'>,
): { rule: ChannelAvailabilityRule; source: AvailabilitySource } {
  const ch = asChannelKey(channel.key)
  for (const a of ancestorsOf(tree, key)) {
    const rule = tree.nodes.get(a)?.channelRules?.[ch]
    if (rule) return { rule, source: { level: 'category', channel: ch, categoryKey: a, path: pathKeys(tree, a), inheritedFromAncestor: true } }
  }
  return { rule: channelDefaultRuleOf(channel), source: { level: 'projectDefault', channel: ch } }
}

export const sameRule = (a: ChannelAvailabilityRule | null | undefined, b: ChannelAvailabilityRule | null | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ── Category deletion (D-3) ─────────────────────────────────────────────────

/** Which choices a deletion needs: where the items go, where the sub-categories go, and what must be changed by hand. */
export function deletionNeeds(blockers: readonly DeletionBlocker[]): { items: number; children: number; cleanup: DeletionBlocker[]; manual: DeletionBlocker[] } {
  const items = blockers.filter((b) => b.code === 'used_as_primary' || b.code === 'used_as_additional').reduce((n, b) => Math.max(n, b.count), 0)
  const children = blockers.find((b) => b.code === 'has_children')?.count ?? 0
  const rest = blockers.filter((b) => !['used_as_primary', 'used_as_additional', 'has_children', 'unknown_category'].includes(b.code))
  return { items, children, cleanup: rest.filter((b) => b.cleanable), manual: rest.filter((b) => !b.cleanable) }
}

/** The person's choices → `{ reassignTo, promoteChildrenTo }` (only the ones the blockers ask for). */
export type ItemsChoice = { kind: 'remove' } | { kind: 'move'; to: CategoryKey }
export type ChildrenChoice = { kind: 'parent' } | { kind: 'top' } | { kind: 'into'; to: CategoryKey }
export function deletionOptions(needs: { items: number; children: number }, items: ItemsChoice | null, children: ChildrenChoice | null): { reassignTo?: string | null; promoteChildrenTo?: string | null | 'parent' } {
  return {
    ...(needs.items > 0 && items && { reassignTo: items.kind === 'remove' ? null : items.to }),
    ...(needs.children > 0 && children && { promoteChildrenTo: children.kind === 'parent' ? 'parent' : children.kind === 'top' ? null : children.to }),
  }
}

// ── Format templates (C3-6) ─────────────────────────────────────────────────

export type TemplateDraft = { key: string; label: Labels; quantity: { value: number; unit: QuantityUnit } | null }

/** The whole list as `saveCatalogueSettingsAction({ set: { formatTemplates } })` takes it. */
export function templateInputs(list: readonly TemplateDraft[]): { key: string; label: Labels; quantity?: { value: number; unit: QuantityUnit } }[] {
  return list.map((t) => ({ key: t.key, label: cleanLabels(t.label), ...(t.quantity && { quantity: { value: t.quantity.value, unit: t.quantity.unit } }) }))
}

/** "33", "0,75" → 33 / 0.75; '' → null (no quantity); otherwise undefined (not a quantity). */
export function parseQuantity(text: string): number | null | undefined {
  const s = text.trim().replace(',', '.')
  if (!s) return null
  if (!/^\d+(?:\.\d+)?$/.test(s)) return undefined
  const n = Number(s)
  return n > 0 ? n : undefined
}
