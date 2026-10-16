import { getTenantAuthorizationContext, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

/**
 * The one way a client-dashboard server action resolves "who is calling, and
 * what may they do on THIS project" (performance work 2026-10-16, fix 2).
 *
 * - Resolves identity and memberships fresh from the database on every call
 *   (ADR-015 R1), with the default `mutation` purpose — so a view-only support
 *   visit still has its write permissions stripped (ADR-028 §8).
 * - Scoped to the one project the action touches: enabled modules and the
 *   shared-slug guard run for that project only, so the cost does not grow
 *   with the number of unrelated projects the caller can reach.
 * - The project is selected by `resolveProjectGrant` (ambiguity fails closed),
 *   exactly as before; a project the caller cannot reach is `forbidden`.
 *
 * `ctx.projects` holds at most the requested project's grant: an action that
 * needs the caller's OTHER projects must call `getTenantAuthorizationContext()`
 * itself. `ctx.tenants` (client-level grants) is complete.
 *
 * The support-mode guard test (src/lib/support/__tests__/client-actions-guard)
 * accepts a call to this helper as reaching the resolver.
 */
export type ProjectActionAccess =
  | { ok: true; ctx: TenantAuthorizationContext; grant: ProjectGrant }
  | { ok: false; error: 'unauthenticated' | 'forbidden' }

export async function resolveProjectAction(projectSlug: unknown): Promise<ProjectActionAccess> {
  if (typeof projectSlug !== 'string' || projectSlug.length === 0) return { ok: false, error: 'forbidden' }
  const ctx = await getTenantAuthorizationContext({ project: projectSlug })
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }
  return { ok: true, ctx, grant }
}
