// ── Pack application — the pure mutation builder (contract C7.5) ─────────────
// `buildPackMutations(plan, pack, state, ctx)` turns an EXACT plan into the
// Sanity mutations of one transaction (or, for an oversize pack, ordered
// chunks) plus the history record. Pure and tested without Sanity; the service
// (service.ts) only converts the abstract `config` mutation into the guarded
// key-level patch of the settings service and commits.
//
// Taxonomy rows are built with the taxonomy service's pure write model
// (newCategoryRow / newTagRow / ruleRows) — never a second shape. Existing rows
// are carried byte-identical; new nodes append after the last sibling. Every
// guarded document (taxonomy, project, history) carries `ifRevisionID`.
// Collections and option lists are DRAFTS with deterministic ids; never published.

import { estimateMutationBytes, SANITY_MUTATION_MAX_BYTES } from '@/lib/sanity/limits'
import { ORDER_STEP } from '@/lib/taxonomy/rules'
import { asChannelKey } from '../commerce/commerce-types'
import { channelEntry } from '../settings/model'
import { applySegmentChange } from '../segment'
import { catalogueTaxonomyId, CATALOGUE_TAXONOMY_TYPE } from '../taxonomy/read'
import { fingerprintOf, newCategoryRow, newTagRow, ruleRows, storedLabel, type StoredRow } from '../taxonomy/write-model'
import type { ChannelRules } from '../taxonomy/types'
import { packHistoryId, PACK_HISTORY_TYPE } from './history'
import { appendOrder, PACK_MAX_MUTATIONS_PER_TX, type CatalogueState, type PackPlan, type PlanItem } from './plan'
import type { AppliedPackAdded, AppliedPackRecord, PackDeclaration } from './types'
import { flattenSections } from './validate'

/** C-13: the single-transaction byte budget, deliberately far under Sanity's limit. */
export const PACK_MAX_TX_BYTES = Math.min(1_000_000, SANITY_MUTATION_MAX_BYTES)
export const PACK_RUN_TYPE = 'cataloguePackRun'
/** Sanity ids allow [A-Za-z0-9._-] only, so the marker spells `<id>@<version>` as `<id>-v<version>`. */
export const packRunId = (projectSlug: string, pack: { id: string; version: number }) => `catalogue-pack-run.${projectSlug}.${pack.id}-v${pack.version}`

export type PackMutation =
  | { kind: 'create'; doc: Record<string, unknown> & { _id: string; _type: string } }
  | { kind: 'createIfNotExists'; doc: Record<string, unknown> & { _id: string; _type: string } }
  | { kind: 'patch'; id: string; ifRevisionID?: string; set?: Record<string, unknown>; setIfMissing?: Record<string, unknown>; insert?: { after: string; items: unknown[] } }
  /** Catalogue module config keys on the project document (the settings service's key-level patch), guarded by the project revision. */
  | { kind: 'config'; ifRevisionID: string; set: Record<string, unknown> }
  | { kind: 'delete'; id: string }

export type PackMutationPlan = {
  chunks: PackMutation[][]
  history: AppliedPackRecord
  singleTransaction: boolean
  /** Serialized estimate of the whole set. */
  bytes: number
}

export type BuildContext = { now: string; userId: string; setupSource: 'pack' | 'empty' }

const emptyAdded = (): AppliedPackAdded => ({ categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: [] })

