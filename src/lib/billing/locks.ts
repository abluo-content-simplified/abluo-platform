/**
 * Billing locks on the authorization context — ADR-041 D8.
 *
 * PURE. Meant to run as the LAST step of `TenantAuthorizationContext`
 * assembly (after tenant-owner precedence and synthetic member grants), so
 * every project grant — however it was derived — passes through it.
 *
 * Not wired into the application yet (ADR-041 §4 step 5, behind
 * BILLING_ENFORCEMENT=off|observe|on).
 */
import { isWritePermission } from '@/lib/support/state'
import { isBillingLocked, type ProjectBillingStatus } from './lifecycle'

/**
 * Write permissions a locked project KEEPS (Tom, 2026-10-30):
 * contacting Abluo support, and handling received inquiries. Website form
 * configuration is NOT here: form definitions are Abluo-admin only and
 * notification recipients need `site.details.write`, which is removed.
 */
export const BILLING_LOCK_ALLOWED: ReadonlySet<string> = new Set([
  'support.tickets.write',
  'forms.submission.update',
  'forms.submission.delete',
])

export type BillingAwareGrant<G> = G & { billing?: ProjectBillingStatus }

/** The permissions a project keeps while locked: every read, plus the allowlist. */
export function lockedPermissions(permissions: readonly string[]): string[] {
  return permissions.filter((p) => !isWritePermission(p) || BILLING_LOCK_ALLOWED.has(p))
}

/**
 * Returns new grants; never mutates its input. A grant with no status in
 * `statuses` is returned unchanged (not billed, or state unknown → fail open).
 * A locked project keeps only reads + `BILLING_LOCK_ALLOWED`. Every grant that
 * has a status carries it as `billing`, for banners and countdowns.
 *
 * `supportVisit`: an Abluo admin in support mode is never billing-locked —
 * support's own rules apply; the status is still attached for the banner.
 */
export function applyBillingLocks<G extends { projectId: string; permissions: string[] }>(
  grants: readonly G[],
  statuses: ReadonlyMap<string, ProjectBillingStatus>,
  options: { supportVisit?: boolean } = {}
): BillingAwareGrant<G>[] {
  return grants.map((grant) => {
    const billing = statuses.get(grant.projectId)
    if (!billing) return grant
    const strip = !options.supportVisit && isBillingLocked(billing.state)
    return { ...grant, permissions: strip ? lockedPermissions(grant.permissions) : [...grant.permissions], billing }
  })
}

/**
 * The same, applied to a whole context. Tenant grants (people, billing,
 * ownership — ADR-041 D10) are returned untouched by construction.
 */
export function applyBillingLocksToContext<
  C extends { projects: ReadonlyArray<{ projectId: string; permissions: string[] }>; support?: unknown },
>(
  ctx: C,
  statuses: ReadonlyMap<string, ProjectBillingStatus>
): Omit<C, 'projects'> & { projects: BillingAwareGrant<C['projects'][number]>[] } {
  return { ...ctx, projects: applyBillingLocks<C['projects'][number]>(ctx.projects, statuses, { supportVisit: Boolean(ctx.support) }) }
}
