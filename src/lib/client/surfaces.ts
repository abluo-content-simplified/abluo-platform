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
  /** At least one of these modules installed + enabled (a screen that spans modules). */
  anyModule?: readonly string[]
  /** A permission the person must hold on the project. */
  permission?: string
  /** At least one of these permissions (e.g. "can write posts OR galleries"). */
  anyPermission?: readonly string[]
  /** At least one of these whole requirements holds (a screen that spans unlike things, e.g. a module OR the media library). */
  anyOf?: readonly SurfaceRequirement[]
}

export type NavSurface = {
  kind: 'nav'
  /** Stable id; also the icon / i18n suffix (`clientDashboard.nav.<id>`). */
  id: string
  /** URL segment under `/{projectSlug}/`. */
  segment: string
  requires: SurfaceRequirement
  /**
   * Sidebar group (Tom, 2026-10-22): content work, then activity (what comes in,
   * how the site is doing), then support & configuration. Groups are separated
   * by spacing only — no headings. Home belongs to `content`; the client's
   * "What's new" row opens the `support` group.
   */
  group: NavGroup
}

export type NavGroup = 'content' | 'activity' | 'support'

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
  // Content: what the site publishes (Home is first, in the same group).
  { kind: 'nav', id: 'blog', segment: 'posts', group: 'content', requires: { module: 'blog', permission: 'blog.post.read' } },
  // `agenda`, not `events`: `/{project}/events` is the public website's events route.
  { kind: 'nav', id: 'events', segment: 'agenda', group: 'content', requires: { module: 'events', permission: 'events.event.read' } },
  // ADR-033 D12: one entry. Label "Catalogue" unless the project sets the optional `navLabel` override (presentation only).
  { kind: 'nav', id: 'catalogue', segment: 'catalogue', group: 'content', requires: { module: 'catalogue', permission: 'catalogue.item.read' } },
  { kind: 'nav', id: 'gallery', segment: 'galleries', group: 'content', requires: { module: 'gallery', permission: 'gallery.gallery.read' } },
  { kind: 'nav', id: 'media', segment: 'media', group: 'content', requires: { permission: 'media.library.manage' } },
  // People sits with the content work (Tom, 2026-10-22).
  { kind: 'nav', id: 'people', segment: 'people', group: 'content', requires: { anyPermission: ['users.invite', 'users.manage'] } },
  // ADR-037 D9: the FAQ Sets library (list + editor).
  { kind: 'nav', id: 'faq', segment: 'faq-sets', group: 'content', requires: { module: 'faq', permission: 'faq.set.read' } },
  // ADR-040 B2.5 — groups, passwords, protected documents and who can see each page.
  { kind: 'nav', id: 'members', segment: 'access', group: 'content', requires: { module: 'members', permission: 'members.access.read' } },
  // ADR-033 Amendment J: Categories & Tags, one manager for every module that declares a taxonomy.
  // Shown when the person may manage terms (`<module>.taxonomy.write`) or at least read them
  // (the module's read permission; viewers list read-only) in one of those modules, or the internal
  // tags of Media / Galleries (`media.library.manage`, `gallery.gallery.read|write`). The list is kept equal to the
  // manifests (plus media and gallery) by `lib/taxonomy/__tests__/surface.test.ts`.
  {
    kind: 'nav',
    id: 'taxonomy',
    segment: 'taxonomy',
    group: 'content',
    requires: {
      anyOf: [
        { anyModule: ['blog', 'catalogue', 'events', 'news'], anyPermission: ['blog.taxonomy.write', 'blog.post.read', 'catalogue.taxonomy.write', 'catalogue.item.read', 'events.taxonomy.write', 'events.event.read', 'news.taxonomy.write', 'news.article.read'] },
        // Internal tags of the media library and of galleries (Media and Galleries tabs).
        { permission: 'media.library.manage' },
        { module: 'gallery', anyPermission: ['gallery.gallery.read', 'gallery.gallery.write'] },
      ],
    },
  },
  // Activity: what comes in, and how the site is doing.
  { kind: 'nav', id: 'forms', segment: 'submissions', group: 'activity', requires: { module: 'forms', permission: 'forms.submission.read' } },
  // Analytics is not a module (ADR-029 §3.4): only the permission gates it. Whether
  // Google is connected is Abluo's configuration, which tenant code may not read
  // (boundary test) — the page itself says "not connected yet" until it is.
  { kind: 'nav', id: 'analytics', segment: 'analytics', group: 'activity', requires: { permission: 'analytics.read' } },
  // Support & configuration ("What's new" opens this group in the sidebar).
  // Support (Tom, 2026-10-22): a "coming soon" page for everyone on the project until ticketing exists.
  { kind: 'nav', id: 'support', segment: 'support', group: 'support', requires: {} },
  // ADR-031: partner apps reading this site. Owners and Site admins only; always listed (calm empty state).
  { kind: 'nav', id: 'connections', segment: 'apps', group: 'support', requires: { permission: 'connections.manage' } },
  // Settings (Tom, 2026-10-18): the client's own business facts (Amazon IDs, affiliate disclosure; contact and legal later).
  // Never technical configuration: gated on its own content-style permission, NOT `settings.manage`.
  { kind: 'nav', id: 'settings', segment: 'settings', group: 'support', requires: { permission: 'site.details.read' } },

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
  { kind: 'widget', id: 'glance.catalogue', slot: 'glance', requires: { module: 'catalogue', permission: 'catalogue.item.read' } },
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
  news: 'notYetBuilt',
  live: 'notYetBuilt',
  whatsapp: 'adminOnly',
  translate: 'adminOnly',
  // ADR-036 — the guide is written by Abluo in Studio; v1 has no client editing.
  'brand-hub': 'adminOnly',
}

/** The single visibility check. Pure. */
export function surfaceAllowed(grant: SurfaceGrant, requires: SurfaceRequirement): boolean {
  if (requires.module && !grant.enabledModuleIds.includes(requires.module)) return false
  if (requires.anyModule && !requires.anyModule.some((m) => grant.enabledModuleIds.includes(m))) return false
  if (requires.permission && !grant.permissions.includes(requires.permission)) return false
  if (requires.anyPermission && !requires.anyPermission.some((p) => grant.permissions.includes(p))) return false
  if (requires.anyOf && !requires.anyOf.some((r) => surfaceAllowed(grant, r))) return false
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

/**
 * The dashboard sections (URL segments under `/{projectSlug}/`) a grant can
 * open. The project switcher keeps the current section only when the target
 * project has it — otherwise it lands on Home instead of a 404 (Tom,
 * 2026-10-18: switching from TMZ's Catalogue to Livener, which has none).
 */
export function navSegmentsFor(grant: SurfaceGrant): string[] {
  return TENANT_SURFACES.filter((s): s is Extract<TenantSurface, { kind: 'nav' }> => s.kind === 'nav' && surfaceAllowed(grant, s.requires)).map((s) => s.segment)
}

/** Where the project switcher goes: the same section in the next project when it has it, else its Home. */
export function switchTarget(pathname: string, activeSlug: string, nextSlug: string, nextSegments: readonly string[]): string {
  const prefix = `/${activeSlug}`
  const rest = pathname === prefix || pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : ''
  const segment = rest.split('/')[1] ?? ''
  if (!segment || segment === 'home' || !nextSegments.includes(segment)) return `/${nextSlug}/home`
  // A specific item (/catalogue/<id>) belongs to the old project: open the section's list.
  return `/${nextSlug}/${segment}`
}
