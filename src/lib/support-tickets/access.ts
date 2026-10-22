/**
 * Who may do what with support tickets (ADR-039 D3, D15). Pure: takes the
 * request's authorization context, never reads anything. The service calls
 * this on every read and write; screens use it to decide what to show.
 *
 *   support.tickets.write  create + reply on tickets you can see (Owner, Site admin, Editor)
 *   support.tickets.read   see ALL the project's tickets (Owner, Site admin; grantable)
 *   without .read          only tickets you created
 *   support mode           never writes, whatever the client allowed (D15)
 */
import { can } from '@/lib/authz/check'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

export type TicketAccess = {
  userId: string
  projectId: string
  projectSlug: string
  role: string
  /** May send requests and reply. */
  canWrite: boolean
  /** Sees every ticket of the project (otherwise only their own). */
  canReadAll: boolean
  /** An Abluo admin in "View as client" — read-only (D15). */
  supportMode: boolean
}

export function ticketAccess(ctx: TenantAuthorizationContext | null | undefined, projectSlug: string): TicketAccess | null {
  if (!ctx) return null
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return null
  const scope = { kind: 'project' as const, projectId: grant.projectId }
  const supportMode = Boolean(ctx.support)
  return {
    userId: ctx.userId,
    projectId: grant.projectId,
    projectSlug: grant.projectSlug,
    role: grant.role,
    canWrite: !supportMode && can(ctx, 'support.tickets.write', scope),
    canReadAll: can(ctx, 'support.tickets.read', scope),
    supportMode,
  }
}

/** May this person see this ticket at all? Project first, then ownership. */
export function canSeeTicket(access: TicketAccess, ticket: { project_id: string; created_by: string | null }): boolean {
  if (ticket.project_id !== access.projectId) return false
  return access.canReadAll || (ticket.created_by !== null && ticket.created_by === access.userId)
}
