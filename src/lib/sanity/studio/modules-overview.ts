// Pure rules for the Studio Modules overview pane (ModulesOverview.tsx) — kept
// free of Studio imports so they are unit-testable.

import { groupByModuleOrder } from '../../modules/order'

export type Installation = { moduleId?: string; enabled?: boolean }

/** Enabled = listed and not explicitly disabled — same rule as the GROQ `[enabled != false]` used elsewhere. */
export function enabledModuleIdsFrom(installations: Installation[] | null | undefined): string[] {
  return (installations ?? [])
    .filter((i) => typeof i?.moduleId === 'string' && i.enabled !== false)
    .map((i) => i.moduleId as string)
}

/**
 * The overview's rows (PLAT-3, Tom 2026-10-28): every module in the fixed
 * order and groups of `@/lib/modules/order` (Publish · Show · Visitors ·
 * Tools), shared with the client dashboard sidebar. A module that is off
 * stays in its place, marked off (the pane greys it) — the list never
 * reshuffles when a module is switched on or off, and never depends on the
 * registry or installation order.
 */
export function groupModules<T extends { id: string }>(registry: readonly T[], enabledIds: readonly string[]) {
  const on = new Set(enabledIds)
  return groupByModuleOrder(registry, (m) => m.id).map(({ group, items }) => ({
    id: group.id,
    label: group.label,
    modules: items.map((module) => ({ module, on: on.has(module.id) })),
  }))
}
