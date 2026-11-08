/**
 * Dashboard search (ADR-047, batch B) — pages INSIDE a section that people look
 * for by name ("form email" → Settings › Form Notifications). The registry below
 * is the contract: `parent` is a nav item id (`moduleId` of buildClientNavItems),
 * and a destination shows only when its parent is in the person's navigation and,
 * when given, `permission` is held. Admin-only / Studio surfaces are never listed.
 * Labels and keywords are translated:
 *   app.search.destinations.<id>.label     e.g. "Form Notifications"
 *   app.search.destinations.<id>.keywords  comma list, e.g. "form email, recipients"
 *
 * Keep ids stable. Add a page here when it is a real route a client looks for by
 * name; "new X" create flows belong to the Create menu, not here.
 */
export type SubDestination = {
  /** Stable id, also the message key segment. */
  id: string
  /** The parent navigation item's `moduleId` (as in buildClientNavItems). */
  parent: string
  /** Locale-agnostic dashboard href. */
  href: (projectSlug: string) => string
  /** Extra permission needed beyond seeing the parent, if any. */
  permission?: string
}

export const SUB_DESTINATIONS: SubDestination[] = [
  { id: 'settings-form-notifications', parent: 'settings', href: (s) => `/${s}/settings` },
  { id: 'settings-translations', parent: 'settings', href: (s) => `/${s}/settings` },
  { id: 'connected-affiliate-programs', parent: 'connections', href: (s) => `/${s}/apps`, permission: 'site.details.read' },
  { id: 'connected-partner-apps', parent: 'connections', href: (s) => `/${s}/apps` },
  { id: 'users-invite', parent: 'users', href: (s) => `/${s}/users` },
  { id: 'billing-invoices', parent: 'billing', href: (s) => `/${s}/billing` },
  { id: 'taxonomy-media-tags', parent: 'taxonomy', href: (s) => `/${s}/taxonomy?tab=media`, permission: 'media.library.manage' },
  { id: 'taxonomy-gallery-tags', parent: 'taxonomy', href: (s) => `/${s}/taxonomy?tab=galleries` },
  { id: 'media-add', parent: 'media', href: (s) => `/${s}/media/add` },
  { id: 'catalogue-setup-starters', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/starters`, permission: 'catalogue.setup.manage' },
  { id: 'catalogue-setup-website', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/website`, permission: 'catalogue.setup.manage' },
  { id: 'catalogue-setup-defaults', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/defaults`, permission: 'catalogue.setup.manage' },
  { id: 'catalogue-setup-categories', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/categories` },
  { id: 'catalogue-setup-tags', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/categories?tab=tags` },
  { id: 'catalogue-setup-channels', parent: 'catalogueSetup', href: (s) => `/${s}/catalogue/setup/channels`, permission: 'catalogue.setup.manage' },
  { id: 'courses-timetable', parent: 'courses', href: (s) => `/${s}/courses/timetable` },
  { id: 'booking-rules', parent: 'reservations', href: (s) => `/${s}/bookings/rules` },
  { id: 'documents-pages', parent: 'documents', href: (s) => `/${s}/document-library?tab=pages` },
]

/** The sub-destinations available to a person, given the parent sections they can see. */
export function availableSubDestinations(
  parents: ReadonlySet<string>,
  permissions: readonly string[],
  all: readonly SubDestination[] = SUB_DESTINATIONS,
): SubDestination[] {
  return all.filter((d) => parents.has(d.parent) && (!d.permission || permissions.includes(d.permission)))
}
