/**
 * Support mode — builds the authorization context an Abluo admin acts under
 * while visiting ONE client project (ADR-028 §8). Pure: the I/O half
 * (cookie, admin + two-factor check, the session row, the project) lives in
 * `./server.ts`; `getTenantAuthorizationContext()` (src/lib/api/tenant-context.ts)
 * is the one place that calls both, so every client-dashboard page, layout,
 * server action and route handler gets support mode from the same resolver.
 *
 * The context:
 *   - holds exactly ONE project grant — the visited project — and no tenant
 *     grants: the admin's own memberships are not used while visiting, and no
 *     other project is reachable (the URL slug is still re-validated against
 *     this one grant by every page);
 *   - grants the perspective role's permissions (Owner / Site admin / Editor),
 *     filtered by `supportPermissions()` — writes only when the client allowed
 *     edit access and it has not expired, never people/money/modules, and
 *     contact requests only once shown;
 *   - keeps `userId` = the ADMIN's id, so anything written is attributed to
 *     the admin, never to a client user.
 */
import type { PlatformRole } from '@/lib/api/auth'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import type { SupabaseProjectSlug } from '@/lib/tenancy/ids'
import type { SupportRole } from './constants'
import { effectiveStatus, supportPermissions, supportWritesAllowed, type SupportPurpose, type SupportSession, type SupportStatus } from './state'

/** What the rest of the app may know about the support visit behind a context. */
export type SupportContextInfo = {
  sessionId: string
  projectId: string
  projectSlug: string
  projectName: string
  adminUserId: string
  role: SupportRole
  /** Effective edit-access state at resolution time. */
  status: SupportStatus
  writesAllowed: boolean
  expiresAt: string | null
  contactRequestsShown: boolean
  purpose: SupportPurpose
}

export function buildSupportAuthorizationContext(params: {
  actor: { userId: string; platformRole: PlatformRole }
  session: SupportSession
  project: { id: string; slug: SupabaseProjectSlug; name: string }
  enabledModuleIds: string[]
  purpose: SupportPurpose
  now?: number
}): TenantAuthorizationContext {
  const { actor, session, project, enabledModuleIds, purpose } = params
  const now = params.now ?? Date.now()
  const writesAllowed = supportWritesAllowed(session, now)
  const contactRequestsShown = Boolean(session.contactRequestsShownAt)
  const rolePermissions = resolveProjectPermissions({ role: session.role, enabledModuleIds }).permissions
  return {
    userId: actor.userId,
    platformRole: actor.platformRole,
    projects: [
      {
        projectId: project.id,
        projectSlug: project.slug,
        membershipId: `support:${session.id}`,
        role: session.role,
        permissions: supportPermissions({ rolePermissions, purpose, writesAllowed, contactRequestsShown }),
        enabledModuleIds,
      },
    ],
    tenants: [],
    support: {
      sessionId: session.id,
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.name,
      adminUserId: session.adminUserId,
      role: session.role,
      status: effectiveStatus(session, now),
      writesAllowed,
      expiresAt: session.expiresAt,
      contactRequestsShown,
      purpose,
    },
  }
}
