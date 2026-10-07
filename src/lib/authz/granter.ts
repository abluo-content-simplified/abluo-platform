/**
 * Builds the `Granter` for the no-escalation rules from a resolved
 * authorization context — the one place that turns a grant's role into the
 * granter's standing, so routes never compare role names themselves.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { Granter } from './grant-rules'

/** The caller's standing on one project, or null when they hold no grant there. */
export function granterForProject(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { adminAssured?: boolean } = {}
): Granter | null {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) return null
  return {
    // The Super Admin bypass in checkGrant applies only after requireAbluoAdmin() (2FA) on this request.
    platformRole: opts.adminAssured && ctx.platformRole === 'abluo_admin' ? 'abluo_admin' : 'tenant_user',
    // A tenant Owner reaches every project of the tenant with role 'owner'
    // (ADR-017 Decision 2); any other grant says nothing about the tenant.
    tenantRole: grant.role === 'owner' ? 'owner' : null,
    projectRole: grant.role,
    permissions: grant.permissions,
  }
}

/**
 * The caller's standing on a client (tenant) itself. `adminAssured` must be
 * true only when the caller passed `requireAbluoAdmin()` (Super Admin with a
 * 2FA session) on this request; otherwise the platform flag is ignored here.
 */
export function granterForTenant(
  ctx: Pick<TenantAuthorizationContext, 'platformRole' | 'tenants'>,
  tenantId: string,
  opts: { adminAssured?: boolean } = {}
): Granter | null {
  const grant = ctx.tenants?.find((t) => t.tenantId === tenantId)
  const platformRole = opts.adminAssured && ctx.platformRole === 'abluo_admin' ? 'abluo_admin' : 'tenant_user'
  if (!grant && platformRole !== 'abluo_admin') return null
  return {
    platformRole,
    tenantRole: grant?.role ?? null,
    permissions: grant?.permissions ?? [],
  }
}
