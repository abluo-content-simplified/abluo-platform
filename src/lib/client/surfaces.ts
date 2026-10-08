/**
 * Tenant surfaces — the ONE list of everything a tenant user can see in the
 * client dashboard (ADR-029 §3.1).
 *
 *   Visibility in the tenant CMS is opt-in, not automatic. A capability being
 *   supported by Abluo does not mean the tenant can see or configure it.
 *
 * Nothing renders in the tenant UI unless it is registered here: navigation
 * items, Home widgets, and (later) narrowly scoped feature controls. Each entry
 * names what it needs — a module installed on the project and/or a permission
 * the person holds — and `buildTenantSurfaces()` returns only the entries the
 * grant satisfies. The boundary test (`__tests__/surfaces.test.ts`) refuses
 * entries that would expose admin-only configuration.
 *
 * Browser-safe and pure: no server imports, so the sidebar and pages can use it.
 */

/** What a surface needs. Empty = anyone with a grant on the project. */
export type SurfaceRequirement = {
  /** A module that must be installed + enabled on the project. */
  module?: string
  /** A permission the person must hold on the project. */
  permission?: string
  /** At least one of these permissions (e.g. "can write posts OR galleries"). */
  anyPermission?: readonly string[]
}

export type NavSurface = {
  kind: 'nav'
  /** Stable id; also the icon / i18n suffix (`clientDashboard.nav.<id>`). */
  id: string
  /** URL segment under `/{projectSlug}/`. */
  segment: string
  requires: SurfaceRequirement
}

/** Where a Home widget sits. Each slot is laid out by the Home page. */
export type WidgetSlot = 'header' | 'setup' | 'attention' | 'continue' | 'glance' | 'latest'

export type WidgetSurface = {
  kind: 'widget'
  id: string
  slot: WidgetSlot
  requires: SurfaceRequirement
}

/**
 * A narrowly scoped control for ONE feature (e.g. connecting LinkedIn for
 * publishing). Never a general settings page. None exist yet; each one is a
 * deliberate product decision and is listed in FEATURE_CONTROL_ALLOWLIST.
 */
export type FeatureControlSurface = {
  kind: 'featureControl'
  id: string
  requires: SurfaceRequirement
}

export type TenantSurface = NavSurface | WidgetSurface | FeatureControlSurface

/** Grant shape the registry needs (a subset of `ProjectGrant`). */
export type SurfaceGrant = {
  permissions: readonly string[]
  enabledModuleIds: readonly string[]
}

/**
 * Permissions that unlock platform / project CONFIGURATION. A tenant may hold
 * some of them (an Owner holds `modules.manage`), but no tenant surface may be
 * gated on them unless it is a deliberately designed feature control. Enforced
 * by the boundary test.
 */
export const CONFIGURATION_PERMISSIONS: readonly string[] = [
  'tenants.manage',
  'support.access',
  'settings.manage',
  'modules.manage',
  'billing.manage',
  'forms.definition.manage',
]

/** Feature controls Tom has explicitly approved for the tenant UI. Empty on purpose. */
export const FEATURE_CONTROL_ALLOWLIST: readonly string[] = []

