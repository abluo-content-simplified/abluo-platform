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
import { sortByModuleOrder } from '@/lib/modules/order'

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
  /**
   * Path under `/{projectSlug}/` — usually one segment (`posts`); a module's
   * sub-destination has two (`catalogue/items`, ADR-042 N2). Every destination
   * is a real route (deep-linkable), never a tab.
   */
  segment: string
  requires: SurfaceRequirement
  /** Sidebar group (ADR-042 §3). */
  group: NavGroup
  /**
   * Nested routes that belong to this destination without sitting under its
   * path: `/{project}/{base}/…` is this destination unless the next segment is
   * in `except` (those have destinations of their own). Catalogue → Items owns
   * an item's editor and the new-item flow (`/catalogue/<id>`, `/catalogue/new`).
   */
  owns?: { base: string; except: readonly string[] }
  /** False while the route does not exist: declared, never shown, never counted as a section the project has. */
  available?: boolean
}

/**
 * The dashboard navigation groups (ADR-042 N1, placements confirmed by Tom
 * 2026-11-02), in sidebar order. Home sits above them and is not a surface;
 * `bottom` is the unheaded block under the groups (Support, What's New, More You
 * Can Add). An empty group is not shown. PLAT-3 (`@/lib/modules/order`) keeps
 * governing module order in Studio and inside a group.
 */
export const NAV_GROUPS = ['content', 'catalogue', 'visitors', 'library', 'insights', 'project', 'bottom'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]
export type HeadedNavGroup = Exclude<NavGroup, 'bottom'>
export const HEADED_NAV_GROUPS: readonly HeadedNavGroup[] = NAV_GROUPS.filter((g): g is HeadedNavGroup => g !== 'bottom')

/** Does this group have a heading (a disclosure in the sidebar, a flyout in the rail)? */
export function isHeadedNavGroup(group: NavGroup): group is HeadedNavGroup {
  return group !== 'bottom'
}

