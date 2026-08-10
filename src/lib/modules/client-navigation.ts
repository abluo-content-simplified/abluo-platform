// ── Client-dashboard navigation builder ───────────────────────────────────────
// ADR-017 slice 6 / task #81 (Client dashboard shell + module-driven nav).
//
// Next.js-safe SIBLING to navigation.ts. Where navigation.ts projects the
// module registry into Sanity STUDIO structure (and therefore imports
// `sanity/structure`), this file projects the SAME `MODULE_REGISTRY` truth into
// CLIENT DASHBOARD navigation items — href-based, locale-agnostic, renderable
// from a React Server/Client Component. It imports NOTHING from Studio and is
// unit-testable in isolation.
//
// Design rules honoured here:
//   • Configuration over hardcoding — the module→dashboard-page mapping lives in
//     the single `MODULE_DASHBOARD_ROUTES` surface below, never inline in a
//     component or route.
//   • Multilingual-first — nav items carry an i18n `labelKey`
//     (`clientDashboard.nav.<moduleId>`), never a resolved English string. The
//     Studio-only manifest `label` is deliberately NOT used for client-facing
//     labels (Tom's locked decision #2).
//   • Platform before tenant — the builder reads the platform registry and a
//     per-request `ProjectGrant`; it contains no tenant-specific branches.

import type { ProjectGrant } from '@/lib/api/tenant-context'
import { MODULE_REGISTRY } from './registry'
import type { ModuleManifest } from './types'

/**
 * The single authoritative mapping from a module id to the client-dashboard
 * sub-page (URL segment) that surfaces that module's content.
 *
 * Only modules with an entry here contribute a nav item. A module can be
 * installed/enabled on a project yet still have no client-dashboard page wired
 * (its Studio management surface exists; its client surface does not yet). Such
 * a module is intentionally skipped by `buildClientNavItems` — its i18n label
 * still exists (enforced by the nav-label completeness test) so that wiring its
 * page later is a one-line addition here, with zero string work.
 *
 * Phase 2 wires exactly one client page: the Blog module's post list
 * (`/{projectSlug}/posts`, the Phase 1 read path). `events` and `live` are
 * released modules whose client-dashboard pages are a later slice — they carry
 * labels but no route yet.
 */
export const MODULE_DASHBOARD_ROUTES: Record<string, string> = {
  blog: 'posts',
}

/** A single module-driven client-dashboard navigation item. */
export type ClientNavItem = {
  /** The originating module id (e.g. `'blog'`). */
  moduleId: string
  /**
   * next-intl message key for the item's label —
   * `clientDashboard.nav.<moduleId>`. Never a resolved string; the rendering
   * component translates it for the active interface locale.
   */
  labelKey: string
  /**
   * Locale-AGNOSTIC dashboard href, `/{projectSlug}/{segment}`. The rendering
   * component (a next-intl `Link`) prepends the active locale. Kept
   * locale-free so this function stays pure and deterministically testable.
   */
  href: string
}

/**
 * Builds the module-driven navigation for a single project grant.
 *
 * Filters `registry` to modules that are BOTH enabled for the grant
 * (`grant.enabledModuleIds`) AND have a client-dashboard route mapping
 * (`MODULE_DASHBOARD_ROUTES`), then projects each to a `ClientNavItem`. Registry
 * order is preserved (stable nav ordering). Pure — no I/O, no Next imports.
 *
 * Consequence (the "Blog nav only if Blog enabled" rule): a module absent from
 * `grant.enabledModuleIds` yields NO item, so the sidebar shows only the
 * modules actually enabled for the active project.
 */
export function buildClientNavItems(
  grant: ProjectGrant,
  registry: ModuleManifest[] = MODULE_REGISTRY
): ClientNavItem[] {
  const enabled = new Set(grant.enabledModuleIds)

  return registry
    .filter((manifest) => enabled.has(manifest.id) && manifest.id in MODULE_DASHBOARD_ROUTES)
    .map((manifest) => ({
      moduleId: manifest.id,
      labelKey: `clientDashboard.nav.${manifest.id}`,
      href: `/${grant.projectSlug}/${MODULE_DASHBOARD_ROUTES[manifest.id]}`,
    }))
}

/**
 * Resolves the `ProjectGrant` for `projectSlug` from a caller's grants, or
 * `null` if the caller holds no grant for it.
 *
 * This is the pure core of the ADR-017 "re-validate `projectSlug` against
 * `ctx.projects` on every request; never silently substitute" rule: the route
 * layer calls this with the slug taken from the URL, and on `null` calls
 * `notFound()` (a 404) — it never falls back to `ctx.projects[0]`. Extracted so
 * the no-silent-substitute decision can be unit-tested without a live request.
 */
export function resolveProjectGrant(
  projects: ProjectGrant[],
  projectSlug: string
): ProjectGrant | null {
  return projects.find((grant) => grant.projectSlug === projectSlug) ?? null
}
