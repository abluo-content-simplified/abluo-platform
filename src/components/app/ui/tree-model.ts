/**
 * Pure helpers for TreeEditor (no React). They only turn a gesture (a drop,
 * an arrow key, a menu choice) into a C1 `MoveRequest`; whether the move is
 * allowed (cycle, depth, archived parent) is C1 `validateMove` — never
 * decided here. The tree itself is C1's `CategoryTree` (buildTree).
 */
import { PATH_SEPARATOR } from '@/lib/modules/catalogue/taxonomy/limits'
import { ancestorsOf } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryKey, CategoryTree, MoveRequest } from '@/lib/modules/catalogue/taxonomy/types'
import type { DragOver } from './use-pointer-drag'

export type TreeMoveAction = 'up' | 'down' | 'indent' | 'outdent'
/** Why a keyboard / menu move does nothing (already first, nothing above to go into, already top level). */
export type TreeMoveBlocked = 'first' | 'last' | 'noPrevious' | 'topLevel'

export const parentOf = (tree: CategoryTree, key: CategoryKey): CategoryKey | null => tree.parentOf.get(key) ?? null

/** The ordered sibling group `key` belongs to (itself included). */
export function siblingsOf(tree: CategoryTree, key: CategoryKey): readonly CategoryKey[] {
  const p = parentOf(tree, key)
  return p === null ? tree.roots : (tree.childrenOf.get(p) ?? [])
}

/** 1-based position among siblings and the sibling count. */
export function positionOf(tree: CategoryTree, key: CategoryKey): { position: number; total: number } {
  const s = siblingsOf(tree, key)
  return { position: s.indexOf(key) + 1, total: s.length }
}

/**
 * The C1 move request for one step. `index` is among the NEW siblings without
 * the moved node (validateMove's convention).
 */
export function stepRequest(tree: CategoryTree, key: CategoryKey, action: TreeMoveAction): { ok: true; request: MoveRequest } | { ok: false; blocked: TreeMoveBlocked } {
  const parent = parentOf(tree, key)
  const siblings = siblingsOf(tree, key)
  const i = siblings.indexOf(key)
  switch (action) {
    case 'up':
      return i <= 0 ? { ok: false, blocked: 'first' } : { ok: true, request: { key, newParentKey: parent, index: i - 1 } }
    case 'down':
      return i < 0 || i >= siblings.length - 1 ? { ok: false, blocked: 'last' } : { ok: true, request: { key, newParentKey: parent, index: i + 1 } }
    case 'indent': {
      if (i <= 0) return { ok: false, blocked: 'noPrevious' }
      const into = siblings[i - 1]
      return { ok: true, request: { key, newParentKey: into, index: (tree.childrenOf.get(into) ?? []).length } }
    }
    case 'outdent': {
      if (parent === null) return { ok: false, blocked: 'topLevel' }
      const grand = parentOf(tree, parent)
      const uncles = grand === null ? tree.roots : (tree.childrenOf.get(grand) ?? [])
      return { ok: true, request: { key, newParentKey: grand, index: uncles.indexOf(parent) + 1 } }
    }
  }
}

/**
 * A pointer drop before/after another row: the dragged node becomes that
 * row's sibling (so a drag moves between parents). null when nothing changes.
 */
export function dropRequest(tree: CategoryTree, key: CategoryKey, over: DragOver): MoveRequest | null {
  if (over.key === key || !tree.nodes.has(over.key)) return null
  const newParentKey = parentOf(tree, over.key)
  const siblings = (newParentKey === null ? tree.roots : (tree.childrenOf.get(newParentKey) ?? [])).filter((k) => k !== key)
  const index = siblings.indexOf(over.key) + (over.after ? 1 : 0)
  if (newParentKey === parentOf(tree, key) && index === siblingsOf(tree, key).indexOf(key)) return null
  return { key, newParentKey, index }
}

/** "Food › Pizza › Bianche" — labels joined root first with C1's separator. */
export function fullPath(tree: CategoryTree, key: CategoryKey, labelOf: (key: CategoryKey) => string): string {
  if (!tree.nodes.has(key)) return ''
  return [...ancestorsOf(tree, key).reverse(), key].map(labelOf).join(PATH_SEPARATOR)
}
