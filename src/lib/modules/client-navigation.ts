// ── Client-dashboard navigation builder ───────────────────────────────────────
// ADR-017 slice 6 / task #81 (Client dashboard shell + module-driven nav).
//
// Next.js-safe SIBLING to navigation.ts (which projects the module registry into
// Sanity STUDIO structure and imports `sanity/structure`). This file projects the
// TENANT SURFACE REGISTRY (`src/lib/client/surfaces.ts`, ADR-029 §3.1) into
// CLIENT DASHBOARD navigation items — href-based, locale-agnostic, renderable
// from a React Server/Client Component. It imports NOTHING from Studio.
//
// Design rules honoured here:
//   • One source of truth — what the tenant can see, and what it needs (module +
//     permission), is declared once in the registry; this file only projects it.
//   • Multilingual-first — nav items carry an i18n `labelKey`
//     (`clientDashboard.nav.<id>`), never a resolved English string.
//   • Platform before tenant — no tenant-specific branches.

import type { ProjectGrant } from '@/lib/api/tenant-context'
import {
  buildTenantSurfaces,
  TENANT_SURFACES,
  type NavSurface,
  type TenantSurface,
} from '@/lib/client/surfaces'

const isNavSurface = (s: TenantSurface): s is NavSurface => s.kind === 'nav'

/** URL segment of a registered nav surface (`'blog'` → `'posts'`), or undefined. */
export function segmentOf(id: string): string | undefined {
  return TENANT_SURFACES.filter(isNavSurface).find((s) => s.id === id)?.segment
}

/**
 * Module id → client-dashboard sub-page (URL segment). DERIVED from the tenant
 * surface registry (ADR-029 §3.1) — never edited here: add a nav surface with a
 * `module` requirement in `src/lib/client/surfaces.ts` and it appears. Kept as an
 * export because pages build links to a module's list from it.
 */
export const MODULE_DASHBOARD_ROUTES: Record<string, string> = Object.fromEntries(
  TENANT_SURFACES.filter(isNavSurface)
    .filter((s) => s.requires.module)
    .map((s) => [s.requires.module as string, s.segment]),
)

/**
 * The client dashboard's home page segment (S1, ADR-025): `/{projectSlug}/home`.
 * Not module-driven — every project has a home. `/{locale}/{projectSlug}` itself
 * is the tenant's public website, so the home needs its own segment. Listed in
 * CLIENT_PROJECT_SEGMENTS (src/lib/proxy/client-surface.ts) so the gate covers it.
 */
export const DASHBOARD_HOME_SEGMENT = 'home'

/** Locale-agnostic href of a project's dashboard home. */
export function dashboardHomeHref(projectSlug: string): string {
  return `/${projectSlug}/${DASHBOARD_HOME_SEGMENT}`
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
 * The dashboard navigation for one project grant: exactly the nav surfaces in
 * the registry that the grant satisfies (module installed AND permission held),
 * in registry order. Pure — no I/O, no Next imports.
 *
 * `moduleId` carries the surface id (`'blog'`, `'forms'`, `'media'`, …): the
 * icon and the `clientDashboard.nav.<id>` label key.
 */
export function buildClientNavItems(
  grant: Pick<ProjectGrant, 'projectSlug' | 'permissions' | 'enabledModuleIds'>,
  registry: readonly TenantSurface[] = TENANT_SURFACES,
): ClientNavItem[] {
  return buildTenantSurfaces(grant, registry).nav.map((s) => ({
    moduleId: s.id,
    labelKey: `clientDashboard.nav.${s.id}`,
    href: `/${grant.projectSlug}/${s.segment}`,
  }))
}

/** The Media screen segment (`/{projectSlug}/media`), from the registry. */
export const MEDIA_SEGMENT = segmentOf('media') as string

/** The People screen segment (`/{projectSlug}/people`), from the registry. */
export const PEOPLE_SEGMENT = segmentOf('people') as string

/**
 * @deprecated Use `buildClientNavItems`. Thin filter kept for existing callers
 * (the Media Library test); Media needs no module, only the permission.
 */
export function mediaNavItems(grant: Pick<ProjectGrant, 'projectSlug' | 'permissions'>): ClientNavItem[] {
  return buildClientNavItems({ ...grant, enabledModuleIds: [] }).filter((i) => i.moduleId === 'media')
}

// Phone nav helpers live in a browser-safe module (this one reaches server code).
export { isNavItemActive, PHONE_TAB_MODULE_IDS, phoneNavLayout, type PhoneNavLayout } from './client-nav-layout'

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
  const matches = projects.filter((grant) => grant.projectSlug === projectSlug)

  if (matches.length === 1) return matches[0]

  // ── AMBIGUITY FAILS CLOSED — do not "fix" this back to .find() ─────────────
  //
  // `projects.slug` used to be GLOBALLY unique, so a slug could only ever match
  // one grant and `.find()` was safe. Migration 023 makes it unique per TENANT
  // instead — deliberately, because "you cannot call your project `main`
  // because a different customer already did" is what produced the
  // `livener-main` naming and the whole three-namespace mess (see
  // src/lib/tenancy/RENAME.md).
  //
  // The cost of that freedom lands exactly here. This function is handed a bare
  // slug from the dashboard URL `/{locale}/{projectSlug}/…`, which carries NO
  // tenant, and searches `ctx.projects` — EVERY project the caller can reach,
  // across every tenant they belong to. A user in two tenants that each own a
  // project called `main` would, with `.find()`, silently get whichever came
  // back first: the wrong client's content, no error, no log.
  //
  // So: more than one match returns null. Every caller already treats null as
  // notFound()/redirect (layout.tsx, posts, leads, submissions, analytics,
  // and the last-project fallback in (client)/page.tsx), so refusing is a 404
  // rather than a wrong answer. Showing one customer another customer's
  // dashboard is far worse than showing nobody anything.
  //
  // This is a stop-gap that is CORRECT, not a stop-gap that is convenient. The
  // real fix is to put the tenant in the dashboard URL, at which point the
  // lookup becomes (tenant, slug) and can never be ambiguous. Until someone
  // actually hits this 404, that URL change is not worth making.
  if (matches.length > 1) {
    console.error(
      `[client-navigation] AMBIGUOUS project slug "${projectSlug}" — it matches ` +
        `${matches.length} grants across the tenants this user belongs to ` +
        `(${matches.map((g) => g.projectId).join(', ')}). Refusing to guess; ` +
        `returning null so the caller 404s. The dashboard URL needs to carry ` +
        `the tenant. See resolveProjectGrant in src/lib/modules/client-navigation.ts.`
    )
    return null
  }

  return null
}
