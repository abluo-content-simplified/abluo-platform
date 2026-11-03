// ── Catalogue vocabulary readers — R1 triple dual-read (contract C1.8, C1.9) ──
//
// Pure: no React, no I/O. While the rollout runs a project's Catalogue
// vocabulary lives in one of three places. Resolution order, PER KIND:
//
//   (a) the `catalogue-taxonomy.<projectSlug>` document, when it exists and holds
//       that kind (the array field is present) → used ENTIRELY, never mixed;
//   (b) else `taxonomyTerm` records with module "catalogue" (Amendment J);
//   (c) else, categories only, the legacy `config.categories` list.
//
// (b)+(c) are exactly today's `catalogueCategoryVocabulary`, so a project with no
// taxonomy document (every project before data step D1) reads precisely what it
// read before R1. Item assignment is read from `primaryCategory` /
// `additionalCategories` when either is present, else through
// `legacyCategoriesToAssignment(categories)` (D-15).

import { ORDER_STEP } from '@/lib/taxonomy/rules'
import { SLUG_PART_PATTERN } from '@/lib/taxonomy/ids'
import { catalogueCategoryVocabulary, cleanTextMap, tagVocabulary, type CategoryTermRow, type VocabularyEntry } from '@/lib/taxonomy/vocabulary'
import { readRuleRows } from '../commerce/read'
import { fieldsFromUseFor } from './profile-applicability'
import { buildTree, legacyCategoriesToAssignment, treeOrder } from './tree'
import type { CategoryAssignment, CategoryNode, CategoryTree, ChannelRules, TagNode } from './types'

// ── ids and GROQ ─────────────────────────────────────────────────────────────

export const CATALOGUE_TAXONOMY_TYPE = 'catalogueTaxonomy'
export const CATALOGUE_TAXONOMY_ID_PREFIX = 'catalogue-taxonomy.'

/** Deterministic document id. Throws on an invalid slug — never builds a lookalike id. */
export function catalogueTaxonomyId(projectSlug: string): string {
  if (!SLUG_PART_PATTERN.test(projectSlug ?? '')) throw new Error(`catalogueTaxonomyId: invalid projectSlug "${projectSlug}"`)
  return `${CATALOGUE_TAXONOMY_ID_PREFIX}${projectSlug}`
}

/**
 * The one shared GROQ fragment (C1.8): an expression to embed under a key of a
 * project-scoped query. `labelExpr` is evaluated per node, so the dashboard passes
 * `label` (whole map) and the website a locale chain. A missing document → null;
 * a document without one of the arrays → that member null (= "has no such kind").
 */
export function catalogueTaxonomyGroq(labelExpr: string): string {
  return `*[_type == "${CATALOGUE_TAXONOMY_TYPE}" && _id == "${CATALOGUE_TAXONOMY_ID_PREFIX}" + $projectSlug && projectSlug == $projectSlug][0]{ "categories": categories[]{ key, "label": ${labelExpr}, parentKey, order, channelRules, defaultOptionListIds, archivedAt, useFor }, "tags": tags[]{ key, "label": ${labelExpr}, order, archivedAt, useFor } }`
}

// ── raw shapes ───────────────────────────────────────────────────────────────

export type RawTaxonomyCategory = {
  key?: unknown
  label?: unknown
  parentKey?: unknown
  order?: unknown
  channelRules?: unknown
  defaultOptionListIds?: unknown
  archivedAt?: unknown
  /** D-22 (C1.12): roots only; readers ignore it on a child. */
  useFor?: unknown
}
export type RawTaxonomyTag = { key?: unknown; label?: unknown; order?: unknown; archivedAt?: unknown; useFor?: unknown }
export type RawCatalogueTaxonomy = { categories?: readonly (RawTaxonomyCategory | null)[] | null; tags?: readonly (RawTaxonomyTag | null)[] | null } | null | undefined

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const finiteOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const labelMap = (v: unknown): Record<string, string> => (typeof v === 'string' ? {} : cleanTextMap(v))

