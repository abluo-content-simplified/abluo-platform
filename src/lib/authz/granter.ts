/**
 * Builds the `Granter` for the no-escalation rules from a resolved
 * authorization context — the one place that turns a grant's role into the
 * granter's standing, so routes never compare role names themselves.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { Granter } from './grant-rules'

/** The caller's standing on one project, or null when they hold no grant there. */
export function granterForProject(ctx: TenantAuthorizationContext, projectId: string): Granter | null {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) return null
  return {
    platformRole: ctx.platformRole,
    // A tenant Owner reaches every project of the tenant with role 'owner'
    // (ADR-017 Decision 2); any other grant says nothing about the tenant.
    tenantRole: grant.role === 'owner' ? 'owner' : null,
    projectRole: grant.role,
    permissions: grant.permissions,
  }
}
