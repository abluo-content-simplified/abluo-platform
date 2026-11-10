/**
 * Who may read and reply in Messages (ADR-050 D2, D6). Pure. A client needs a
 * grant on the project in the URL; being a participant of a conversation is
 * checked by the service on every read and write — a project role never gives
 * access to someone else's messages. In support mode an Abluo admin sees the
 * client's dashboard, never the client's Messages (D6).
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

export type MessageAccess = {
  userId: string
  projectId: string
  projectSlug: string
  supportMode: boolean
}

export function messageAccess(ctx: TenantAuthorizationContext | null | undefined, projectSlug: string): MessageAccess | null {
  if (!ctx) return null
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return null
  return { userId: ctx.userId, projectId: grant.projectId, projectSlug: grant.projectSlug, supportMode: Boolean(ctx.support) }
}
