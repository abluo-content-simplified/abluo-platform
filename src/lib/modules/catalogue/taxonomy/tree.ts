// ── Catalogue category tree — the ONE implementation (contract C1.6, K-9) ────
//
// Pure: no React, no I/O, no Date.now. Every Catalogue surface — Setup, pickers,
// the public resolver, readiness (C6), availability (C5), packs (C7), listings —
// imports these; none re-implements traversal, ancestry, cycle refusal or paths.
//
// Tolerant of corrupt data: buildTree never throws; findings go to tree.issues
// and the tree is repaired deterministically (orphans become roots, a cycle is
// cut at its lexicographically smallest key, the first node of a duplicated key
// wins).

import { ORDER_STEP } from '@/lib/taxonomy/rules'
import { IN_USE_SAMPLE_LIMIT, MAX_ADDITIONAL_CATEGORIES, MAX_DEPTH, PATH_SEPARATOR } from './limits'
import type {
  AssignmentValidation,
  CategoryAssignment,
  CategoryAssignmentState,
  CategoryDeletionPlan,
  CategoryKey,
  CategoryNode,
  CategoryPath,
  CategoryReferenceKind,
  CategoryReferences,
  CategoryTree,
  ChannelAvailabilityRule,
  ChannelKey,
  DeletionBlocker,
  DeletionBlockerCode,
  DeletionRoute,
  MovePlan,
  MoveRequest,
  PathContext,
  PrimaryPath,
  TreeIssue,
} from './types'

// ── building ─────────────────────────────────────────────────────────────────

const byKeyThenNothing = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** I4: order among siblings; ties break by key; non-finite order sorts last. */
function compareSiblings(nodes: ReadonlyMap<CategoryKey, CategoryNode>) {
  return (a: CategoryKey, b: CategoryKey): number => {
    const oa = nodes.get(a)!.order
    const ob = nodes.get(b)!.order
    const fa = Number.isFinite(oa)
    const fb = Number.isFinite(ob)
    if (fa && fb && oa !== ob) return oa - ob
    if (fa !== fb) return fa ? -1 : 1
    return byKeyThenNothing(a, b)
  }
}

/** Never throws. Tolerant of corrupt data; findings go to tree.issues. */
export function buildTree(input: readonly CategoryNode[]): CategoryTree {
  const issues: TreeIssue[] = []
  const nodes = new Map<CategoryKey, CategoryNode>()
  for (const n of input ?? []) {
    if (!n || typeof n.key !== 'string' || n.key === '') continue
    if (nodes.has(n.key)) {
      issues.push({ code: 'duplicate-key', key: n.key })
      continue
    }
    nodes.set(n.key, n)
  }

  // Effective parents: unknown parent → root (orphan).
  const parentOf = new Map<CategoryKey, CategoryKey | null>()
  for (const [key, n] of nodes) {
    const p = typeof n.parentKey === 'string' && n.parentKey !== '' ? n.parentKey : null
    if (p !== null && !nodes.has(p)) {
      issues.push({ code: 'orphan', key, detail: p })
      parentOf.set(key, null)
    } else parentOf.set(key, p)
  }

  // Cycles: walk each chain; on a revisit, cut the cycle at its smallest key.
  const settled = new Set<CategoryKey>()
  for (const start of [...nodes.keys()].sort(byKeyThenNothing)) {
    if (settled.has(start)) continue
    const onPath: CategoryKey[] = []
    const index = new Map<CategoryKey, number>()
    let cur: CategoryKey | null = start
    while (cur !== null && !settled.has(cur)) {
      if (index.has(cur)) {
        const cycle = onPath.slice(index.get(cur)!)
        const cut = [...cycle].sort(byKeyThenNothing)[0]
        parentOf.set(cut, null)
        issues.push({ code: 'cycle', key: cut, detail: cycle.join(' > ') })
        break
      }
      index.set(cur, onPath.length)
      onPath.push(cur)
      cur = parentOf.get(cur) ?? null
    }
    for (const k of onPath) settled.add(k)
  }

  const compare = compareSiblings(nodes)
  const children = new Map<CategoryKey, CategoryKey[]>()
  const roots: CategoryKey[] = []
  for (const key of nodes.keys()) children.set(key, [])
  for (const [key, p] of parentOf) (p === null ? roots : children.get(p)!).push(key)
  roots.sort(compare)
  for (const list of children.values()) list.sort(compare)

  const depthOf = new Map<CategoryKey, number>()
  const stack: { key: CategoryKey; depth: number }[] = roots.map((key) => ({ key, depth: 0 })).reverse()
  while (stack.length) {
    const { key, depth } = stack.pop()!
    depthOf.set(key, depth)
    if (depth >= MAX_DEPTH) issues.push({ code: 'depth-exceeded', key, detail: String(depth + 1) })
    const kids = children.get(key)!
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ key: kids[i], depth: depth + 1 })
  }

  return { nodes, roots, childrenOf: children, parentOf, depthOf, issues }
}