// ── channel rule rows (C5a-2 stored shape) ───────────────────────────────────
// The commerce slice owns the reader of stored `catalogueChannelRule` rows
// (commerce/read.ts readRuleRows → availability-schedule.ts readChannelRule):
// one reader of the shape at every level (category, item, format). C1 only
// carries the result as a plain record on the node; it evaluates nothing.

/**
 * Stored rows → { channel → complete rule }, through the commerce reader `readRuleRows`
 * (malformed rows dropped; identical duplicates collapse; conflicting rows for
 * one channel leave the channel UNSET — D-21, never an arbitrary winner).
 */
export function readCategoryChannelRules(rows: unknown): ChannelRules {
  const out: ChannelRules = {}
  for (const [key, rule] of readRuleRows(rows).rules) out[key] = rule
  return out
}

// ── document → nodes ─────────────────────────────────────────────────────────

/** Stored categories → nodes (stored order kept; buildTree reports duplicates/orphans/cycles). */
export function readCategoryNodes(rows: unknown): CategoryNode[] {
  const out: CategoryNode[] = []
  ;(Array.isArray(rows) ? rows : []).forEach((row: RawTaxonomyCategory | null, at: number) => {
    const key = str(row?.key)
    if (!row || !key) return
    out.push({
      key,
      label: labelMap(row.label),
      parentKey: str(row.parentKey) || null,
      order: finiteOr(row.order, (at + 1) * ORDER_STEP),
      channelRules: readCategoryChannelRules(row.channelRules),
      defaultOptionListIds: (Array.isArray(row.defaultOptionListIds) ? row.defaultOptionListIds : []).filter((x): x is string => typeof x === 'string' && x !== ''),
      archivedAt: str(row.archivedAt) || null,
      ...fieldsFromUseFor(row.useFor),
    })
  })
  return out
}

