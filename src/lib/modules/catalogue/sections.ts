// ── Catalogue — collection section tree ───────────────────────────────────────
//
// Authority: ADR-033 D6 (depth is not capped in the model) and A7 (fail-visible
// recovery for broken trees).
//
// Pure functions over an array of sections linked by `parentKey`. No Sanity, no
// fetching, no I/O — everything a caller needs is passed in, which is what lets
// the whole contract be tested before any editor exists.
//
// WHY FAIL-VISIBLE IS THE WHOLE POINT. The prior-art system this module learns
// from had a delete that filtered one row out of the array and left any children
// pointing at a parent that no longer existed. Those children rendered nowhere —
// neither screen walked them — while remaining in the saved document with their
// items. Invisible and persisted is the worst pair available: nothing alerts
// anyone, and the data rots quietly. So a broken tree here always renders every
// section it contains, and says what is wrong alongside.

export type SectionNode = {
  /** Sanity array `_key`. The section's identity; never regenerated. */
  _key: string
  /** `_key` of the parent, or absent/null for a top-level section. */
  parentKey?: string | null
}

export type TreeIssue =
  /** `parentKey` names a section that is not in this collection. */
  | { kind: 'missingParent'; key: string; parentKey: string }
  /** The same `_key` appears more than once. */
  | { kind: 'duplicateKey'; key: string }
  /** A section is its own ancestor. `keys` are the members, in source order. */
  | { kind: 'cycle'; keys: string[] }

export type ReadingOrder<T extends SectionNode> = {
  /** Every section, parent before its children, in the order a guest reads them. */
  order: T[]
  /** Depth from the top level: 0 for a root, 1 for its child, and so on. */
  depth: Map<string, number>
  /** Sections promoted to roots because their parent is missing or cyclic. */
  recovered: string[]
  issues: TreeIssue[]
}

/** First occurrence of each `_key`, with duplicates reported rather than merged. */
function dedupe<T extends SectionNode>(sections: readonly T[]): { unique: T[]; issues: TreeIssue[] } {
  const seen = new Set<string>()
  const unique: T[] = []
  const issues: TreeIssue[] = []
  for (const s of sections) {
    if (seen.has(s._key)) {
      issues.push({ kind: 'duplicateKey', key: s._key })
      continue
    }
    seen.add(s._key)
    unique.push(s)
  }
  return { unique, issues }
}

const parentOf = (s: SectionNode): string | null =>
  typeof s.parentKey === 'string' && s.parentKey !== '' ? s.parentKey : null

/**
 * Reading order: parents first, children beneath, source order preserved among
 * siblings.
 *
 * A section is a ROOT when it has no parent, or when its parent is missing from
 * this collection (A7 — a recovery root). Anything still unvisited after the
 * roots are walked is part of a cycle, and is appended flat, in source order,
 * each as its own root.
 *
 * Flat rather than as reconstructed subtrees, deliberately: rebuilding the shape
 * of a cyclic region means walking back into the cycle to find it, which is the
 * traversal this is protecting against.
 */
export function readingOrder<T extends SectionNode>(sections: readonly T[]): ReadingOrder<T> {
  const { unique, issues } = dedupe(sections)
  const byKey = new Map(unique.map((s) => [s._key, s]))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  const recovered: string[] = []

  for (const s of unique) {
    const parent = parentOf(s)
    if (parent === null) {
      roots.push(s)
      continue
    }
    if (!byKey.has(parent)) {
      // Fail-visible: a missing parent promotes the section rather than hiding
      // it. The stored parentKey is NOT touched — recovery is a read-time
      // behaviour, never a silent write.
      issues.push({ kind: 'missingParent', key: s._key, parentKey: parent })
      recovered.push(s._key)
      roots.push(s)
      continue
    }
    const siblings = children.get(parent)
    if (siblings) siblings.push(s)
    else children.set(parent, [s])
  }

  const order: T[] = []
  const depth = new Map<string, number>()
  const visited = new Set<string>()

  const walk = (node: T, level: number) => {
    if (visited.has(node._key)) return
    visited.add(node._key)
    order.push(node)
    depth.set(node._key, level)
    for (const child of children.get(node._key) ?? []) walk(child, level + 1)
  }
  for (const r of roots) walk(r, 0)

  // Whatever is left belongs to a cycle: it has a parent that exists, but that
  // parent is never reached from any root.
  const stranded = unique.filter((s) => !visited.has(s._key))
  if (stranded.length > 0) {
    issues.push({ kind: 'cycle', keys: stranded.map((s) => s._key) })
    for (const s of stranded) {
      visited.add(s._key)
      order.push(s)
      depth.set(s._key, 0)
      recovered.push(s._key)
    }
  }

  return { order, depth, recovered, issues }
}

/** Direct children of a section, in source order. */
export function childrenOf<T extends SectionNode>(sections: readonly T[], key: string): T[] {
  return sections.filter((s) => parentOf(s) === key)
}