/** A pure, stable UUID-shaped id from a seed (deterministic `publicId` of a pack-created collection). */
export function stableUuid(seed: string): string {
  const h = fingerprintOf({ a: seed }) + fingerprintOf({ b: seed })
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const sectionRow = (item: PlanItem, parentKey: string | null) => ({
  _key: item.key,
  _type: 'catalogueSection',
  name: storedLabel(item.label as Record<string, string>),
  ...(parentKey && { parentKey }),
  items: [],
})

/**
 * The draft of a pack collection — the fields the dashboard's create path writes
 * (createCatalogueDoc: projectSlug, publicId once, collectionType, hasPage false,
 * visibility public, sections) with the deterministic `_id` and the pack's name and slugs.
 */
export function packCollectionDoc(state: Pick<CatalogueState, 'projectSlug'>, collection: PlanItem, sections: readonly PlanItem[], pack: PackDeclaration): Record<string, unknown> & { _id: string; _type: string } {
  const declared = pack.collections.find((c) => c.key === collection.key)!
  const parents = new Map(flattenSections(declared.sections).map((s) => [s.key, s.parentKey]))
  const slug = Object.fromEntries(Object.entries(collection.slugs ?? {}).map(([l, s]) => [l, { _type: 'slug', current: s }]))
  return {
    _id: `drafts.${collection.id}`,
    _type: 'catalogueCollection',
    projectSlug: state.projectSlug,
    publicId: stableUuid(collection.id!),
    name: storedLabel(collection.label as Record<string, string>),
    collectionType: declared.collectionType,
    hasPage: false,
    visibility: 'public',
    sections: sections.map((s) => sectionRow(s, parents.get(s.key) ?? null)),
    ...(Object.keys(slug).length && { slug: { _type: 'localizedSlug', ...slug } }),
  }
}

/** The draft of a pack option list: choices with no price change; a free-text "add" choice starts "not reviewed" (ADR-033 D-3a). */
export function packOptionListDoc(state: Pick<CatalogueState, 'projectSlug' | 'defaultLocale' | 'locales'>, item: PlanItem, pack: PackDeclaration, labelFor: (l: Record<string, string | undefined>) => Record<string, string>): Record<string, unknown> & { _id: string; _type: string } {
  const g = pack.optionGroups.find((x) => x.key === item.key)!
  return {
    _id: `drafts.${item.id}`,
    _type: 'catalogueOptionList',
    projectSlug: state.projectSlug,
    name: storedLabel(item.label as Record<string, string>),
    // D-22 (C1.12.8): the option list's "Use for" from the pack (written on create only).
    ...(g.useFor?.length && { useFor: [...g.useFor] }),
    options: g.choices.map((c) => ({
      _key: c.key,
      _type: 'catalogueOption',
      label: storedLabel(labelFor(c.label)),
      kind: c.kind,
      priceDelta: 0,
      ...(c.kind === 'add' && { allergenDeclaration: { status: 'notReviewed' } }),
    })),
  }
}

const SYSTEM = new Set(['_id', '_rev', '_createdAt', '_updatedAt', '_type'])

/** The stored history entry (`catalogueAppliedPack`): `mapped` as rows, never a map (attribute-path budget). */
export function storedHistoryEntry(rec: AppliedPackRecord): Record<string, unknown> {
  return {
    _key: rec._key,
    _type: 'catalogueAppliedPack',
    id: rec.id,
    version: rec.version,
    appliedAt: rec.appliedAt,
    appliedBy: rec.appliedBy,
    added: rec.added,
    mapped: Object.entries(rec.mapped).map(([from, to]) => ({ _key: from.replace(/[^A-Za-z0-9_-]/g, '-'), from, to })),
    skipped: rec.skipped,
  }
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])]

/** The history record of this application (keys only). `journal` = what earlier chunks of an interrupted run added. */
export function historyRecord(plan: PackPlan, ctx: Pick<BuildContext, 'now' | 'userId'>, journal?: AppliedPackAdded): AppliedPackRecord {
  const added = emptyAdded()
  for (const i of plan.add) {
    if (i.area === 'category') added.categories.push(i.key)
    else if (i.area === 'tag') added.tags.push(i.key)
    else if (i.area === 'collection') added.collections.push(i.key)
    else if (i.area === 'section') added.sections.push(`${i.parentKey}.${i.key}`)
    else if (i.area === 'optionGroup') added.optionGroups.push(i.key)
    else if (i.area === 'channelSuggestion') added.channels.push(i.key)
    else if (i.area === 'formatSuggestion') added.formats.push(i.key)
    else if (i.area === 'setting') added.settings.push(i.key)
  }
  if (journal) for (const k of Object.keys(added) as (keyof AppliedPackAdded)[]) added[k] = union(journal[k] ?? [], added[k])
  return {
    _key: `${plan.pack.id}@${plan.pack.version}`,
    id: plan.pack.id,
    version: plan.pack.version,
    appliedAt: ctx.now,
    appliedBy: ctx.userId,
    added,
    mapped: { ...plan.mapped },
    skipped: plan.skipped.map((i) => `${i.area}:${i.area === 'section' ? `${i.parentKey}.${i.key}` : i.key}`),
  }
}