/** Stored tags → nodes, sorted by order then key; first row per key wins. */
export function readTagNodes(rows: unknown): TagNode[] {
  const seen = new Set<string>()
  const out: TagNode[] = []
  ;(Array.isArray(rows) ? rows : []).forEach((row: RawTaxonomyTag | null, at: number) => {
    const key = str(row?.key)
    if (!row || !key || seen.has(key)) return
    seen.add(key)
    out.push({ key, label: labelMap(row.label), order: finiteOr(row.order, (at + 1) * ORDER_STEP), archivedAt: str(row.archivedAt) || null, ...fieldsFromUseFor(row.useFor) })
  })
  return out.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** A flat tree (every key a root, in the given order) for a vocabulary that has no hierarchy. */
export function flatTree(keys: readonly string[]): CategoryTree {
  return buildTree(
    keys.map((key, i) => ({ key, label: {}, parentKey: null, order: (i + 1) * ORDER_STEP, channelRules: {}, defaultOptionListIds: [], archivedAt: null })),
  )
}

// ── the triple dual-read ─────────────────────────────────────────────────────

export type VocabularySource = 'document' | 'terms' | 'config'

/** A vocabulary entry; `parentKey`/`archived`/`useFor` only for document-sourced entries. */
export type CatalogueVocabularyEntry = VocabularyEntry & { parentKey?: string | null; archived?: boolean; useFor?: readonly string[]; useForCorrupt?: true }

export type CatalogueVocabulary<C> = {
  categories: CatalogueVocabularyEntry[] | C
  categorySource: VocabularySource
  tags: CatalogueVocabularyEntry[]
  tagSource: Exclude<VocabularySource, 'config'>
  /** Always present: the document's tree, or a flat tree over the legacy keys. */
  tree: CategoryTree
}

const entryKeys = (entries: unknown): string[] =>
  (Array.isArray(entries) ? entries : []).flatMap((e) => {
    const v = (e as { value?: unknown } | null)?.value
    return typeof v === 'string' && v.trim() ? [v.trim()] : []
  })

const isLabel = (v: unknown): v is VocabularyEntry['label'] => v == null || typeof v === 'string' || (typeof v === 'object' && !Array.isArray(v))

/**
 * The Catalogue vocabulary for one project. `taxonomy` is the projected document
 * (catalogueTaxonomyGroq), `categoryTerms`/`tagTerms` the term rows, `configCategories`
 * the legacy list (returned untouched when it is the source, like today).
 * Labels pass through exactly as projected (a map for the dashboard, a resolved
 * string for the website). Document entries are in tree order (pre-order).
 */
export function catalogueVocabulary<C>(input: {
  taxonomy?: RawCatalogueTaxonomy
  categoryTerms?: readonly (CategoryTermRow | null | undefined)[] | null
  tagTerms?: readonly (CategoryTermRow | null | undefined)[] | null
  configCategories: C
}): CatalogueVocabulary<C> {
  const doc = input.taxonomy && typeof input.taxonomy === 'object' ? input.taxonomy : null

  let categories: CatalogueVocabularyEntry[] | C
  let categorySource: VocabularySource
  let tree: CategoryTree
  if (doc && Array.isArray(doc.categories)) {
    const nodes = readCategoryNodes(doc.categories)
    tree = buildTree(nodes)
    const rawByKey = new Map<string, RawTaxonomyCategory>()
    for (const r of doc.categories) {
      const k = str(r?.key)
      if (k && !rawByKey.has(k)) rawByKey.set(k, r as RawTaxonomyCategory)
    }
    categories = treeOrder(tree).map((key) => {
      const raw = rawByKey.get(key)
      return { value: key, label: isLabel(raw?.label) ? raw?.label : undefined, parentKey: tree.parentOf.get(key) ?? null, archived: !!tree.nodes.get(key)!.archivedAt }
    })
    categorySource = 'document'
  } else {
    const legacy = catalogueCategoryVocabulary(input.categoryTerms, input.configCategories)
    categorySource = legacy === input.configCategories ? 'config' : 'terms'
    categories = legacy as CatalogueVocabularyEntry[] | C
    tree = flatTree(entryKeys(legacy))
  }

  let tags: CatalogueVocabularyEntry[]
  let tagSource: 'document' | 'terms'
  if (doc && Array.isArray(doc.tags)) {
    const rawByKey = new Map<string, RawTaxonomyTag>()
    for (const r of doc.tags) {
      const k = str(r?.key)
      if (k && !rawByKey.has(k)) rawByKey.set(k, r as RawTaxonomyTag)
    }
    tags = readTagNodes(doc.tags).map((t) => {
      const raw = rawByKey.get(t.key)
      return { value: t.key, label: isLabel(raw?.label) ? raw?.label : undefined, archived: !!t.archivedAt, ...(t.useFor && { useFor: t.useFor }), ...(t.useForCorrupt && { useForCorrupt: true as const }) }
    })
    tagSource = 'document'
  } else {
    tags = tagVocabulary(input.tagTerms)
    tagSource = 'terms'
  }

  return { categories, categorySource, tags, tagSource, tree }
}

// ── item assignment ──────────────────────────────────────────────────────────

export type RawItemCategories = { primaryCategory?: unknown; additionalCategories?: unknown; categories?: unknown } | null | undefined

/**
 * An item's categories, from whichever shape it stores (C1.9 R1): the new fields when
 * either is present, else the legacy list via legacyCategoriesToAssignment (first
 * existing category = primary when a tree is given, D-15).
 */
export function itemCategoryAssignment(row: RawItemCategories, tree?: CategoryTree): CategoryAssignment {
  const r = row ?? {}
  const hasNew = (typeof r.primaryCategory === 'string' && r.primaryCategory.trim() !== '') || Array.isArray(r.additionalCategories)
  if (!hasNew) return legacyCategoriesToAssignment(Array.isArray(r.categories) ? (r.categories as string[]) : null, tree)
  const primary = str(r.primaryCategory) || null
  const additional: string[] = []
  for (const k of Array.isArray(r.additionalCategories) ? r.additionalCategories : []) {
    const v = str(k)
    if (v && v !== primary && !additional.includes(v)) additional.push(v)
  }
  return { primary, additional }
}

/** The item's category keys, primary first — what every legacy `categories` reader consumed. */
export function itemCategoryKeys(row: RawItemCategories, tree?: CategoryTree): string[] {
  const a = itemCategoryAssignment(row, tree)
  return a.primary !== null ? [a.primary, ...a.additional] : [...a.additional]
}