/**
 * A section and every descendant beneath it, in reading order.
 *
 * Cycle-safe: a node is visited once. Returns the subject first even when it is
 * part of a cycle, so a caller can always act on what the user pointed at.
 */
export function subtreeOf<T extends SectionNode>(sections: readonly T[], key: string): T[] {
  const byKey = new Map(sections.map((s) => [s._key, s]))
  const start = byKey.get(key)
  if (!start) return []
  const out: T[] = []
  const seen = new Set<string>()
  const walk = (node: T) => {
    if (seen.has(node._key)) return
    seen.add(node._key)
    out.push(node)
    for (const child of sections.filter((s) => parentOf(s) === node._key)) walk(child)
  }
  walk(start)
  return out
}

/** True when `candidate` is `key` itself or sits beneath it. Cycle-safe. */
export function isDescendant(sections: readonly SectionNode[], key: string, candidate: string): boolean {
  return subtreeOf(sections, key).some((s) => s._key === candidate)
}

/**
 * Whether a section may become a child of `parentKey`.
 *
 * Refused when the target is the section itself or one of its descendants —
 * which is the move that creates a cycle, and the one an outliner UI makes
 * easiest to attempt.
 */
export function canReparent(
  sections: readonly SectionNode[],
  key: string,
  parentKey: string | null,
): { ok: true } | { ok: false; reason: 'unknownSection' | 'unknownParent' | 'wouldCycle' } {
  const byKey = new Map(sections.map((s) => [s._key, s]))
  if (!byKey.has(key)) return { ok: false, reason: 'unknownSection' }
  if (parentKey === null) return { ok: true }
  if (!byKey.has(parentKey)) return { ok: false, reason: 'unknownParent' }
  if (isDescendant(sections, key, parentKey)) return { ok: false, reason: 'wouldCycle' }
  return { ok: true }
}

/**
 * Move a section — and everything beneath it — so that it sits immediately
 * before `beforeKey`, optionally under a new parent.
 *
 * THE SUBTREE MOVES AS ONE BLOCK. Lifting a parent out of the array without its
 * descendants is how a menu ends up with children stranded where the parent used
 * to be; storage order is reading order here, so the block has to stay
 * contiguous. Sibling order among everything else is preserved exactly.
 *
 * `beforeKey: null` appends at the end. A move that would create a cycle is
 * refused and the input is returned unchanged.
 */
export function moveSection<T extends SectionNode>(
  sections: readonly T[],
  key: string,
  opts: { parentKey?: string | null; beforeKey?: string | null } = {},
): { sections: T[]; moved: boolean; reason?: 'unknownSection' | 'unknownParent' | 'wouldCycle' } {
  const byKey = new Map(sections.map((s) => [s._key, s]))
  if (!byKey.has(key)) return { sections: [...sections], moved: false, reason: 'unknownSection' }

  const nextParent = opts.parentKey === undefined ? parentOf(byKey.get(key)!) : opts.parentKey
  const check = canReparent(sections, key, nextParent)
  if (!check.ok) return { sections: [...sections], moved: false, reason: check.reason }

  const block = subtreeOf(sections, key)
  const blockKeys = new Set(block.map((s) => s._key))
  const rest = sections.filter((s) => !blockKeys.has(s._key))

  const moved = block.map((s) =>
    s._key === key ? ({ ...s, parentKey: nextParent ?? undefined } as T) : s,
  )

  const at =
    opts.beforeKey == null ? rest.length : rest.findIndex((s) => s._key === opts.beforeKey)
  const index = at < 0 ? rest.length : at

  return { sections: [...rest.slice(0, index), ...moved, ...rest.slice(index)], moved: true }
}

/**
 * Remove a section and every descendant.
 *
 * Returns the removed keys as well as the resulting tree: the editor needs them
 * for the confirmation ("«Pizza» and 2 subsections"), the undo affordance needs
 * the removed rows to put them back, and the audit entry needs to record what
 * actually went.
 */
export function removeSection<T extends SectionNode>(
  sections: readonly T[],
  key: string,
): { sections: T[]; removed: T[] } {
  const block = subtreeOf(sections, key)
  if (block.length === 0) return { sections: [...sections], removed: [] }
  const removedKeys = new Set(block.map((s) => s._key))
  return { sections: sections.filter((s) => !removedKeys.has(s._key)), removed: block }
}

/**
 * Every problem with this tree, for validation and for the editor's warnings.
 *
 * Reporting is separate from reading: `readingOrder` must always return
 * something renderable, and this says what is wrong with it. The editor refuses
 * to CREATE an issue; it does not refuse to display a document that already has
 * one (A7).
 */
export function treeIssues(sections: readonly SectionNode[]): TreeIssue[] {
  return readingOrder(sections).issues
}

/** Greatest depth in the tree. 0 for a flat list. The model caps nothing (D6). */
export function maxDepth(sections: readonly SectionNode[]): number {
  const { depth } = readingOrder(sections)
  let max = 0
  for (const d of depth.values()) if (d > max) max = d
  return max
}
