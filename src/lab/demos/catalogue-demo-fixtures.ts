/**
 * Lab-only Catalogue fixtures (no backend): a small category tree and the
 * pure C1 functions a real screen would call through the taxonomy service.
 * Admin-only English copy.
 */
import { buildTree, validateMove } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryNode, CategoryTree, MoveRequest, PathContext } from '@/lib/modules/catalogue/taxonomy/types'

export const DEMO_PATH_CONTEXT: PathContext = { locale: 'en', defaultLocale: 'en', locales: ['en'] }

const node = (key: string, label: string, parentKey: string | null, order: number, archivedAt: string | null = null): CategoryNode => ({
  key,
  label: { en: label },
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt,
})

export const DEMO_NODES: CategoryNode[] = [
  node('food', 'Food', null, 1000),
  node('pizza', 'Pizza', 'food', 1000),
  node('rosse', 'Rosse', 'pizza', 1000),
  node('bianche', 'Bianche', 'pizza', 2000),
  node('pasta', 'Pasta', 'food', 2000),
  node('desserts', 'Desserts', 'food', 3000),
  node('drinks', 'Drinks', null, 2000),
  node('beer', 'Beer', 'drinks', 1000),
  node('wine', 'Wine', 'drinks', 2000),
  node('spirits', 'Spirits', 'drinks', 3000, '2026-10-01T00:00:00Z'),
]

export const demoTree = (nodes: readonly CategoryNode[] = DEMO_NODES): CategoryTree => buildTree(nodes)

/** What the taxonomy service does for a move, in memory: validate, apply the patches, rebuild. */
export function applyDemoMove(nodes: readonly CategoryNode[], req: MoveRequest): CategoryNode[] {
  const plan = validateMove(buildTree(nodes), req)
  if (!plan.ok) return [...nodes]
  const byKey = new Map(plan.patches.map((p) => [p.key, p]))
  return nodes.map((n) => {
    const p = byKey.get(n.key)
    return p ? { ...n, parentKey: p.parentKey, order: p.order } : n
  })
}

export const demoLabel = (tree: CategoryTree) => (key: string) => tree.nodes.get(key)?.label.en ?? key
