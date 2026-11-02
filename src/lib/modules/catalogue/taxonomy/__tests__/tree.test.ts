// Contract C1.11 — named fixtures for the pure category tree (tree.ts), plus
// property tests (cycles, deep trees, ordering). Fixture names are the contract's.

import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  assignmentKeys,
  buildTree,
  categoriesSharingRule,
  categoryAssignmentState,
  categoryChannelRule,
  deletionBlockers,
  deletionRoute,
  descendantsOf,
  expandForFilter,
  filterKeys,
  legacyCategoriesToAssignment,
  orderBetween,
  pathOf,
  planCategoryDeletion,
  planReassign,
  previewPath,
  primaryPath,
  searchCategories,
  treeOrder,
  validateAssignment,
  validateMove,
  wouldCycle,
} from '../tree'
import { asChannelKey, type ChannelAvailabilityRule } from '../../commerce/commerce-types'
import { MAX_DEPTH } from '../limits'
import type { CategoryNode, CategoryReferenceKind, CategoryReferences, CategoryTree } from '../types'

const node = (key: string, parentKey: string | null, order: number, label: Record<string, string> = { en: key }, extra: Partial<CategoryNode> = {}): CategoryNode => ({
  key,
  label,
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt: null,
  ...extra,
})

/** Base tree T-food (C1.11). */
const T_FOOD: CategoryNode[] = [
  node('food', null, 1000, { en: 'Food', it: 'Cibo', de: 'Essen' }),
  node('pizza', 'food', 1000, { en: 'Pizza', it: 'Pizza', de: 'Pizza' }),
  node('pizza_classiche', 'pizza', 1000, { en: 'Classic', it: 'Classiche' }),
  node('pizza_bianche', 'pizza', 2000, { en: 'White', it: 'Bianche' }),
  node('desserts', 'food', 2000, { en: 'Desserts', it: 'Dolci', de: 'Desserts' }),
  node('beverages', null, 2000, { en: 'Beverages', it: 'Bevande', de: 'Getränke' }),
  node('alcoholic', 'beverages', 1000, { en: 'Alcoholic', it: 'Alcolici', de: 'Alkoholisch' }),
  node('liqueurs', 'alcoholic', 1000, { en: 'Liqueurs', it: 'Liquori', de: 'Liköre' }),
]
const tFood = () => buildTree(T_FOOD)
const CTX = (locale: string) => ({ locale, defaultLocale: 'en', locales: ['en', 'it', 'de'] })
const DELIVERY = asChannelKey('delivery')
const rule = (state: 'available' | 'unavailable', overrides: ChannelAvailabilityRule['overrides'] = []): ChannelAvailabilityRule => ({ state, overrides })
const withRules = (rules: Record<string, Record<string, ChannelAvailabilityRule>>) =>
  buildTree(T_FOOD.map((n) => (rules[n.key] ? { ...n, channelRules: Object.fromEntries(Object.entries(rules[n.key]).map(([c, r]) => [asChannelKey(c), r])) } : n)))

const src = (id: string, kind: CategoryReferenceKind, count: number, cleanable = false): CategoryReferences[string] => ({
  source: { id, kind, cleanable },
  hit: { count, sample: Array.from({ length: Math.min(count, 12) }, (_, i) => ({ id: `${id}-${i}`, type: 'catalogueItem', name: `Doc ${i}` })) },
})
const refsOf = (...entries: CategoryReferences[string][]): CategoryReferences => Object.fromEntries(entries.map((e) => [e.source.id, e]))

// ── tree ─────────────────────────────────────────────────────────────────────

