/**
 * "More You Can Add" — the showcase of modules a site does not have yet.
 *
 * Selection rule (Tom, 2026-10-29): a module is shown when it is placed in a
 * sidebar group of `MODULE_GROUPS` (Publish, Show, Visitors, Tools) — those are
 * the modules meant for tenants — and it is NOT installed on this project.
 * Modules not placed there (anything that would land in "Other") are internal
 * or platform-only and never appear. Same "not installed" logic as the
 * Add-content sheet (`add-content-sheet.ts`), but over every tenant-facing
 * module, not only content ones.
 *
 * Pure and browser-safe. Copy lives in messages (`clientDashboard.discover`).
 */
import { groupByModuleOrder, MODULE_GROUPS, type ModuleGroupId } from './order'

/** Every module a tenant can be shown, in display order. */
export const DISCOVER_MODULE_IDS: readonly string[] = MODULE_GROUPS.flatMap((g) => g.modules)

/** One 24×24 stroke path per module (same drawing style as the sidebar icons). */
export const DISCOVER_ICONS: Record<string, string> = {
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  news: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2M18 14h-8M15 18h-5M10 6h8v4h-8z',
  events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  faq: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9.6 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.2-2.5 2.2M12 15.5h.01',
  live: 'M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19M12 12h.01',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  catalogue: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  documents: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  forms: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  whatsapp: 'M7.9 20A9 9 0 1 0 4 16.1L2 22z',
  members: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  translate: 'm5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
  'brand-hub': 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
}

export type DiscoverGroup = { id: ModuleGroupId; moduleIds: string[] }

/** The not-installed, tenant-facing modules, grouped like the sidebar. Empty when everything is installed. */
export function buildDiscover(enabledModuleIds: readonly string[]): DiscoverGroup[] {
  const installed = new Set(enabledModuleIds)
  const missing = DISCOVER_MODULE_IDS.filter((id) => !installed.has(id))
  return groupByModuleOrder(missing, (id) => id).map((g) => ({ id: g.group.id, moduleIds: g.items }))
}

/** Where "Tell me more" goes: a new support request with the subject (and a short note) filled in. */
export function discoverRequestHref(projectSlug: string, title: string, body: string): string {
  const q = new URLSearchParams({ title, body, from: `/${projectSlug}/discover` })
  return `/${projectSlug}/support/new?${q.toString()}`
}
