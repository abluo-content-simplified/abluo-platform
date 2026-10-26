/**
 * Platform permission registry — ADR-028 §2.
 *
 * Module permissions (`{module}.{noun}.{verb}`) stay declared in their module
 * manifests (`src/lib/modules/registry.ts`) and are always PROJECT-scoped and
 * module-gated. This file declares the permissions that belong to the
 * platform itself. Together they are the complete, closed list of things the
 * code may check. An id that is in neither list is unknown, and an unknown
 * id is always refused (fail closed).
 *
 * Vocabulary (ADR-028 §2) — one meaning per verb, no synonyms:
 *   read    see
 *   write   create and edit
 *   update  change the state of an existing record
 *   delete  remove
 *   manage  configure or administer (for users: change or remove people)
 *   invite  add people at or below your own level
 *   use     invoke a tool
 *
 * `grantable` — may be given to a person as an EXTRA on their membership
 * (ADR-028 §3). Everything else comes only from a role.
 *
 * `defaults` — which roles hold the permission without any extra, per scope.
 * Platform-scope permissions are held by Super Admin only and are never
 * grantable.
 */
import type { AccessRole, TenantMembershipRole } from './roles'

export type PermissionScope = 'platform' | 'tenant' | 'project'

export type PlatformPermissionDef = {
  id: string
  description: string
  grantable: boolean
  /** Roles holding it by default, per scope it exists in. A scope that is absent does not apply. */
  defaults: {
    platform?: true
    tenant?: readonly TenantMembershipRole[]
    project?: readonly AccessRole[]
  }
  /**
   * Another permission that must be held (or granted in the same extras) for
   * this one to be granted as an extra — e.g. updating contact requests
   * without being able to read them makes no sense.
   */
  requires?: string
}

export const PLATFORM_PERMISSIONS: readonly PlatformPermissionDef[] = [
  // ── Platform (Super Admin only) ─────────────────────────────────────────
  {
    id: 'tenants.manage',
    description: 'Create clients and their first Owner; manage any client account.',
    grantable: false,
    defaults: { platform: true },
  },
  {
    id: 'support.access',
    description: 'Open a client dashboard in support mode (ADR-028 §8).',
    grantable: false,
    defaults: { platform: true },
  },
  {
    // ADR-031 D8.2 — register, approve and suspend partner apps (TableRes …).
    id: 'partners.manage',
    description: 'Register, approve and suspend partner apps that can request a Connection.',
    grantable: false,
    defaults: { platform: true },
  },

  // ── People ──────────────────────────────────────────────────────────────
  {
    id: 'users.invite',
    description: 'Invite people at or below your own level.',
    grantable: false,
    defaults: { tenant: ['owner'], project: ['owner', 'admin'] },
  },
  {
    id: 'users.manage',
    description: 'Change or remove people at or below your own level.',
    grantable: false,
    defaults: { tenant: ['owner'], project: ['owner', 'admin'] },
  },

  // ── Money (tenant only) ─────────────────────────────────────────────────
  {
    id: 'billing.invoice.read',
    description: 'See the client’s invoices.',
    grantable: true,
    defaults: { tenant: ['owner'] },
  },
  {
    id: 'billing.manage',
    description: 'Change plan and payment details.',
    grantable: false,
    defaults: { tenant: ['owner'] },
  },

  // ── Project administration ──────────────────────────────────────────────
  {
    id: 'settings.manage',
    description: 'Change the site settings exposed in the client dashboard.',
    grantable: false,
    defaults: { project: ['owner', 'admin'] },
  },
  {
    // ADR-031 D2 — connect, pause and revoke partner apps (Connections) for a
    // site. Not grantable: a Connection shares the site's data with a third
    // party, so only the people who run the site may decide it.
    id: 'connections.manage',
    description: 'Connect, pause and revoke partner apps that receive this site’s data.',
    grantable: false,
    // Project scope only: a Connection is per site. A tenant Owner is Owner of
    // every project of the tenant, so holds it everywhere.
    defaults: { project: ['owner', 'admin'] },
  },
  {
    // Settings page (Tom, 2026-10-18): facts the client owns about their own
    // business (Amazon tracking IDs, affiliate disclosure, later contact and
    // legal details). Deliberately NOT `settings.manage`, which is a
    // configuration permission the surface boundary test refuses.
    id: 'site.details.read',
    description: 'See the Settings page (the client’s own business details).',
    grantable: false,
    defaults: { project: ['owner', 'admin', 'editor'] },
  },
  {
    id: 'site.details.write',
    description: 'Change the business details on the Settings page.',
    grantable: false,
    defaults: { project: ['owner', 'admin'] },
    requires: 'site.details.read',
  },
  {
    id: 'modules.manage',
    description: 'Add modules to a site.',
    grantable: false,
    // Owner only: adding a module can have commercial consequences.
    defaults: { project: ['owner'] },
  },
  {
    // Formerly the role function `canManageMedia` (owner, editor — never viewer).
    id: 'media.library.manage',
    description: 'Upload, tag and delete Media Library images.',
    grantable: false,
    defaults: { project: ['owner', 'admin', 'editor'] },
  },

  // ── Support tickets (ADR-039, Tom 2026-10-22) ───────────────────────────
  {
    // Not a module: every site can send support requests. Viewers cannot.
    id: 'support.tickets.write',
    description: 'Send support requests and reply on the ones you can see.',
    grantable: false,
    defaults: { project: ['owner', 'admin', 'editor'] },
  },
  {
    // Without it a person sees only the requests they sent themselves.
    id: 'support.tickets.read',
    description: 'See all of the site’s support requests, not only your own.',
    grantable: true,
    defaults: { project: ['owner', 'admin'] },
  },
  {
    id: 'support.tickets.manage',
    description: 'Answer, triage and resolve every client’s support requests.',
    grantable: false,
    defaults: { platform: true },
  },

  // ── Website analytics (ADR-029 §3.4, Tom 2026-10-07) ────────────────────
  {
    // Not a module: the numbers come from the site's Google Analytics /
    // Search Console snapshots (migration 036). Editors only as an extra.
    id: 'analytics.read',
    description: 'See website traffic and search performance.',
    grantable: true,
    defaults: { project: ['owner', 'admin'] },
  },
]