describe('tree', () => {
  it('tree/basic', () => {
    const t = tFood()
    expect(t.roots).toEqual(['food', 'beverages'])
    expect(t.childrenOf.get('pizza')).toEqual(['pizza_classiche', 'pizza_bianche'])
    expect(t.depthOf.get('liqueurs')).toBe(2)
    expect(t.issues).toEqual([])
    for (const k of t.nodes.keys()) expect(t.childrenOf.has(k)).toBe(true)
  })
  it('tree/order-ties', () => {
    const t = buildTree([node('b', null, 1000), node('a', null, 1000), node('z', null, Number.NaN), node('c', null, 500)])
    expect(t.roots).toEqual(['c', 'a', 'b', 'z'])
  })
  it('tree/ancestors', () => {
    expect(ancestorsOf(tFood(), 'pizza_bianche')).toEqual(['pizza', 'food'])
    expect(ancestorsOf(tFood(), 'nope')).toEqual([])
  })
  it('tree/descendants', () => {
    expect(descendantsOf(tFood(), 'food')).toEqual(['pizza', 'pizza_classiche', 'pizza_bianche', 'desserts'])
    expect(descendantsOf(tFood(), 'food', { includeSelf: true })).toEqual(['food', 'pizza', 'pizza_classiche', 'pizza_bianche', 'desserts'])
    expect(descendantsOf(tFood(), 'nope')).toEqual([])
  })
  it('tree/corrupt-cycle', () => {
    const t = buildTree([node('a', 'b', 1000), node('b', 'a', 1000)])
    expect(t.issues.map((i) => [i.code, i.key])).toEqual([['cycle', 'a']])
    expect(t.roots).toEqual(['a'])
    expect(t.childrenOf.get('a')).toEqual(['b'])
  })
  it('tree/orphan', () => {
    const t = buildTree([node('x', 'gone', 1000)])
    expect(t.roots).toEqual(['x'])
    expect(t.issues).toEqual([{ code: 'orphan', key: 'x', detail: 'gone' }])
  })
  it('tree/duplicate', () => {
    const t = buildTree([node('pizza', null, 1000, { en: 'First' }), node('pizza', null, 2000, { en: 'Second' })])
    expect(t.nodes.get('pizza')!.label.en).toBe('First')
    expect(t.issues).toEqual([{ code: 'duplicate-key', key: 'pizza' }])
  })
  it('a self-parent is a cycle, never a throw', () => {
    const t = buildTree([node('a', 'a', 1000)])
    expect(t.roots).toEqual(['a'])
    expect(t.issues[0].code).toBe('cycle')
  })
})

// ── paths ───────────────────────────────────────────────────────────────────

describe('paths', () => {
  it('path/en', () => {
    const p = pathOf(tFood(), 'pizza_bianche', CTX('en'))
    expect(p.text).toBe('Food › Pizza › White')
    expect(p.keys).toEqual(['food', 'pizza', 'pizza_bianche'])
    expect(p.complete).toBe(true)
  })
  it('path/de-missing', () => {
    const p = pathOf(tFood(), 'pizza_bianche', CTX('de'))
    expect(p.text).toBe('Essen › Pizza › White')
    expect(p.fallbackAt).toEqual([2])
    expect(p.missingLocales[2]).toEqual(['de'])
    expect(p.complete).toBe(false)
  })
  it('path/key-only', () => {
    const p = pathOf(buildTree([node('naked', null, 1, {})]), 'naked', CTX('en'))
    expect(p.segments).toEqual(['naked'])
    expect(p.fallbackAt).toEqual([0])
  })
  it('unknown key → empty incomplete path', () => {
    expect(pathOf(tFood(), 'nope', CTX('en'))).toEqual({ keys: [], segments: [], text: '', fallbackAt: [], missingLocales: [], complete: false })
  })
  it('inline/create-path (previewPath)', () => {
    expect(previewPath(tFood(), 'pizza', 'Focacce', CTX('en')).text).toBe('Food › Pizza › Focacce')
    expect(previewPath(tFood(), null, 'Focacce', CTX('en')).text).toBe('Focacce')
    expect(previewPath(tFood(), 'pizza', '  ', CTX('en')).complete).toBe(false)
  })
})

// ── moves ───────────────────────────────────────────────────────────────────

