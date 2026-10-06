/**
 * Who may manage a project's Media Library from the client dashboard.
 *
 * The Media Library is not a module: it is gated by the platform role rule
 * `canManageMedia(role)` (owner, editor — never viewer) on a grant the caller
 * actually holds for this project. Module surfaces that ALSO touch media
 * (blog cover, galleries) keep their own module permission; callers pass the
 * one they need and this resolves either kind with the same "throw before
 * any I/O" contract as `assertModuleAction`.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { canManageMedia } from '@/lib/permissions'

/** Pseudo-permission: the Media Library itself (role-based, see module header). */
export const MEDIA_MANAGE_PERMISSION = 'media.library.manage'

/** True when this grant may use the Media screen (UI hint; the server re-checks). */
export function grantCanManageMedia(grant: Pick<ProjectGrant, 'role'>): boolean {
  return canManageMedia(grant.role)
}

/** The caller's grant for `projectId`, after checking `permission`. Throws TenantAuthorizationError. */
export function assertProjectAccess(ctx: TenantAuthorizationContext, projectId: string, permission: string): ProjectGrant {
  if (permission === MEDIA_MANAGE_PERMISSION) {
    const grant = ctx.projects.find((p) => p.projectId === projectId)
    if (!grant || !canManageMedia(grant.role)) {
      throw new TenantAuthorizationError(`Media Library access refused for project "${projectId}".`)
    }
    return grant
  }
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}
