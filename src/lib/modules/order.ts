/**
 * Module order and groups — PLAT-3 (Tom, approved 2026-10-28).
 *
 * The ONE definition of the order in which modules are listed and the group
 * each one belongs to, used by BOTH the Studio module list (ModulesOverview,
 * ModuleList's index, the Content list) and the client dashboard sidebar
 * (`src/lib/client/surfaces.ts`). Neither surface keeps a list of its own, so
 * the order never depends on the order modules were added to the registry or
 * installed on a project.
 *
 *   | Publish  | Blog, News, Events, FAQ (+ Live)      |
 *   | Show     | Gallery, Catalogue (+ Documents)      |
 *   | Visitors | Forms, WhatsApp, Access               |
 *   | Tools    | Translate, Brand Hub                  |
 *
 * Placed by judgement (not in Tom's table): Documents → Show, after Catalogue
 * (as instructed); Live → end of Publish (it publishes a live feed of posts).
 * A module missing here falls into "Other", after Tools, ordered by id — the
 * test `__tests__/order.test.ts` fails until it is placed on purpose.
 *
 * Pure and browser-safe: no imports, so Studio and the dashboard can share it.
 */

export type ModuleGroupId = 'publish' | 'show' | 'visitors' | 'tools' | 'other'

export type ModuleGroupDef = {
  id: ModuleGroupId
  /** English label (Studio is English; the dashboard uses `clientDashboard.navGroups.<id>`). */
  label: string
  /** Module ids, in display order. */
  modules: readonly string[]
}

export const MODULE_GROUPS: readonly ModuleGroupDef[] = [
  { id: 'publish', label: 'Publish', modules: ['blog', 'news', 'events', 'faq', 'live'] },
  { id: 'show', label: 'Show', modules: ['gallery', 'catalogue', 'documents'] },
  // `members` is the Access module (label "Access").
  { id: 'visitors', label: 'Visitors', modules: ['forms', 'whatsapp', 'members'] },
  { id: 'tools', label: 'Tools', modules: ['translate', 'brand-hub'] },
]

export const OTHER_MODULE_GROUP: ModuleGroupDef = { id: 'other', label: 'Other', modules: [] }

const POSITION = new Map<string, { group: ModuleGroupId; index: number }>()
let n = 0
for (const g of MODULE_GROUPS) for (const id of g.modules) POSITION.set(id, { group: g.id, index: n++ })

/** The group a module belongs to ('other' when it is not placed). */
export function moduleGroupOf(moduleId: string): ModuleGroupId {
  return POSITION.get(moduleId)?.group ?? 'other'
}

/** Compare two module ids by the fixed order; unplaced ones go last, by id. */
export function compareModuleIds(a: string, b: string): number {
  const pa = POSITION.get(a)?.index ?? Number.MAX_SAFE_INTEGER
  const pb = POSITION.get(b)?.index ?? Number.MAX_SAFE_INTEGER
  return pa !== pb ? pa - pb : a < b ? -1 : a > b ? 1 : 0
}

/** A copy of `items` in the fixed module order (the input order never matters). */
export function sortByModuleOrder<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  return [...items].sort((x, y) => compareModuleIds(idOf(x), idOf(y)))
}

/**
 * `items` grouped and ordered: Publish, Show, Visitors, Tools, then Other.
 * Empty groups are left out.
 */
export function groupByModuleOrder<T>(items: readonly T[], idOf: (item: T) => string): Array<{ group: ModuleGroupDef; items: T[] }> {
  const sorted = sortByModuleOrder(items, idOf)
  return [...MODULE_GROUPS, OTHER_MODULE_GROUP]
    .map((group) => ({ group, items: sorted.filter((i) => moduleGroupOf(idOf(i)) === group.id) }))
    .filter((g) => g.items.length > 0)
}