export const TENANT_SURFACES: readonly TenantSurface[] = [
  // ── Navigation (order = sidebar order, after Home) ──────────────────────
  { kind: 'nav', id: 'blog', segment: 'posts', requires: { module: 'blog', permission: 'blog.post.read' } },
  { kind: 'nav', id: 'forms', segment: 'submissions', requires: { module: 'forms', permission: 'forms.submission.read' } },
  { kind: 'nav', id: 'gallery', segment: 'galleries', requires: { module: 'gallery', permission: 'gallery.gallery.read' } },
  // Analytics is not a module (ADR-029 §3.4): only the permission gates it. Whether
  // Google is connected is Abluo's configuration, which tenant code may not read
  // (boundary test) — the page itself says "not connected yet" until it is.
  { kind: 'nav', id: 'analytics', segment: 'analytics', requires: { permission: 'analytics.read' } },
  { kind: 'nav', id: 'media', segment: 'media', requires: { permission: 'media.library.manage' } },
  { kind: 'nav', id: 'people', segment: 'people', requires: { anyPermission: ['users.invite', 'users.manage'] } },

  // ── Home widgets (ADR-029 §5) ───────────────────────────────────────────
  { kind: 'widget', id: 'siteStatus', slot: 'header', requires: {} },
  { kind: 'widget', id: 'attention', slot: 'attention', requires: {} },
  // "Get your site ready" (src/lib/client/setup-checklist.ts): each item is gated
  // again on its own; the card needs at least one of them.
  {
    kind: 'widget',
    id: 'setupChecklist',
    slot: 'setup',
    requires: { anyPermission: ['blog.post.write', 'media.library.manage', 'users.invite', 'users.manage', 'analytics.read'] },
  },
  {
    kind: 'widget',
    id: 'continueEditing',
    slot: 'continue',
    requires: { anyPermission: ['blog.post.write', 'gallery.gallery.write'] },
  },
  { kind: 'widget', id: 'glance.posts', slot: 'glance', requires: { module: 'blog', permission: 'blog.post.read' } },
  { kind: 'widget', id: 'glance.requests', slot: 'glance', requires: { module: 'forms', permission: 'forms.submission.read' } },
  { kind: 'widget', id: 'glance.galleries', slot: 'glance', requires: { module: 'gallery', permission: 'gallery.gallery.read' } },
  { kind: 'widget', id: 'glance.media', slot: 'glance', requires: { permission: 'media.library.manage' } },
  // "Website traffic" (ADR-029 §5): shown under At a glance once a snapshot has data.
  { kind: 'widget', id: 'traffic', slot: 'glance', requires: { permission: 'analytics.read' } },
  { kind: 'widget', id: 'latest.posts', slot: 'latest', requires: { module: 'blog', permission: 'blog.post.read' } },
  { kind: 'widget', id: 'latest.galleries', slot: 'latest', requires: { module: 'gallery', permission: 'gallery.gallery.read' } },
]

/**
 * Modules that are installable on a project but have NO tenant surface yet,
 * and why (Tom, 2026-10-08: "everything that is activated should appear").
 * The coverage test (`__tests__/surfaces.test.ts`) fails when a module in
 * MODULE_REGISTRY has neither a surface above nor an entry here — so a new
 * module can never silently be missing from the dashboard. Remove a module
 * from this list the moment its surfaces are registered (the test also fails
 * if a module is in both).
 *
 *   notYetBuilt — clients should see it; the client pages/widgets are backlog.
 *   adminOnly   — configured by Abluo; nothing for the tenant to do (ADR-029).
 */
export const MODULES_WITHOUT_TENANT_SURFACE: Readonly<Record<string, 'notYetBuilt' | 'adminOnly'>> = {
  events: 'notYetBuilt',
  news: 'notYetBuilt',
  live: 'notYetBuilt',
  whatsapp: 'adminOnly',
  translate: 'adminOnly',
}

/** The single visibility check. Pure. */
export function surfaceAllowed(grant: SurfaceGrant, requires: SurfaceRequirement): boolean {
  if (requires.module && !grant.enabledModuleIds.includes(requires.module)) return false
  if (requires.permission && !grant.permissions.includes(requires.permission)) return false
  if (requires.anyPermission && !requires.anyPermission.some((p) => grant.permissions.includes(p))) return false
  return true
}

export type TenantSurfaces = {
  nav: NavSurface[]
  widgets: WidgetSurface[]
  featureControls: FeatureControlSurface[]
}

/** Everything this grant may see, in registry order. */
export function buildTenantSurfaces(
  grant: SurfaceGrant,
  registry: readonly TenantSurface[] = TENANT_SURFACES,
): TenantSurfaces {
  const visible = registry.filter((s) => surfaceAllowed(grant, s.requires))
  return {
    nav: visible.filter((s): s is NavSurface => s.kind === 'nav'),
    widgets: visible.filter((s): s is WidgetSurface => s.kind === 'widget'),
    featureControls: visible.filter(
      (s): s is FeatureControlSurface => s.kind === 'featureControl' && FEATURE_CONTROL_ALLOWLIST.includes(s.id),
    ),
  }
}

/** Is one widget visible for this grant? (Home uses it to skip data reads.) */
export function hasWidget(surfaces: TenantSurfaces, id: string): boolean {
  return surfaces.widgets.some((w) => w.id === id)
}
