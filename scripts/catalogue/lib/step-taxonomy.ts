// ── D1 — taxonomy copy + item assignment (C1.9, C10-6 D1) ─────────────────────
// Pure. Mapping: seedTaxonomyFromTerms (vocabulary) and
// legacyCategoriesToAssignment (items) — the same functions the R1 readers and
// the R2 service use; nothing is re-implemented here.
//
//   1. `catalogue-taxonomy.<slug>` via createIfNotExists (skipped where it exists:
//      the R2 service may have seeded it); keys and labels verbatim.
//   2. every catalogueItem document (published, drafts.*, versions.*): set
//      primaryCategory/additionalCategories from `categories` unless either is
//      already present (an R2 write is newer and wins); `categories` KEPT.
//   3. verification: assignment = legacy set, primary = first existing category,
//      vocabulary labels per locale equal, nothing else changed.

import { catalogueTaxonomyId, itemCategoryAssignment, readCategoryNodes, readTagNodes } from '../../../src/lib/modules/catalogue/taxonomy/read'
import { buildTree, legacyCategoriesToAssignment } from '../../../src/lib/modules/catalogue/taxonomy/tree'
import { seedTaxonomyFromTerms, type SeedTermRow } from '../../../src/lib/modules/catalogue/taxonomy/seed'
import { MAX_CATEGORIES, MAX_TAGS } from '../../../src/lib/modules/catalogue/taxonomy/limits'
import { cleanTextMap } from '../../../src/lib/taxonomy/vocabulary'
import type { CategoryTree } from '../../../src/lib/modules/catalogue/taxonomy/types'
import { catalogueProjects, docsOfType, groupByBase, idClassOf, isPublished, sameValue, unchangedExcept, type Doc } from './docs'
import { allowedFor, check, checksResult, guardedPatch, unmarkGroup, type Check, type Finding, type ProjectPlan, type Refusal, type StepContext, type StepDefinition, type StepPlan } from './step'

const legacyKeys = (v: unknown): string[] => {
  const out: string[] = []
  for (const raw of Array.isArray(v) ? v : []) {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (k && !out.includes(k)) out.push(k)
  }
  return out
}

const hasNewFields = (d: Doc) => (typeof d.primaryCategory === 'string' && d.primaryCategory.trim() !== '') || Array.isArray(d.additionalCategories)

export type Vocabulary = { tree: CategoryTree; categories: Map<string, Record<string, string>>; tags: Map<string, Record<string, string>>; source: 'document' | 'terms' | 'config' | 'none' }

/** The vocabulary a project reads today: its taxonomy document if any, else the seed of its term records / config list. */
export function projectVocabulary(docs: readonly Doc[], slug: string, config: Record<string, unknown>) {
  const existing = docs.find((d) => d._id === catalogueTaxonomyId(slug)) ?? null
  const terms = docsOfType(docs, 'taxonomyTerm', slug).filter((t) => t.module === 'catalogue' && isPublished(t))
  const seed = seedTaxonomyFromTerms(terms as SeedTermRow[], Array.isArray(config.categories) ? (config.categories as never[]) : null)
  const catRows = existing ? existing.categories : seed.categories
  const tagRows = existing ? existing.tags : seed.tags
  const nodes = readCategoryNodes(catRows)
  const vocab: Vocabulary = {
    tree: buildTree(nodes),
    categories: new Map(nodes.map((n) => [n.key, cleanTextMap((Array.isArray(catRows) ? (catRows as Record<string, unknown>[]) : []).find((r) => r?.key === n.key)?.label)])),
    tags: new Map(readTagNodes(tagRows).map((t) => [t.key, cleanTextMap((Array.isArray(tagRows) ? (tagRows as Record<string, unknown>[]) : []).find((r) => r?.key === t.key)?.label)])),
    source: existing ? 'document' : seed.categorySource,
  }
  return { existing, seed, terms, vocab }
}