/**
 * Module permissions that may be given as extras. Kept here — the single
 * place that decides what a person can be given on top of a role — rather
 * than in each manifest. A test asserts every id listed exists in
 * MODULE_PERMISSION_MAP.
 */
export const GRANTABLE_MODULE_PERMISSIONS: Readonly<Record<string, { requires?: string }>> = {
  'forms.submission.read': {},
  'forms.submission.update': { requires: 'forms.submission.read' },
  // ADR-040 — an Owner or Site admin may let an Editor see / manage Access.
  // Honoured only while the Access module is enabled (resolve.ts step 3).
  'members.access.read': {},
  'members.access.manage': { requires: 'members.access.read' },
  // ADR-040 §15 — documents (never groups or passwords). Honoured only while
  // the Documents module is enabled.
  'documents.document.read': {},
  'documents.document.manage': { requires: 'documents.document.read' },
}

const BY_ID = new Map(PLATFORM_PERMISSIONS.map((p) => [p.id, p]))

export function platformPermission(id: string): PlatformPermissionDef | undefined {
  return BY_ID.get(id)
}

export function scopesOfPlatformPermission(def: PlatformPermissionDef): PermissionScope[] {
  const scopes: PermissionScope[] = []
  if (def.defaults.platform) scopes.push('platform')
  if (def.defaults.tenant) scopes.push('tenant')
  if (def.defaults.project) scopes.push('project')
  return scopes
}

/**
 * Every permission that may be given as an extra on a PROJECT, in display
 * order: the grantable module permissions, then the grantable platform
 * permissions that exist at project level (e.g. `analytics.read`).
 */
export function projectGrantableIds(): string[] {
  return [
    ...Object.keys(GRANTABLE_MODULE_PERMISSIONS),
    ...PLATFORM_PERMISSIONS.filter((p) => p.grantable && p.defaults.project).map((p) => p.id),
  ]
}

/** May `id` be given as an extra that applies on a PROJECT (from a project or a tenant membership)? */
export function isProjectGrantable(id: string): boolean {
  if (id in GRANTABLE_MODULE_PERMISSIONS) return true
  const def = BY_ID.get(id)
  return Boolean(def && def.grantable && def.defaults.project)
}

/**
 * Message key for a grantable permission's label. Message keys cannot contain
 * dots (next-intl nests on them), so `forms.submission.read` → `formsSubmissionRead`.
 */
export function permissionMessageKey(id: string): string {
  return id.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase())
}
