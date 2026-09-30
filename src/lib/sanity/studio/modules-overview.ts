// Pure rules for the Studio Modules overview pane (ModulesOverview.tsx) — kept
// free of Studio imports so they are unit-testable.

export type Installation = { moduleId?: string; enabled?: boolean }

/** Enabled = listed and not explicitly disabled — same rule as the GROQ `[enabled != false]` used elsewhere. */
export function enabledModuleIdsFrom(installations: Installation[] | null | undefined): string[] {
  return (installations ?? [])
    .filter((i) => typeof i?.moduleId === 'string' && i.enabled !== false)
    .map((i) => i.moduleId as string)
}

/** Registry order is kept inside each group, so the list never reshuffles within a group. */
export function splitModules<T extends { id: string }>(registry: readonly T[], enabledIds: readonly string[]) {
  const on = new Set(enabledIds)
  return {
    active: registry.filter((m) => on.has(m.id)),
    inactive: registry.filter((m) => !on.has(m.id)),
  }
}