function plan(docs: readonly Doc[], ctx: StepContext): StepPlan {
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const slug = view.slug
    const { existing, seed, terms, vocab } = projectVocabulary(docs, slug, view.config)
    const r = (code: string, extra: Partial<Refusal> = {}) => refusals.push({ step: 'taxonomy', code, project: slug, ...extra })
    const f = (code: string, extra: Partial<Finding> = {}) => findings.push({ step: 'taxonomy', code, project: slug, ...extra })

    // Taxonomy integrity (C10-6 P: cycles/duplicates).
    for (const s of seed.findings) {
      if (s.code === 'colorNotCarried') f('taxonomy.colorNotCarried', { detail: { key: s.key } })
      else r(`taxonomy.${s.code}`, { detail: s })
    }
    for (const issue of vocab.tree.issues) r('taxonomy.treeIssue', { detail: issue })
    if (vocab.categories.size > MAX_CATEGORIES) r('taxonomy.tooManyCategories', { detail: { count: vocab.categories.size, max: MAX_CATEGORIES } })
    if (vocab.tags.size > MAX_TAGS) r('taxonomy.tooManyTags', { detail: { count: vocab.tags.size, max: MAX_TAGS } })
    const termDrafts = docsOfType(docs, 'taxonomyTerm', slug).filter((t) => t.module === 'catalogue' && !isPublished(t))
    if (termDrafts.length) f('taxonomy.termDraftsIgnored', { detail: { ids: termDrafts.map((t) => t._id) } })
    const configKeys = legacyKeys((Array.isArray(view.config.categories) ? view.config.categories : []).map((e) => (e as { value?: unknown })?.value))
    if (seed.categorySource === 'terms' && configKeys.length) {
      const termKeys = [...vocab.categories.keys()]
      f('taxonomy.configListIgnored', { detail: { configKeys, termKeys, stale: configKeys.join(',') !== termKeys.join(',') } })
    }
    if (seed.categorySource === 'config') f('taxonomy.seededFromConfigList', { detail: { count: seed.categories.length } })
    if (existing) f('taxonomy.documentExists', { id: existing._id })

    const groups: ProjectPlan['groups'] = []
    if (!existing && (seed.categories.length || seed.tags.length || terms.length || configKeys.length)) {
      groups.push({
        key: `taxonomy:${slug}`,
        mutations: [{ createIfNotExists: { _id: catalogueTaxonomyId(slug), _type: 'catalogueTaxonomy', projectSlug: slug, categories: seed.categories, tags: seed.tags, updatedAt: ctx.now, updatedBy: 'migration' } }],
      })
    }

    let assigned = 0
    let unassigned = 0
    let already = 0
    for (const [base, pair] of groupByBase(docsOfType(docs, 'catalogueItem', slug))) {
      const mutations: ProjectPlan['groups'][number]['mutations'] = []
      for (const doc of pair) {
        if (idClassOf(doc._id) === 'version' && !ctx.acceptVersions) {
          r('item.versionsPresent', { id: doc._id })
          continue
        }
        if (hasNewFields(doc)) {
          already++
          continue
        }
        const legacy = legacyKeys(doc.categories)
        const a = legacyCategoriesToAssignment(legacy, vocab.tree)
        const missing = legacy.filter((k) => !vocab.tree.nodes.has(k))
        if (missing.length) f('item.unknownCategory', { id: doc._id, detail: { keys: missing } })
        if (legacy.length > 1) f('item.multiCategory', { id: doc._id, detail: { legacy, primary: a.primary, additional: a.additional } })
        if (a.primary === null) {
          unassigned++
          continue
        }
        assigned++
        mutations.push(guardedPatch(doc, { set: { primaryCategory: a.primary, additionalCategories: a.additional } }))
      }
      if (mutations.length) groups.push({ key: `item:${base}`, mutations })
    }
    projects.push({ slug, groups, counts: { categories: vocab.categories.size, tags: vocab.tags.size, itemsAssigned: assigned, itemsUnassigned: unassigned, itemsAlreadyAssigned: already } })
  }
  return { step: 'taxonomy', projects, refusals, findings }
}

function verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext): ReturnType<typeof checksResult> {
  const vocabDiffs: unknown[] = []
  const itemDiffs: unknown[] = []
  const afterById = new Map(after.map((d) => [d._id, d]))
  for (const view of catalogueProjects(before)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const want = projectVocabulary(before, view.slug, view.config).vocab
    const doc = afterById.get(catalogueTaxonomyId(view.slug))
    if (!doc) {
      vocabDiffs.push({ project: view.slug, missing: catalogueTaxonomyId(view.slug) })
      continue
    }
    const gotCats = new Map(readCategoryNodes(doc.categories).map((n) => [n.key, n.label]))
    const gotTags = new Map(readTagNodes(doc.tags).map((t) => [t.key, t.label]))
    const cmp = (kind: string, w: Map<string, Record<string, string>>, g: Map<string, Record<string, string>>) => {
      if ([...w.keys()].join('\u0000') !== [...g.keys()].join('\u0000')) vocabDiffs.push({ project: view.slug, kind, keys: { before: [...w.keys()], after: [...g.keys()] } })
      for (const [k, label] of w) if (!sameValue(label, g.get(k) ?? null)) vocabDiffs.push({ project: view.slug, kind, key: k, before: label, after: g.get(k) ?? null })
    }
    cmp('category', want.categories, gotCats)
    cmp('tag', want.tags, gotTags)
    const tree = buildTree(readCategoryNodes(doc.categories))
    for (const b of docsOfType(before, 'catalogueItem', view.slug)) {
      const a = afterById.get(b._id)
      if (!a) {
        itemDiffs.push({ id: b._id, missing: true })
        continue
      }
      if (!sameValue(b.categories, a.categories)) itemDiffs.push({ id: b._id, field: 'categories', note: 'legacy field must be kept until R3' })
      if (hasNewFields(b)) {
        if (!sameValue([b.primaryCategory, b.additionalCategories], [a.primaryCategory, a.additionalCategories])) itemDiffs.push({ id: b._id, note: 'pre-existing assignment changed' })
        continue
      }
      const legacy = legacyKeys(b.categories).filter((k) => tree.nodes.has(k))
      const got = itemCategoryAssignment({ primaryCategory: a.primaryCategory, additionalCategories: a.additionalCategories, categories: a.categories })
      const gotSet = got.primary === null ? got.additional : [got.primary, ...got.additional]
      const setOk = [...legacy].sort().join('\u0000') === [...gotSet].sort().join('\u0000')
      const primaryOk = (legacy[0] ?? null) === got.primary
      if (!setOk || !primaryOk) itemDiffs.push({ id: b._id, legacy, primary: got.primary, additional: got.additional })
    }
  }
  const checks: Check[] = [
    check('taxonomy.vocabulary', vocabDiffs),
    check('taxonomy.itemAssignment', itemDiffs),
    check('taxonomy.unchangedElsewhere', unchangedExcept(scoped(before, ctx), scoped(after, ctx), allowedFor('taxonomy', after, ctx.project))),
  ]
  return checksResult(checks)
}

/** Restrict a snapshot to one project (CLI --project) for the unchanged check. */
export const scoped = (docs: readonly Doc[], ctx: { project?: string }) => (ctx.project ? docs.filter((d) => d.projectSlug === ctx.project) : [...docs])

function revert(docs: readonly Doc[], ctx: StepContext): StepPlan {
  // C10-7 after D1: unset primaryCategory/additionalCategories on documents whose values
  // still equal the D1 output; the taxonomy document may stay (pre-R1 code ignores it).
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const doc = docs.find((d) => d._id === catalogueTaxonomyId(view.slug))
    const tree = buildTree(readCategoryNodes(doc?.categories))
    const groups: ProjectPlan['groups'] = []
    let reverted = 0
    for (const [base, pair] of groupByBase(docsOfType(docs, 'catalogueItem', view.slug))) {
      const mutations: ProjectPlan['groups'][number]['mutations'] = []
      for (const d of pair) {
        if (!hasNewFields(d)) continue
        const a = legacyCategoriesToAssignment(legacyKeys(d.categories), tree)
        if (d.primaryCategory === a.primary && sameValue(d.additionalCategories, a.additional)) {
          mutations.push(guardedPatch(d, { unset: ['primaryCategory', 'additionalCategories'] }))
          reverted++
        } else findings.push({ step: 'taxonomy', code: 'revert.changedSinceD1', project: view.slug, id: d._id })
      }
      if (mutations.length) groups.push({ key: `item:${base}`, mutations })
    }
    const unmark = unmarkGroup(view, 'taxonomy', refusals)
    if (unmark.mutations.length) groups.push(unmark)
    projects.push({ slug: view.slug, groups, counts: { reverted } })
  }
  return { step: 'taxonomy', projects, refusals, findings }
}

export const taxonomyStep: StepDefinition<'migration.taxonomy'> = {
  step: 'taxonomy',
  auditKind: 'migration.taxonomy',
  requires: [],
  plan,
  verify,
  auditDetail(slug, _before, after, ctx) {
    const view = catalogueProjects(after).find((v) => v.slug === slug)
    if (!view) return null
    const doc = after.find((d) => d._id === catalogueTaxonomyId(slug))
    const items = docsOfType(after, 'catalogueItem', slug)
    return {
      migrationId: ctx.migrationId,
      categories: readCategoryNodes(doc?.categories).length,
      tags: readTagNodes(doc?.tags).length,
      itemsAssigned: items.filter(hasNewFields).length,
      itemsUnassigned: items.filter((d) => !hasNewFields(d)).length,
    }
  },
  revert,
}