describe('moves', () => {
  it('cycle/self', () => {
    expect(validateMove(tFood(), { key: 'food', newParentKey: 'food' })).toMatchObject({ ok: false, code: 'category_cycle' })
  })
  it('cycle/descendant', () => {
    expect(validateMove(tFood(), { key: 'food', newParentKey: 'pizza_bianche' })).toMatchObject({ ok: false, code: 'category_cycle' })
    expect(wouldCycle(tFood(), 'food', 'pizza_bianche')).toBe(true)
    expect(wouldCycle(tFood(), 'pizza_bianche', 'food')).toBe(false)
    expect(wouldCycle(tFood(), 'food', null)).toBe(false)
  })
  it('move/ok-between', () => {
    const plan = validateMove(tFood(), { key: 'pizza', newParentKey: 'beverages', index: 0 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.patches).toHaveLength(1)
    expect(plan.patches[0]).toMatchObject({ key: 'pizza', parentKey: 'beverages' })
    expect(plan.patches[0].order).toBeLessThan(1000)
  })
  it('move/renumber', () => {
    const t = buildTree([node('a', null, 1000), node('b', null, 1001), node('c', null, 5000)])
    const plan = validateMove(t, { key: 'c', newParentKey: null, index: 1 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.patches).toEqual([
      { key: 'c', parentKey: null, order: 2000 },
      { key: 'b', parentKey: null, order: 3000 },
    ])
  })
  it('move/depth', () => {
    const chain = Array.from({ length: MAX_DEPTH }, (_, i) => node(`c${i + 1}`, i === 0 ? null : `c${i}`, 1000))
    const t = buildTree([...chain, node('c33', null, 2000)])
    expect(t.issues).toEqual([])
    expect(validateMove(t, { key: 'c33', newParentKey: `c${MAX_DEPTH}` })).toMatchObject({ ok: false, code: 'category_depth_exceeded' })
    expect(validateMove(t, { key: 'c33', newParentKey: `c${MAX_DEPTH - 1}` }).ok).toBe(true)
  })
  it('move/unknown', () => {
    expect(validateMove(tFood(), { key: 'nope', newParentKey: null })).toMatchObject({ ok: false, code: 'category_unknown' })
    expect(validateMove(tFood(), { key: 'pizza', newParentKey: 'nope' })).toMatchObject({ ok: false, code: 'category_parent_unknown' })
  })
  it('archived parent refused only when it is a new parent', () => {
    const t = buildTree(T_FOOD.map((n) => (n.key === 'beverages' ? { ...n, archivedAt: '2026-01-01T00:00:00Z' } : n)))
    expect(validateMove(t, { key: 'pizza', newParentKey: 'beverages' })).toMatchObject({ ok: false, code: 'category_archived_parent' })
    expect(validateMove(t, { key: 'alcoholic', newParentKey: 'beverages', index: 0 }).ok).toBe(true)
  })
  it('orderBetween', () => {
    expect(orderBetween(null, null)).toBe(1000)
    expect(orderBetween(1000, null)).toBe(2000)
    expect(orderBetween(1000, 2000)).toBe(1500)
    expect(orderBetween(1000, 1001)).toBeNull()
    expect(orderBetween(Number.NaN, 2)).toBeNull()
  })
})

// ── filtering and search ────────────────────────────────────────────────────

describe('filter and search', () => {
  it('expand/assigned', () => {
    expect(expandForFilter(tFood(), { primary: 'pizza_bianche', additional: ['desserts'] })).toEqual(new Set(['pizza_bianche', 'pizza', 'food', 'desserts']))
  })
  it('expand/unknown', () => {
    expect(expandForFilter(tFood(), { primary: 'nope', additional: [] })).toEqual(new Set())
  })
  it('filter/keys', () => {
    expect(filterKeys(tFood(), 'food')).toEqual(['food', 'pizza', 'pizza_classiche', 'pizza_bianche', 'desserts'])
    expect(filterKeys(tFood(), 'nope')).toEqual([])
  })
  it('search/path', () => {
    expect(searchCategories(tFood(), 'pizza bian', CTX('it'))[0]).toBe('pizza_bianche')
  })
  it('search/accent', () => {
    const t = buildTree([node('caffe', null, 1000, { it: 'Caffè', en: 'Coffee' })])
    expect(searchCategories(t, 'caffe', CTX('it'))).toEqual(['caffe'])
    expect(searchCategories(t, 'CAFFÈ', CTX('en'))).toEqual(['caffe'])
  })
  it('search/arrow', () => {
    const r = searchCategories(tFood(), 'food › pizza', CTX('en'))
    expect(r).toEqual(['pizza', 'pizza_classiche', 'pizza_bianche'])
  })
  it('search/archived', () => {
    const t = buildTree(T_FOOD.map((n) => (n.key === 'desserts' ? { ...n, archivedAt: '2026-01-01T00:00:00Z' } : n)))
    expect(searchCategories(t, 'dess', CTX('en'))).toEqual([])
    expect(searchCategories(t, 'dess', { ...CTX('en'), includeArchived: true })).toEqual(['desserts'])
  })
  it('ranks exact leaf matches before prefix, contains and path-only matches', () => {
    const t = buildTree([node('a', null, 1, { en: 'Wine list' }), node('b', null, 2, { en: 'Wine' }), node('c', 'b', 1, { en: 'Red' }), node('d', null, 3, { en: 'House wine' })])
    expect(searchCategories(t, 'wine', CTX('en'))).toEqual(['b', 'a', 'd', 'c'])
  })
})

// ── availability inputs ─────────────────────────────────────────────────────

describe('channel rules (C5 inputs)', () => {
  it('rule/nearest', () => {
    const t = withRules({ food: { delivery: rule('unavailable') }, pizza: { delivery: rule('available') } })
    expect(categoryChannelRule(t, 'pizza_bianche', DELIVERY)).toEqual({ rule: { state: 'available', overrides: [] }, sourceKey: 'pizza' })
    expect(categoryChannelRule(t, 'desserts', DELIVERY)).toEqual({ rule: { state: 'unavailable', overrides: [] }, sourceKey: 'food' })
    expect(categoryChannelRule(t, 'beverages', DELIVERY)).toEqual({ rule: 'inherit', sourceKey: null })
    expect(categoryChannelRule(t, null, DELIVERY)).toEqual({ rule: 'inherit', sourceKey: null })
    expect(categoryChannelRule(t, 'nope', DELIVERY)).toEqual({ rule: 'inherit', sourceKey: null })
  })
  const evening = rule('unavailable', [{ kind: 'weekly', key: 's1', days: [], from: '18:00', to: '23:00', state: 'available' }])
  it('rule/schedule-replaces', () => {
    const t = withRules({ food: { delivery: evening }, pizza: { delivery: rule('available') } })
    expect(categoryChannelRule(t, 'pizza_bianche', DELIVERY)).toEqual({ rule: { state: 'available', overrides: [] }, sourceKey: 'pizza' })
  })
  it('rule/schedule-inherited', () => {
    const t = withRules({ food: { delivery: evening } })
    expect(categoryChannelRule(t, 'pizza_bianche', DELIVERY)).toEqual({ rule: evening, sourceKey: 'food' })
  })
  it('rule/additional-inert', () => {
    const t = withRules({ pizza: { delivery: rule('unavailable') } })
    const a = { primary: 'desserts', additional: ['pizza'] }
    expect(categoryChannelRule(t, a.primary, DELIVERY)).toEqual({ rule: 'inherit', sourceKey: null })
  })
  it('rule/sharing', () => {
    const t = withRules({ pizza: { delivery: rule('available') } })
    expect(categoriesSharingRule(t, 'food', DELIVERY)).toEqual(['food', 'desserts'])
    expect(categoriesSharingRule(t, 'pizza', DELIVERY)).toEqual(['pizza', 'pizza_classiche', 'pizza_bianche'])
  })
  it('path/primary-ok', () => {
    expect(primaryPath(tFood(), 'pizza_bianche')).toEqual({ kind: 'path', keys: ['food', 'pizza', 'pizza_bianche'] })
  })
  it('path/primary-none-broken', () => {
    expect(primaryPath(tFood(), null)).toEqual({ kind: 'none' })
    expect(primaryPath(tFood(), 'nope')).toEqual({ kind: 'broken', reason: 'missingCategory', keys: [] })
    const cyc = buildTree([node('a', 'b', 1), node('b', 'a', 1), node('c', null, 2)])
    expect(primaryPath(cyc, 'b')).toEqual({ kind: 'broken', reason: 'cycle', keys: ['a', 'b'] })
    expect(primaryPath(cyc, 'c')).toEqual({ kind: 'path', keys: ['c'] })
    expect(primaryPath(buildTree([node('x', 'gone', 1)]), 'x')).toEqual({ kind: 'broken', reason: 'orphan', keys: ['x'] })
  })
})

// ── assignment ───────────────────────────────────────────────────────────────

describe('assignment', () => {
  it('assign/valid', () => expect(validateAssignment(tFood(), { primary: 'pizza', additional: ['desserts'] })).toEqual({ ok: true }))
  it('assign/primary-in-additional', () =>
    expect(validateAssignment(tFood(), { primary: 'pizza', additional: ['pizza'] })).toMatchObject({ ok: false, code: 'category_duplicate' }))
  it('assign/no-primary', () =>
    expect(validateAssignment(tFood(), { primary: null, additional: ['desserts'] })).toMatchObject({ ok: false, code: 'category_primary_required' }))
  it('assign/archived-new', () => {
    const t = buildTree(T_FOOD.map((n) => (n.key === 'desserts' ? { ...n, archivedAt: '2026-01-01T00:00:00Z' } : n)))
    expect(validateAssignment(t, { primary: 'desserts', additional: [] }, { primary: 'pizza', additional: [] })).toMatchObject({ ok: false, code: 'category_archived_target' })
    expect(validateAssignment(t, { primary: 'desserts', additional: [] }, { primary: 'desserts', additional: [] })).toEqual({ ok: true })
  })
  it('assign/too-many', () => {
    const many = Array.from({ length: 21 }, (_, i) => node(`k${i}`, null, i))
    expect(validateAssignment(buildTree([node('p', null, 0), ...many]), { primary: 'p', additional: many.map((n) => n.key) })).toMatchObject({ ok: false, code: 'category_too_many' })
  })
  it('unknown key is refused', () => expect(validateAssignment(tFood(), { primary: 'nope', additional: [] })).toMatchObject({ ok: false, code: 'category_unknown', key: 'nope' }))

  it('legacy/two', () => expect(legacyCategoriesToAssignment(['technology', 'literature'])).toEqual({ primary: 'technology', additional: ['literature'] }))
  it('legacy/first-existing', () => {
    const t = buildTree([node('literature', null, 1), node('technology', null, 2)])
    expect(legacyCategoriesToAssignment(['gone', 'literature', 'technology'], t)).toEqual({ primary: 'literature', additional: ['technology'] })
  })
  it('legacy/empty', () => {
    expect(legacyCategoriesToAssignment(null)).toEqual({ primary: null, additional: [] })
    expect(legacyCategoriesToAssignment([])).toEqual({ primary: null, additional: [] })
    expect(legacyCategoriesToAssignment(['', 'a', 'a'])).toEqual({ primary: 'a', additional: [] })
  })

  it('reassign/merge', () => {
    const items = [
      { id: '1', assignment: { primary: 'a', additional: [] } },
      { id: '2', assignment: { primary: 'b', additional: ['a'] } },
      { id: '3', assignment: { primary: 'b', additional: ['a', 'c'] } },
    ]
    const first = planReassign(items, 'a', 'b')
    expect(first).toEqual([
      { id: '1', next: { primary: 'b', additional: [] } },
      { id: '2', next: { primary: 'b', additional: [] } },
      { id: '3', next: { primary: 'b', additional: ['c'] } },
    ])
    expect(planReassign(first.map((f) => ({ id: f.id, assignment: f.next })), 'a', 'b')).toEqual([])
  })

  it('state/*', () => {
    const t = buildTree(T_FOOD.map((n) => (n.key === 'desserts' ? { ...n, archivedAt: '2026-01-01T00:00:00Z' } : n)))
    expect(categoryAssignmentState(t, { primary: null, additional: [] })).toBe('none')
    expect(categoryAssignmentState(t, { primary: null, additional: ['pizza'] })).toBe('no_primary')
    expect(categoryAssignmentState(t, { primary: 'nope', additional: [] })).toBe('unknown_primary')
    expect(categoryAssignmentState(t, { primary: 'desserts', additional: [] })).toBe('archived_primary')
    expect(categoryAssignmentState(t, { primary: 'pizza', additional: [] })).toBe('ok')
  })
})

// ── deletion (D-3 "unused") ─────────────────────────────────────────────────

describe('deletion blockers', () => {
  it('delete/children', () => {
    const b = deletionBlockers(tFood(), 'pizza', {})
    expect(b).toEqual([{ code: 'has_children', count: 2, cleanable: true, sample: [{ key: 'pizza_classiche', label: { en: 'Classic', it: 'Classiche' } }, { key: 'pizza_bianche', label: { en: 'White', it: 'Bianche' } }] }])
  })
  it('delete/used-published', () => {
    const b = deletionBlockers(tFood(), 'pizza_bianche', refsOf(src('items-primary', 'item_primary', 3), src('items-additional', 'item_additional', 2)))
    expect(b.map((x) => [x.code, x.count, x.cleanable])).toEqual([
      ['used_as_primary', 3, true],
      ['used_as_additional', 2, true],
    ])
    for (const x of b) expect(x.sample.length).toBeLessThanOrEqual(10)
  })
  it('samples are capped at 10', () => {
    const b = deletionBlockers(tFood(), 'pizza_bianche', refsOf(src('items-primary', 'item_primary', 30)))
    expect(b[0].count).toBe(30)
    expect(b[0].sample).toHaveLength(10)
  })
  it('delete/listing-ref, delete/standard-ref, delete/availability-policy-ref, delete/other-ref', () => {
    expect(deletionBlockers(tFood(), 'liqueurs', refsOf(src('automatic-listings', 'automatic_listing', 2)))).toMatchObject([{ code: 'referenced_by_listing', count: 2, sourceId: 'automatic-listings', cleanable: false }])
    expect(deletionBlockers(tFood(), 'liqueurs', refsOf(src('publication-standards', 'publication_standard', 1)))).toMatchObject([{ code: 'referenced_by_standard', count: 1 }])
    expect(deletionBlockers(tFood(), 'liqueurs', refsOf(src('availability-policies', 'availability_policy', 1)))).toMatchObject([{ code: 'referenced_by_availability_policy', count: 1 }])
    expect(deletionBlockers(tFood(), 'liqueurs', refsOf(src('x-future', 'other', 3)))).toMatchObject([{ code: 'referenced_by_other', count: 3, sourceId: 'x-future' }])
  })
  it("delete/availability-policy-ref: the category's OWN channelRules never count", () => {
    const t = withRules({ liqueurs: { delivery: rule('unavailable') } })
    expect(deletionBlockers(t, 'liqueurs', {})).toEqual([])
  })
  it('delete/order', () => {
    const b = deletionBlockers(
      tFood(),
      'pizza',
      refsOf(
        src('x-future', 'other', 1),
        src('availability-policies', 'availability_policy', 1),
        src('publication-standards', 'publication_standard', 1),
        src('automatic-listings', 'automatic_listing', 1),
        src('items-additional', 'item_additional', 1),
        src('items-primary', 'item_primary', 1),
      ),
    )
    expect(b.map((x) => x.code)).toEqual([
      'has_children',
      'used_as_primary',
      'used_as_additional',
      'referenced_by_listing',
      'referenced_by_standard',
      'referenced_by_availability_policy',
      'referenced_by_other',
    ])
  })
  it('delete/clean', () => expect(deletionBlockers(tFood(), 'liqueurs', refsOf(src('items-primary', 'item_primary', 0)))).toEqual([]))
  it('delete/unknown', () => expect(deletionBlockers(tFood(), 'nope', {}).map((b) => b.code)).toEqual(['unknown_category']))
  it('delete/route-editor', () => expect(deletionRoute([])).toEqual({ capability: 'taxonomy.write', resolvable: true }))
  it('delete/route-setup', () => {
    expect(deletionRoute(deletionBlockers(tFood(), 'pizza', {}))).toEqual({ capability: 'setup.manage', resolvable: true })
  })
  it('delete/preview', () => {
    const refs = refsOf(src('items-primary', 'item_primary', 3), src('items-additional', 'item_additional', 2), src('automatic-listings', 'automatic_listing', 1, true))
    expect(planCategoryDeletion(tFood(), 'pizza', refs, { reassignTo: 'food', promoteChildrenTo: 'parent' })).toEqual({
      ok: true,
      steps: [
        { kind: 'move_children', count: 2 },
        { kind: 'reassign_items', count: 5 },
        { kind: 'cleanup_source', sourceId: 'automatic-listings', count: 1 },
      ],
    })
  })
  it('delete/unresolvable', () => {
    const refs = refsOf(src('automatic-listings', 'automatic_listing', 1, false))
    expect(planCategoryDeletion(tFood(), 'liqueurs', refs, { reassignTo: null, promoteChildrenTo: 'parent' })).toMatchObject({ ok: false, code: 'category_cleanup_unresolvable' })
    expect(deletionRoute(deletionBlockers(tFood(), 'liqueurs', refs))).toEqual({ capability: 'setup.manage', resolvable: false })
  })
  it('planCategoryDeletion refuses moving children into their own subtree, and unknown targets', () => {
    expect(planCategoryDeletion(tFood(), 'food', {}, { reassignTo: null, promoteChildrenTo: 'pizza' })).toMatchObject({ ok: false, code: 'category_cycle' })
    expect(planCategoryDeletion(tFood(), 'food', {}, { reassignTo: null, promoteChildrenTo: 'nope' })).toMatchObject({ ok: false, code: 'category_unknown' })
    expect(planCategoryDeletion(tFood(), 'nope', {}, { reassignTo: null, promoteChildrenTo: null })).toMatchObject({ ok: false, code: 'category_unknown' })
  })
})

// ── attribute-path budget (C1.7a taxonomy/attribute-paths) ──────────────────

describe('taxonomy/attribute-paths', () => {
  it('300 categories × 200 tags × 12 channel rules × 14 overrides stay ≤ 150 unique paths, with no data-named key', () => {
    const channels = Array.from({ length: 12 }, (_, i) => `channel-${i}`)
    const doc = {
      _id: 'catalogue-taxonomy.p',
      _type: 'catalogueTaxonomy',
      projectSlug: 'p',
      categories: Array.from({ length: 300 }, (_, i) => ({
        _key: `cat_${i}`,
        _type: 'catalogueCategory',
        key: `cat_${i}`,
        label: { _type: 'localizedString', en: `Cat ${i}`, it: `Cat ${i}`, de: `Kat ${i}` },
        parentKey: i > 0 ? `cat_${i - 1}` : undefined,
        order: i * 1000,
        channelRules: channels.map((c) => ({
          _key: c,
          _type: 'catalogueChannelRule',
          channel: c,
          state: 'unavailable',
          schedule: Array.from({ length: 14 }, (_, j) => ({ _key: `s${j}`, _type: 'catalogueWeeklyOverride', days: ['mon'], from: '18:00', to: '19:00', state: 'available' })),
        })),
        defaultOptionListIds: ['x'],
        archivedAt: '2026-01-01T00:00:00Z',
      })),
      tags: Array.from({ length: 200 }, (_, i) => ({ _key: `tag_${i}`, _type: 'catalogueTag', key: `tag_${i}`, label: { en: `T${i}` }, order: i, archivedAt: null })),
      updatedAt: '2026-01-01T00:00:00Z',
      updatedBy: 'u',
    }
    const paths = new Set<string>()
    const keys = new Set<string>()
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) v.forEach((x) => walk(x, `${path}[]`))
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k)
          walk(x, path ? `${path}.${k}` : k)
        }
      }
      else paths.add(path)
    }
    walk(doc, '')
    expect(paths.size).toBeLessThanOrEqual(150)
    const dataNamed = [...keys].filter((k) => /^(cat_|tag_|channel-)/.test(k))
    expect(dataNamed).toEqual([])
  })
})