// ── traversal ────────────────────────────────────────────────────────────────

/** Nearest parent first, root last; excludes the node; unknown key → []. */
export function ancestorsOf(tree: CategoryTree, key: CategoryKey): CategoryKey[] {
  const out: CategoryKey[] = []
  if (!tree.nodes.has(key)) return out
  let p = tree.parentOf.get(key) ?? null
  while (p !== null && out.length <= tree.nodes.size) {
    out.push(p)
    p = tree.parentOf.get(p) ?? null
  }
  return out
}

/** Pre-order, sibling order; excludes the node unless includeSelf; unknown key → []. */
export function descendantsOf(tree: CategoryTree, key: CategoryKey, opts: { includeSelf?: boolean } = {}): CategoryKey[] {
  if (!tree.nodes.has(key)) return []
  const out: CategoryKey[] = []
  const stack: CategoryKey[] = [key]
  while (stack.length) {
    const k = stack.pop()!
    if (k !== key || opts.includeSelf) out.push(k)
    const kids = tree.childrenOf.get(k) ?? []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

/** Every key in tree order (pre-order from the roots). */
export function treeOrder(tree: CategoryTree): CategoryKey[] {
  return tree.roots.flatMap((r) => descendantsOf(tree, r, { includeSelf: true }))
}

/** True when making `newParentKey` the parent of `key` would create a cycle (including newParentKey === key). null parent never cycles. */
export function wouldCycle(tree: CategoryTree, key: CategoryKey, newParentKey: CategoryKey | null): boolean {
  if (newParentKey === null) return false
  if (newParentKey === key) return true
  return ancestorsOf(tree, newParentKey).includes(key)
}

function subtreeHeight(tree: CategoryTree, key: CategoryKey): number {
  const base = tree.depthOf.get(key) ?? 0
  let h = 0
  for (const d of descendantsOf(tree, key)) h = Math.max(h, (tree.depthOf.get(d) ?? base) - base)
  return h
}

/**
 * Numeric order for inserting between two siblings (midpoint of the neighbours);
 * null when no integer gap remains (the caller renumbers the sibling group).
 */
export function orderBetween(prev: number | null, next: number | null): number | null {
  if (prev !== null && !Number.isFinite(prev)) return null
  if (next !== null && !Number.isFinite(next)) return null
  if (prev === null && next === null) return ORDER_STEP
  if (prev === null) return next! - ORDER_STEP
  if (next === null) return prev + ORDER_STEP
  if (next - prev < 2) return null
  return Math.floor((prev + next) / 2)
}

/**
 * Validates and plans a move/reorder. Pure: returns the patches or the first issue.
 * Order of checks: unknown → parent unknown → cycle → depth → archived parent
 * (only when the parent is archived and was not already the parent).
 */
export function validateMove(tree: CategoryTree, req: MoveRequest): MovePlan {
  const { key } = req
  const parent = req.newParentKey ?? null
  if (!tree.nodes.has(key)) return { ok: false, code: 'category_unknown', key }
  if (parent !== null && !tree.nodes.has(parent)) return { ok: false, code: 'category_parent_unknown', key, detail: parent }
  if (wouldCycle(tree, key, parent)) return { ok: false, code: 'category_cycle', key, detail: parent ?? undefined }
  const targetDepth = parent === null ? 0 : (tree.depthOf.get(parent) ?? 0) + 1
  if (targetDepth + subtreeHeight(tree, key) + 1 > MAX_DEPTH) return { ok: false, code: 'category_depth_exceeded', key, detail: String(MAX_DEPTH) }
  const currentParent = tree.parentOf.get(key) ?? null
  if (parent !== null && parent !== currentParent && tree.nodes.get(parent)!.archivedAt) {
    return { ok: false, code: 'category_archived_parent', key, detail: parent }
  }

  const siblings = (parent === null ? tree.roots : tree.childrenOf.get(parent) ?? []).filter((k) => k !== key)
  const index = Math.max(0, Math.min(req.index ?? siblings.length, siblings.length))
  const orderOf = (k: CategoryKey) => tree.nodes.get(k)!.order
  const prev = index > 0 ? orderOf(siblings[index - 1]) : null
  const next = index < siblings.length ? orderOf(siblings[index]) : null
  const order = orderBetween(prev, next)
  if (order !== null) return { ok: true, patches: [{ key, parentKey: parent, order }] }

  // No integer gap: renumber the sibling group in ORDER_STEP steps; patch only what changes.
  const sequence = [...siblings.slice(0, index), key, ...siblings.slice(index)]
  const patches = sequence.flatMap((k, i) => {
    const nextOrder = (i + 1) * ORDER_STEP
    const unchanged = k !== key && orderOf(k) === nextOrder
    return unchanged ? [] : [{ key: k, parentKey: parent, order: nextOrder }]
  })
  return { ok: true, patches }
}

// ── membership and filtering ────────────────────────────────────────────────

/**
 * Membership set used for filtering: each assigned key plus all its ancestors.
 * Primary and additional both contribute (additional categories affect discovery,
 * not availability). Unknown keys are skipped.
 */
export function expandForFilter(tree: CategoryTree, assigned: CategoryAssignment): Set<CategoryKey> {
  const out = new Set<CategoryKey>()
  for (const k of [assigned.primary, ...assigned.additional]) {
    if (k === null || !tree.nodes.has(k)) continue
    out.add(k)
    for (const a of ancestorsOf(tree, k)) out.add(a)
  }
  return out
}

/** Keys whose items match a filter on `key`: the key and all its descendants. Unknown → []. Archived descendants included. */
export function filterKeys(tree: CategoryTree, key: CategoryKey): CategoryKey[] {
  return descendantsOf(tree, key, { includeSelf: true })
}

// ── paths ───────────────────────────────────────────────────────────────────

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function segmentOf(node: CategoryNode, ctx: PathContext): { text: string; fallback: boolean; missing: string[] } {
  const label = node.label ?? {}
  const missing = ctx.locales.filter((l) => !clean(label[l]))
  const own = clean(label[ctx.locale])
  if (own) return { text: own, fallback: false, missing }
  const viaDefault = clean(label[ctx.defaultLocale])
  if (viaDefault) return { text: viaDefault, fallback: true, missing }
  for (const l of ctx.locales) {
    const v = clean(label[l])
    if (v) return { text: v, fallback: true, missing }
  }
  return { text: node.key, fallback: true, missing }
}

function pathFrom(keys: readonly CategoryKey[], segs: { text: string; fallback: boolean; missing: readonly string[] }[]): CategoryPath {
  const fallbackAt = segs.flatMap((s, i) => (s.fallback ? [i] : []))
  return {
    keys,
    segments: segs.map((s) => s.text),
    text: segs.map((s) => s.text).join(PATH_SEPARATOR),
    fallbackAt,
    missingLocales: segs.map((s) => [...s.missing]),
    complete: fallbackAt.length === 0,
  }
}

/**
 * Localized path. Per segment: label[locale] → label[defaultLocale] → first non-empty
 * label in the order of `locales` → the key itself. Unknown key → empty, incomplete path.
 */
export function pathOf(tree: CategoryTree, key: CategoryKey, ctx: PathContext): CategoryPath {
  if (!tree.nodes.has(key)) return { keys: [], segments: [], text: '', fallbackAt: [], missingLocales: [], complete: false }
  const keys = [...ancestorsOf(tree, key).reverse(), key]
  return pathFrom(keys, keys.map((k) => segmentOf(tree.nodes.get(k)!, ctx)))
}

/**
 * Inline creation (D-3): the complete path a NEW category would have — the user picks the
 * parent and sees e.g. "Food › Pizza › Focacce" before saving. `keys` are the parent's
 * (the new node has no key yet); `segments` has one more entry, the typed label.
 * An unknown parent is shown as a new root (the service refuses it on save).
 */
export function previewPath(tree: CategoryTree, parentKey: CategoryKey | null, label: string, ctx: PathContext): CategoryPath {
  const parent = parentKey !== null && tree.nodes.has(parentKey) ? pathOf(tree, parentKey, ctx) : null
  const keys = parent?.keys ?? []
  const typed = clean(label)
  const segs = keys.map((k) => segmentOf(tree.nodes.get(k)!, ctx))
  segs.push({ text: typed, fallback: typed === '', missing: ctx.locales.filter((l) => l !== ctx.locale) })
  return pathFrom(keys, segs)
}

// ── search ───────────────────────────────────────────────────────────────────

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const SEGMENT_SPLIT = /\s*(?:›|>|\/)\s*/

/**
 * Search by label or full path. Folds case and accents. The query is split on whitespace
 * and '›' / '>' / '/'; a node matches when every token is a substring of its folded
 * searchable text (its path in every locale and its key path). Ranking against the query's
 * last path segment: (0) leaf label equals it, (1) starts with it, (2) contains it, (3)
 * path-only match; then tree order. Archived nodes excluded unless includeArchived.
 */
export function searchCategories(tree: CategoryTree, query: string, ctx: PathContext & { includeArchived?: boolean }): CategoryKey[] {
  const keys = treeOrder(tree).filter((k) => ctx.includeArchived || !tree.nodes.get(k)!.archivedAt)
  const folded = fold(query ?? '').trim()
  if (!folded) return keys
  const tokens = folded.split(/[\s›>/]+/).filter(Boolean)
  const segments = folded.split(SEGMENT_SPLIT).filter(Boolean)
  const leafQuery = (segments[segments.length - 1] ?? folded).trim()
  const locales = [ctx.locale, ctx.defaultLocale, ...ctx.locales]
  const ranked: { key: CategoryKey; rank: number; at: number }[] = []
  keys.forEach((key, at) => {
    const searchable = [
      ...locales.map((locale) => fold(pathOf(tree, key, { ...ctx, locale }).text)),
      [...ancestorsOf(tree, key).reverse(), key].join(' '),
    ].join('\n')
    if (!tokens.every((t) => searchable.includes(t))) return
    const leaf = fold(pathOf(tree, key, ctx).segments.at(-1) ?? '')
    const rank = leaf === leafQuery ? 0 : leaf.startsWith(leafQuery) ? 1 : leaf.includes(leafQuery) ? 2 : 3
    ranked.push({ key, rank, at })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map((r) => r.key)
}

// ── availability inputs (C5 consumes; nothing here evaluates a rule) ─────────

/**
 * Effective category-level rule for ONE channel on the PRIMARY path: the COMPLETE rule
 * (baseline + schedule) of the nearest self-or-ancestor that has one; 'inherit' when none.
 * No merging of ancestor schedules (D-6.1). Additional categories never participate (I11).
 */
export function categoryChannelRule(
  tree: CategoryTree,
  primary: CategoryKey | null,
  channel: ChannelKey,
): { rule: ChannelAvailabilityRule | 'inherit'; sourceKey: CategoryKey | null } {
  if (primary === null || !tree.nodes.has(primary)) return { rule: 'inherit', sourceKey: null }
  for (const k of [primary, ...ancestorsOf(tree, primary)]) {
    const rule = tree.nodes.get(k)!.channelRules?.[channel]
    if (rule) return { rule, sourceKey: k }
  }
  return { rule: 'inherit', sourceKey: null }
}

/**
 * The one primary-path walk (REVIEW X-3). 'none' when primary is null; 'broken' when the
 * primary is unknown or tree.issues (orphan/cycle) touch a node on its path.
 */
export function primaryPath(tree: CategoryTree, key: CategoryKey | null): PrimaryPath {
  if (key === null) return { kind: 'none' }
  if (!tree.nodes.has(key)) return { kind: 'broken', reason: 'missingCategory', keys: [] }
  const keys = [...ancestorsOf(tree, key).reverse(), key]
  const onPath = new Set(keys)
  const cycle = tree.issues.find((i) => i.code === 'cycle' && (onPath.has(i.key) || (i.detail ?? '').split(' > ').some((k) => onPath.has(k))))
  if (cycle) return { kind: 'broken', reason: 'cycle', keys }
  if (tree.issues.some((i) => i.code === 'orphan' && onPath.has(i.key))) return { kind: 'broken', reason: 'orphan', keys }
  return { kind: 'path', keys }
}

/**
 * Categories whose effective rule for `channel` would change if `key`'s own rule changed:
 * key + descendants, not descending below a node with its own rule. Input to C5's impact.
 */
export function categoriesSharingRule(tree: CategoryTree, key: CategoryKey, channel: ChannelKey): CategoryKey[] {
  if (!tree.nodes.has(key)) return []
  const out: CategoryKey[] = []
  const stack: CategoryKey[] = [key]
  while (stack.length) {
    const k = stack.pop()!
    if (k !== key && tree.nodes.get(k)!.channelRules?.[channel]) continue
    out.push(k)
    const kids = tree.childrenOf.get(k) ?? []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

// ── deletion: Tom's "unused" (D-3) — the single implementation ──────────────

const BLOCKER_FOR_KIND: Record<CategoryReferenceKind, DeletionBlockerCode> = {
  item_primary: 'used_as_primary',
  item_additional: 'used_as_additional',
  automatic_listing: 'referenced_by_listing',
  publication_standard: 'referenced_by_standard',
  availability_policy: 'referenced_by_availability_policy',
  other: 'referenced_by_other',
}
const BLOCKER_ORDER: readonly DeletionBlockerCode[] = [
  'unknown_category',
  'has_children',
  'used_as_primary',
  'used_as_additional',
  'referenced_by_listing',
  'referenced_by_standard',
  'referenced_by_availability_policy',
  'referenced_by_other',
]
const isItemKind = (k: CategoryReferenceKind) => k === 'item_primary' || k === 'item_additional'

/**
 * Tom's definition (D-3, verbatim): a category is unused only when it has "no assigned
 * items, including drafts; no child categories; no automatic-listing references; no
 * publication-standard or availability-policy references outside the category itself; no
 * other stored Catalogue reference that would become broken by deletion".
 * Blockers in fixed order (sources in registration order within a code). [] ⇒ unused.
 * Archiving is never blocked. C8 consumes this as is.
 */
export function deletionBlockers(tree: CategoryTree, key: CategoryKey, refs: CategoryReferences): DeletionBlocker[] {
  if (!tree.nodes.has(key)) return [{ code: 'unknown_category', count: 0, cleanable: false, sample: [] }]
  const out: DeletionBlocker[] = []
  const children = tree.childrenOf.get(key) ?? []
  if (children.length > 0) {
    out.push({
      code: 'has_children',
      count: children.length,
      cleanable: true,
      sample: children.slice(0, IN_USE_SAMPLE_LIMIT).map((k) => ({ key: k, label: tree.nodes.get(k)!.label })),
    })
  }
  for (const { source, hit } of Object.values(refs ?? {})) {
    if (!source || !hit || !(hit.count > 0)) continue
    out.push({
      code: BLOCKER_FOR_KIND[source.kind] ?? 'referenced_by_other',
      count: hit.count,
      sourceId: source.id,
      cleanable: isItemKind(source.kind) ? true : source.cleanable === true,
      sample: (hit.sample ?? []).slice(0, IN_USE_SAMPLE_LIMIT),
    })
  }
  // Stable sort keeps registration order within one code.
  return out.map((b, i) => ({ b, i })).sort((x, y) => BLOCKER_ORDER.indexOf(x.b.code) - BLOCKER_ORDER.indexOf(y.b.code) || x.i - y.i).map((x) => x.b)
}

/**
 * Who may delete (D-3): [] ⇒ 'taxonomy.write' (an editor deletes only a genuinely
 * unreferenced LEAF). Otherwise 'setup.manage' via planCategoryDeletion; a blocker with
 * cleanable=false makes the deletion unresolvable until the referring documents are edited.
 */
export function deletionRoute(blockers: readonly DeletionBlocker[]): DeletionRoute {
  if (blockers.length === 0) return { capability: 'taxonomy.write', resolvable: true }
  return { capability: 'setup.manage', resolvable: blockers.every((b) => b.cleanable) }
}

/** Counted, previewed cleanup for a deletion that has blockers. Pure over the previews the service gathered. */
export function planCategoryDeletion(
  tree: CategoryTree,
  key: CategoryKey,
  refs: CategoryReferences,
  opts: { reassignTo: CategoryKey | null; promoteChildrenTo: CategoryKey | null | 'parent' },
): CategoryDeletionPlan {
  const blockers = deletionBlockers(tree, key, refs)
  if (!tree.nodes.has(key)) return { ok: false, code: 'category_unknown', blockers }
  if (blockers.some((b) => !b.cleanable)) return { ok: false, code: 'category_cleanup_unresolvable', blockers }
  const steps: { kind: 'move_children' | 'reassign_items' | 'cleanup_source'; sourceId?: string; count: number }[] = []

  const children = blockers.find((b) => b.code === 'has_children')
  if (children) {
    const target = opts.promoteChildrenTo === 'parent' ? (tree.parentOf.get(key) ?? null) : opts.promoteChildrenTo
    if (target !== null && !tree.nodes.has(target)) return { ok: false, code: 'category_unknown', blockers }
    if (target !== null && (target === key || descendantsOf(tree, key).includes(target))) return { ok: false, code: 'category_cycle', blockers }
    steps.push({ kind: 'move_children', count: children.count })
  }

  const items = blockers.filter((b) => b.code === 'used_as_primary' || b.code === 'used_as_additional')
  if (items.length > 0) {
    if (opts.reassignTo !== null && (opts.reassignTo === key || !tree.nodes.has(opts.reassignTo))) return { ok: false, code: 'category_unknown', blockers }
    steps.push({ kind: 'reassign_items', count: items.reduce((n, b) => n + b.count, 0) })
  }

  for (const b of blockers) {
    if (b.code === 'has_children' || b.code === 'used_as_primary' || b.code === 'used_as_additional') continue
    steps.push({ kind: 'cleanup_source', sourceId: b.sourceId, count: b.count })
  }
  return { ok: true, steps }
}

// ── item assignment ──────────────────────────────────────────────────────────

const assignedKeys = (a: CategoryAssignment): CategoryKey[] => (a.primary !== null ? [a.primary, ...a.additional] : [...a.additional])

/** Item-side validation (I8). `previous` lets an unchanged archived key through. */
export function validateAssignment(tree: CategoryTree, next: CategoryAssignment, previous?: CategoryAssignment): AssignmentValidation {
  const keys = assignedKeys(next)
  const seen = new Set<CategoryKey>()
  for (const k of keys) {
    if (seen.has(k)) return { ok: false, code: 'category_duplicate', key: k }
    seen.add(k)
  }
  if (next.additional.length > MAX_ADDITIONAL_CATEGORIES) return { ok: false, code: 'category_too_many' }
  if (next.primary === null && next.additional.length > 0) return { ok: false, code: 'category_primary_required' }
  const before = new Set(previous ? assignedKeys(previous) : [])
  for (const k of keys) {
    const node = tree.nodes.get(k)
    // A key the item already had (now unknown — e.g. a stale legacy key) is kept, never a reason to refuse every save.
    if (!node && before.has(k)) continue
    if (!node) return { ok: false, code: 'category_unknown', key: k }
    if (node.archivedAt && !before.has(k)) return { ok: false, code: 'category_archived_target', key: k }
  }
  return { ok: true }
}

const sameAssignment = (a: CategoryAssignment, b: CategoryAssignment) =>
  a.primary === b.primary && a.additional.length === b.additional.length && a.additional.every((k, i) => k === b.additional[i])

/**
 * Reassignment plan for "move items from → to". Per item: primary==from → to (dropping `to`
 * from additional); from in additional → replaced by `to`, deduplicated, dropped if `to` is
 * the primary. Only items that change are returned, so a second run returns [] (idempotent).
 */
export function planReassign(
  items: readonly { id: string; assignment: CategoryAssignment }[],
  from: CategoryKey,
  to: CategoryKey,
): { id: string; next: CategoryAssignment }[] {
  const out: { id: string; next: CategoryAssignment }[] = []
  for (const { id, assignment } of items) {
    const primary = assignment.primary === from ? to : assignment.primary
    const additional: CategoryKey[] = []
    for (const k of assignment.additional) {
      const v = k === from ? to : k
      if (v !== primary && !additional.includes(v)) additional.push(v)
    }
    const next = { primary, additional }
    if (!sameAssignment(assignment, next)) out.push({ id, next })
  }
  return out
}

/** What readiness (C6) learns about an item's categories. */
export function categoryAssignmentState(tree: CategoryTree, a: CategoryAssignment): CategoryAssignmentState {
  if (a.primary === null) return a.additional.length === 0 ? 'none' : 'no_primary'
  const node = tree.nodes.get(a.primary)
  if (!node) return 'unknown_primary'
  return node.archivedAt ? 'archived_primary' : 'ok'
}

/**
 * Legacy → new (D-15): the first EXISTING category becomes primary. With `tree`, keys that
 * are not in the vocabulary are skipped (the migration reports them); without it, the first
 * non-empty deduplicated key. The rest are additional, in stored order.
 */
export function legacyCategoriesToAssignment(categories: readonly string[] | null | undefined, tree?: CategoryTree): CategoryAssignment {
  const keys: CategoryKey[] = []
  for (const raw of Array.isArray(categories) ? categories : []) {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (!k || keys.includes(k)) continue
    if (tree && !tree.nodes.has(k)) continue
    keys.push(k)
  }
  return keys.length === 0 ? { primary: null, additional: [] } : { primary: keys[0], additional: keys.slice(1) }
}

/** The assigned keys, primary first, then additional in stored order. */
export function assignmentKeys(a: CategoryAssignment): CategoryKey[] {
  return assignedKeys(a)
}