/** New taxonomy rows appended to the stored ones (existing rows untouched, byte-identical). */
export function taxonomyRows(plan: PackPlan, state: CatalogueState): { categories: StoredRow[]; tags: StoredRow[]; changed: boolean } {
  const categories: StoredRow[] = [...state.raw.categories]
  const tags: StoredRow[] = [...state.raw.tags]
  const placed: { parentKey: string | null; order: number }[] = state.categories.map((n) => ({ parentKey: n.parentKey, order: n.order }))
  let changed = false
  for (const i of plan.add) {
    if (i.area !== 'category') continue
    const parentKey = i.parentKey ?? null
    const order = appendOrder(placed, parentKey)
    placed.push({ parentKey, order })
    const row: StoredRow = newCategoryRow(i.key, i.label as Record<string, string>, parentKey, order, i.useFor ?? [])
    const rules: ChannelRules = Object.fromEntries((i.rules ?? []).map((r) => [r.channel, r.rule]))
    const rows = ruleRows(rules)
    if (rows.length) row.channelRules = rows
    if (i.optionListIds?.length) row.defaultOptionListIds = [...i.optionListIds]
    categories.push(row)
    changed = true
  }
  let tagOrder = state.tags.reduce((m, t) => Math.max(m, t.order), 0)
  for (const i of plan.add) {
    if (i.area !== 'tag') continue
    tagOrder += ORDER_STEP
    tags.push(newTagRow(i.key, i.label as Record<string, string>, tagOrder, i.useFor ?? []))
    changed = true
  }
  return { categories, tags, changed }
}

/** The Catalogue config keys this application sets (fill-if-empty is decided by the plan; the project revision guards the rest). */
export function configSet(plan: PackPlan, state: CatalogueState, pack: PackDeclaration, ctx: BuildContext): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  const channels = plan.add.filter((i) => i.area === 'channelSuggestion' && i.channel)
  if (channels.length) {
    set.serviceChannels = [
      ...state.raw.serviceChannels,
      ...channels.map((i) =>
        channelEntry({ key: asChannelKey(i.key), label: i.label as Record<string, string>, active: true, defaultAvailability: i.channel!.defaultAvailability, defaultSchedule: i.channel!.defaultSchedule, entryKey: `ch-${i.key}`, explicitDefault: true }),
      ),
    ]
  }
  const formats = plan.add.filter((i) => i.area === 'formatSuggestion')
  if (formats.length) {
    set.formatTemplates = [
      ...state.raw.formatTemplates,
      ...formats.map((i) => {
        const q = pack.formatSuggestions.find((f) => f.key === i.key)?.quantity
        return { _key: i.key, _type: 'catalogueFormatTemplate', key: i.key, label: storedLabel(i.label as Record<string, string>), ...(q && { quantity: { value: q.value, unit: q.unit } }) }
      }),
    ]
  }
  for (const i of plan.add) {
    if (i.area !== 'setting') continue
    if (i.key === 'publicName') set.publicName = storedLabel(i.value as Record<string, string>)
    else if (i.key === 'defaultItemProfile') set.defaultItemProfile = i.value
    else if (i.key === 'publicSegment') {
      const applied = applySegmentChange(state.settings.publicSegment ?? '', state.settings.publicSegmentHistory, String(i.value))
      set.publicSegment = applied.segment
      set.publicSegmentHistory = applied.history
    }
  }
  // D-14: applying any pack (or Empty) completes setup — stored separately from pack history.
  if (!state.settings.setupCompletedAt) {
    set.setupCompletedAt = ctx.now
    set.setupSource = ctx.setupSource
  }
  return set
}