/** A module's screen in its group (ADR-042 §3); order inside the registry follows the shared module order (PLAT-3). */
function moduleNav(id: string, segment: string, module: string, permission: string, group: NavGroup): NavSurface {
  return { kind: 'nav', id, segment, group, requires: { module, permission } }
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

/** Feature controls (and the configuration permissions a surface may be gated on) Tom has explicitly approved for the tenant UI. */
export const FEATURE_CONTROL_ALLOWLIST: readonly string[] = [
  // Tom, 2026-11-02: client Billing page (ADR-041 Phase 5). The one tenant surface that may be gated on
  // a configuration permission: the Owner pays for the site there (the page re-checks at tenant scope).
  'billing.manage',
]

/** Catalogue routes with a destination of their own: not Items' nested routes. */
export const CATALOGUE_OWN_ROUTES: readonly string[] = ['collections', 'option-lists', 'setup']

/** Flip with the `catalogue/setup` route (a test refuses the flag when the folder is missing, or the folder when the flag is off). */
export const CATALOGUE_SETUP_ROUTE_EXISTS = true

/**
 * Flip with the `testimonials` dashboard route (ADR-048). The core slice ships the nav entry, the module
 * and the API; the page is built next. While false the sidebar does not show "Testimonials" (no dead link);
 * the route-folder test skips it. After flipping, add `['testimonials', 'content']` to the Owner nav
 * expectation in `modules/__tests__/order.test.ts` and 'testimonials' to the content group in `surfaces.test.ts`.
 */
export const TESTIMONIALS_ROUTE_EXISTS = true

/** The Setup permission. Flip `CATALOGUE_SETUP_PERMISSION_DEFINED` when it is added to the catalogue manifest (a test keeps the two in step). */
export const CATALOGUE_SETUP_PERMISSION = 'catalogue.setup.manage'
export const CATALOGUE_SETUP_PERMISSION_DEFINED = true

/** Permissions that open Catalogue → Setup: the Setup permission once it exists (false until then), and the category permission (K-4/D-3). */
export function catalogueSetupPermissions(): string[] {
  return [...(CATALOGUE_SETUP_PERMISSION_DEFINED ? [CATALOGUE_SETUP_PERMISSION] : []), 'catalogue.taxonomy.write']
}

/**
 * The modules' own screens. Listed in any order: their sidebar order and group
 * come from `@/lib/modules/order` (PLAT-3), shared with the Studio module list.
 * Each needs its module installed + enabled AND the permission.
 */
const MODULE_NAV: readonly NavSurface[] = sortByModuleOrder(
  [
    moduleNav('blog', 'posts', 'blog', 'blog.post.read', 'content'),
    // `agenda`, not `events`: `/{project}/events` is the public website's events route.
    moduleNav('events', 'agenda', 'events', 'events.event.read', 'content'),
    // ADR-045: Courses (weekly classes + timetable), next to Events. The Timetable page lives under /courses/timetable.
    moduleNav('courses', 'courses', 'courses', 'courses.course.read', 'content'),
    // ADR-037 D9: the FAQ Sets library (list + editor).
    moduleNav('faq', 'faq-sets', 'faq', 'faq.set.read', 'content'),
    moduleNav('gallery', 'galleries', 'gallery', 'gallery.gallery.read', 'content'),
    // ADR-048: Testimonials (what people say), in Content. Hidden until the dashboard page exists.
    { ...moduleNav('testimonials', 'testimonials', 'testimonials', 'testimonials.read', 'content'), available: TESTIMONIALS_ROUTE_EXISTS },
    // ADR-033 D12 / C11 (K-2): every Catalogue entry is labelled by the interface dictionary ("Catalogue" group).
    // ADR-042 N2 / N2a: the Catalogue group — Items · Collections · Options · Setup, each a real route.
    // `/catalogue` redirects to Items; an item's editor and the new-item flow light Items.
    { ...moduleNav('catalogueItems', 'catalogue/items', 'catalogue', 'catalogue.item.read', 'catalogue'), owns: { base: 'catalogue', except: CATALOGUE_OWN_ROUTES } },
    moduleNav('catalogueCollections', 'catalogue/collections', 'catalogue', 'catalogue.item.read', 'catalogue'),
    moduleNav('catalogueOptions', 'catalogue/option-lists', 'catalogue', 'catalogue.item.read', 'catalogue'),
    // Setup (N2a): the Setup permission, or `catalogue.taxonomy.write` (Categories & Tags only). Hidden until its route exists.
    { kind: 'nav', id: 'catalogueSetup', segment: 'catalogue/setup', group: 'catalogue', available: CATALOGUE_SETUP_ROUTE_EXISTS, requires: { module: 'catalogue', anyPermission: catalogueSetupPermissions() } },
    // ADR-040 §15 — Documents (the library).
    moduleNav('documents', 'document-library', 'documents', 'documents.document.read', 'content'),
    moduleNav('forms', 'submissions', 'forms', 'forms.submission.read', 'visitors'),
    // ADR-044 D16.15: Bookings, one area. `/bookings` is the list; Booking rules is a tab of it.
    // Not placed in order.ts on purpose (it stays out of "More You Can Add" until the website side exists), so it sorts after the placed modules.
    moduleNav('reservations', 'bookings', 'reservations', 'reservations.booking.read', 'visitors'),
    // ADR-040 B2.5 / §15 — Access (groups, passwords, who can see each page): next to Forms (PLAT-3).
    moduleNav('members', 'access', 'members', 'members.access.read', 'visitors'),
    // ADR-043 — People: one list of the site's people (team, teachers, authors), in the Library group next to Media.
    moduleNav('people', 'people', 'people', 'people.person.read', 'library'),
  ],
  (s) => s.requires.module as string
)

export const TENANT_SURFACES: readonly TenantSurface[] = [
  // ── Navigation (order = sidebar order, after Home) ──────────────────────
  // 1. The modules' screens, in the shared module order and groups (PLAT-3).
  ...MODULE_NAV,
  // 2. Content work that is not a module.
  { kind: 'nav', id: 'media', segment: 'media', group: 'library', requires: { permission: 'media.library.manage' } },
  // ADR-033 Amendment J: Categories & Tags, one manager for every module that declares a taxonomy.
  // Shown when the person may manage terms (`<module>.taxonomy.write`) or at least read them
  // (the module's read permission; viewers list read-only) in one of those modules, or the internal
  // tags of Media / Galleries (`media.library.manage`, `gallery.gallery.read|write`). The list is kept equal to the
  // manifests (plus media and gallery) by `lib/taxonomy/__tests__/surface.test.ts`.
  {
    kind: 'nav',
    id: 'taxonomy',
    segment: 'taxonomy',
    group: 'library',
    requires: {
      anyOf: [
        // Catalogue V2 R2 (K-4, C8 §8.3): no Catalogue here — its categories and tags are edited in Catalogue → Setup.
        { anyModule: ['blog', 'documents', 'events', 'news', 'people', 'testimonials'], anyPermission: ['testimonials.taxonomy.write', 'testimonials.read', 'blog.taxonomy.write', 'blog.post.read', 'documents.taxonomy.write', 'documents.document.read', 'events.taxonomy.write', 'events.event.read', 'news.taxonomy.write', 'news.article.read', 'people.taxonomy.write', 'people.person.read'] },
        // Internal tags of the media library and of galleries (Media and Galleries tabs).
        { permission: 'media.library.manage' },
        { module: 'gallery', anyPermission: ['gallery.gallery.read', 'gallery.gallery.write'] },
      ],
    },
  },
  // 3. Activity: how the site is doing. Contact requests moved to Visitors (PLAT-3).
  // Analytics is not a module (ADR-029 §3.4): only the permission gates it. Whether
  // Google is connected is Abluo's configuration, which tenant code may not read
  // (boundary test) — the page itself says "not connected yet" until it is.
  { kind: 'nav', id: 'analytics', segment: 'analytics', group: 'insights', requires: { permission: 'analytics.read' } },
  // 4. Support & configuration ("What's new" opens this group in the sidebar).
  // Support (Tom, 2026-10-22): a "coming soon" page for everyone on the project until ticketing exists.
  { kind: 'nav', id: 'support', segment: 'support', group: 'bottom', requires: {} },
  // Users (was "People"; Tom, 2026-11-03): who can log in to the site. ADR-043 gives `/people` to the People module.
  { kind: 'nav', id: 'users', segment: 'users', group: 'project', requires: { anyPermission: ['users.invite', 'users.manage'] } },
  // ADR-031: partner apps reading this site. Owners and Site admins only; always listed (calm empty state).
  { kind: 'nav', id: 'connections', segment: 'apps', group: 'project', requires: { permission: 'connections.manage' } },
  // Settings (Tom, 2026-10-18; 2026-10-28): the client's own settings — today Form notifications (who receives form emails).
  // The affiliate programs live only in Connected Apps (`connections`) since 2026-10-26.
  // Never technical configuration: gated on its own content-style permission, NOT `settings.manage`.
  { kind: 'nav', id: 'settings', segment: 'settings', group: 'project', requires: { permission: 'site.details.read' } },
  // Billing (ADR-041 Phase 5; Tom, 2026-11-02): the Owner pays here; a member granted invoice access can look.
  // Both are TENANT permissions: the layout adds them to the grant it builds the sidebar from
  // (`billingNavPermissions`). Allowlisted in FEATURE_CONTROL_ALLOWLIST.
  { kind: 'nav', id: 'billing', segment: 'billing', group: 'project', requires: { anyPermission: ['billing.manage', 'billing.invoice.read'] } },

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

/** Stable sort into group order (ADR-042 N1). */
function sortByGroup(nav: NavSurface[]): NavSurface[] {
  return nav.map((s, i) => ({ s, i })).sort((a, b) => NAV_GROUPS.indexOf(a.s.group) - NAV_GROUPS.indexOf(b.s.group) || a.i - b.i).map((x) => x.s)
}

/** Everything this grant may see, in group order then registry order. */
export function buildTenantSurfaces(
  grant: SurfaceGrant,
  registry: readonly TenantSurface[] = TENANT_SURFACES,
): TenantSurfaces {
  const visible = registry.filter((s) => surfaceAllowed(grant, s.requires))
  return {
    // Declared-but-unbuilt destinations never show; groups keep ADR-042 order, registry order inside a group.
    nav: sortByGroup(visible.filter((s): s is NavSurface => s.kind === 'nav' && s.available !== false)),
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
  return [...new Set(buildTenantSurfaces(grant).nav.map((s) => s.segment.split('/')[0]))]
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