// ── property tests (deterministic pseudo-random) ────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function randomForest(seed: number, size: number): CategoryNode[] {
  const r = rng(seed)
  return Array.from({ length: size }, (_, i) => {
    const parent = r() < 0.2 ? null : r() < 0.1 ? 'missing' : `n${Math.floor(r() * size)}` // includes self-loops, cycles, orphans
    const order = r() < 0.05 ? Number.NaN : Math.floor(r() * 5) * 1000
    return node(`n${i}`, parent, order)
  })
}

function assertWellFormed(t: CategoryTree) {
  const order = treeOrder(t)
  expect(new Set(order).size).toBe(t.nodes.size) // every node reachable exactly once ⇒ no cycle survives
  for (const k of t.nodes.keys()) {
    const p = t.parentOf.get(k) ?? null
    if (p === null) expect(t.roots).toContain(k)
    else expect(t.childrenOf.get(p)).toContain(k)
    expect(t.depthOf.get(k)).toBe(ancestorsOf(t, k).length)
    expect(ancestorsOf(t, k)).not.toContain(k)
  }
}

describe('tree properties', () => {
  it('any input (cycles, self-loops, orphans, NaN orders) yields a well-formed tree, never a throw', () => {
    for (let seed = 1; seed <= 60; seed++) assertWellFormed(buildTree(randomForest(seed, 40)))
  })
  it('buildTree is deterministic and independent of input order', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const nodes = randomForest(seed, 30)
      const a = buildTree(nodes)
      const b = buildTree([...nodes].reverse())
      expect(treeOrder(b)).toEqual(treeOrder(a))
      expect(b.issues.filter((i) => i.code === 'cycle').map((i) => i.key).sort()).toEqual(a.issues.filter((i) => i.code === 'cycle').map((i) => i.key).sort())
    }
  })
  it('siblings are always sorted by order, then key, non-finite last', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = buildTree(randomForest(seed, 40))
      for (const list of [t.roots, ...t.childrenOf.values()]) {
        for (let i = 1; i < list.length; i++) {
          const a = t.nodes.get(list[i - 1])!
          const b = t.nodes.get(list[i])!
          const fa = Number.isFinite(a.order)
          const fb = Number.isFinite(b.order)
          if (fa && fb) expect(a.order < b.order || (a.order === b.order && a.key < b.key)).toBe(true)
          else expect(fa || !fb).toBe(true)
        }
      }
    }
  })
  it('a valid move never creates a cycle, and applying it keeps the tree well-formed', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const nodes = randomForest(seed, 25)
      const t = buildTree(nodes)
      const r = rng(seed * 7)
      for (let k = 0; k < 10; k++) {
        const key = `n${Math.floor(r() * 25)}`
        const parent = r() < 0.2 ? null : `n${Math.floor(r() * 25)}`
        const index = Math.floor(r() * 4)
        const plan = validateMove(t, { key, newParentKey: parent, index })
        if (!plan.ok) {
          if (plan.code === 'category_cycle') expect(wouldCycle(t, key, parent)).toBe(true)
          continue
        }
        const repaired = [...t.nodes.values()].map((n) => ({ ...n, parentKey: t.parentOf.get(n.key) ?? null }))
        const patched = repaired.map((n) => {
          const p = plan.patches.find((x) => x.key === n.key)
          return p ? { ...n, parentKey: p.parentKey, order: p.order } : n
        })
        const after = buildTree(patched)
        expect(after.issues.filter((i) => i.code === 'cycle')).toEqual([])
        assertWellFormed(after)
        expect(after.parentOf.get(key) ?? null).toBe(parent)
        const siblings = parent === null ? after.roots : after.childrenOf.get(parent)!
        const before = (parent === null ? t.roots : t.childrenOf.get(parent) ?? []).filter((x) => x !== key)
        expect(siblings.filter((x) => x !== key)).toEqual(before) // other siblings keep their sequence
        expect(siblings.indexOf(key)).toBe(Math.min(index, before.length)) // the node lands where asked
      }
    }
  })
  it('deep trees: a 500-level chain is handled without recursion limits, depth issues reported', () => {
    const chain = Array.from({ length: 500 }, (_, i) => node(`d${i}`, i === 0 ? null : `d${i - 1}`, 1000))
    const t = buildTree(chain)
    expect(t.depthOf.get('d499')).toBe(499)
    expect(ancestorsOf(t, 'd499')).toHaveLength(499)
    expect(descendantsOf(t, 'd0')).toHaveLength(499)
    expect(t.issues.filter((i) => i.code === 'depth-exceeded')).toHaveLength(500 - MAX_DEPTH)
    expect(pathOf(t, 'd499', CTX('en')).keys).toHaveLength(500)
  })
  it('expandForFilter ⊇ assigned known keys and is closed under ancestors; filterKeys inverts it', () => {
    const t = tFood()
    for (const k of t.nodes.keys()) {
      const set = expandForFilter(t, { primary: k, additional: [] })
      for (const a of ancestorsOf(t, k)) {
        expect(set.has(a)).toBe(true)
        expect(filterKeys(t, a)).toContain(k)
      }
    }
  })
  it('assignmentKeys: primary first then additional', () => {
    expect(assignmentKeys({ primary: 'a', additional: ['b', 'c'] })).toEqual(['a', 'b', 'c'])
    expect(assignmentKeys({ primary: null, additional: ['b'] })).toEqual(['b'])
  })
})