export function buildPackMutations(plan: PackPlan, pack: PackDeclaration, state: CatalogueState, ctx: BuildContext, opts: { maxMutations?: number; maxBytes?: number; journal?: AppliedPackAdded; runExists?: boolean } = {}): PackMutationPlan {
  const history = historyRecord(plan, ctx, opts.journal)
  const docs: PackMutation[] = []

  // collections (fresh) + their sections
  for (const c of plan.add.filter((i) => i.area === 'collection')) {
    const sections = plan.add.filter((i) => i.area === 'section' && i.parentKey === c.key)
    docs.push({ kind: 'createIfNotExists', doc: packCollectionDoc(state, c, sections, pack) })
  }
  // sections added to an EXISTING collection (update path): written to its draft (C-11)
  const fresh = new Set(plan.add.filter((i) => i.area === 'collection').map((i) => i.key))
  const bySection = new Map<string, PlanItem[]>()
  for (const s of plan.add) if (s.area === 'section' && !fresh.has(s.parentKey!)) (bySection.get(s.id!) ?? bySection.set(s.id!, []).get(s.id!)!).push(s)
  for (const [id, sections] of bySection) {
    const declared = pack.collections.find((c) => c.key === sections[0].parentKey)!
    const parents = new Map(flattenSections(declared.sections).map((s) => [s.key, s.parentKey]))
    const rows = sections.map((s) => sectionRow(s, parents.get(s.key) ?? null))
    const existing = state.raw.collections[id] ?? {}
    if (existing.draft) {
      docs.push({ kind: 'patch', id: `drafts.${id}`, ...(typeof existing.draft._rev === 'string' && { ifRevisionID: existing.draft._rev }), setIfMissing: { sections: [] }, insert: { after: 'sections[-1]', items: rows } })
    } else if (existing.published) {
      // The draft is created from the published copy first; the published copy is never patched.
      const copy: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(existing.published)) if (!SYSTEM.has(k)) copy[k] = v
      const before = Array.isArray(copy.sections) ? (copy.sections as unknown[]) : []
      docs.push({ kind: 'create', doc: { ...copy, _id: `drafts.${id}`, _type: 'catalogueCollection', projectSlug: state.projectSlug, sections: [...before, ...rows] } })
    }
  }
  // option lists
  const labelFor = (l: Record<string, string | undefined>) => {
    const out: Record<string, string> = {}
    for (const loc of state.locales) if (typeof l[loc] === 'string' && l[loc]) out[loc] = l[loc]!
    if (!out[state.defaultLocale]) out[state.defaultLocale] = l.en ?? ''
    return out
  }
  for (const g of plan.add.filter((i) => i.area === 'optionGroup')) docs.push({ kind: 'createIfNotExists', doc: packOptionListDoc(state, g, pack, labelFor) })

  // taxonomy (always ONE mutation: the tree is never split)
  const tax = taxonomyRows(plan, state)
  const taxId = catalogueTaxonomyId(state.projectSlug)
  const taxonomy: PackMutation[] = !tax.changed
    ? []
    : state.revisions.taxonomy
      ? [{ kind: 'patch', id: taxId, ifRevisionID: state.revisions.taxonomy, set: { categories: tax.categories, tags: tax.tags, updatedAt: ctx.now, updatedBy: ctx.userId } }]
      : [{ kind: 'create', doc: { _id: taxId, _type: CATALOGUE_TAXONOMY_TYPE, projectSlug: state.projectSlug, categories: tax.categories, tags: tax.tags, updatedAt: ctx.now, updatedBy: ctx.userId } }]

  // project config + history (history ONLY in the transaction that completes everything)
  const set = configSet(plan, state, pack, ctx)
  const config: PackMutation[] = Object.keys(set).length ? [{ kind: 'config', ifRevisionID: state.revisions.project, set }] : []
  const histId = packHistoryId(state.projectSlug)
  const entry = storedHistoryEntry(history)
  const historyMutation: PackMutation = state.revisions.history
    ? { kind: 'patch', id: histId, ifRevisionID: state.revisions.history, setIfMissing: { applied: [] }, insert: { after: 'applied[-1]', items: [entry] } }
    : { kind: 'create', doc: { _id: histId, _type: PACK_HISTORY_TYPE, projectSlug: state.projectSlug, applied: [entry] } }

  const all = [...taxonomy, ...docs, ...config, historyMutation]
  const bytes = estimateMutationBytes(all)
  const maxMutations = opts.maxMutations ?? PACK_MAX_MUTATIONS_PER_TX
  const maxBytes = opts.maxBytes ?? PACK_MAX_TX_BYTES
  const runId = packRunId(state.projectSlug, plan.pack)
  if (all.length <= maxMutations && bytes <= maxBytes && !opts.runExists) return { chunks: [all], history, singleTransaction: true, bytes }

  // ── large packs: taxonomy + run marker → documents (journalled) → settings + history + marker delete ──
  const journal = opts.journal ?? emptyAdded()
  const taxAdded = { ...emptyAdded(), categories: history.added.categories.filter((k) => !journal.categories.includes(k)), tags: history.added.tags.filter((k) => !journal.tags.includes(k)) }
  const marker: PackMutation = opts.runExists
    ? { kind: 'patch', id: runId, set: { status: 'running', updatedAt: ctx.now } }
    : { kind: 'create', doc: { _id: runId, _type: PACK_RUN_TYPE, projectSlug: state.projectSlug, packId: plan.pack.id, packVersion: plan.pack.version, status: 'running', startedAt: ctx.now, startedBy: ctx.userId, journal: { ...emptyAdded(), ...journal, categories: union(journal.categories, taxAdded.categories), tags: union(journal.tags, taxAdded.tags) } } }
  const chunks: PackMutation[][] = [[...taxonomy, marker]]
  const perChunk = Math.max(1, maxMutations - 3)
  for (let i = 0; i < docs.length; i += perChunk) {
    const part = docs.slice(i, i + perChunk)
    const keys = { collections: [] as string[], optionGroups: [] as string[], sections: [] as string[] }
    for (const m of part) {
      const doc = m.kind === 'create' || m.kind === 'createIfNotExists' ? m.doc : null
      const id = doc ? doc._id.replace(/^drafts\./, '') : m.kind === 'patch' ? m.id.replace(/^drafts\./, '') : ''
      const item = plan.add.find((x) => x.id === id && (x.area === 'collection' || x.area === 'optionGroup'))
      if (item?.area === 'collection') keys.collections.push(item.key)
      if (item?.area === 'optionGroup') keys.optionGroups.push(item.key)
      for (const s of plan.add) if (s.area === 'section' && s.id === id) keys.sections.push(`${s.parentKey}.${s.key}`)
    }
    const journalPatch: PackMutation = { kind: 'patch', id: runId, setIfMissing: { 'journal.collections': [], 'journal.optionGroups': [], 'journal.sections': [] }, insert: { after: 'journal.collections[-1]', items: keys.collections } }
    const extra: PackMutation[] = [journalPatch]
    if (keys.optionGroups.length) extra.push({ kind: 'patch', id: runId, insert: { after: 'journal.optionGroups[-1]', items: keys.optionGroups } })
    if (keys.sections.length) extra.push({ kind: 'patch', id: runId, insert: { after: 'journal.sections[-1]', items: keys.sections } })
    chunks.push([...part, ...extra])
  }
  chunks.push([...config, historyMutation, { kind: 'delete', id: runId }])
  return { chunks, history, singleTransaction: false, bytes }
}
