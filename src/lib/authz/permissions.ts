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
