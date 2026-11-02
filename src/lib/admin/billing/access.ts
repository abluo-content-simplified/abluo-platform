/**
 * Billing administration access — ADR-041 D9 (amended 2026-11-02).
 *
 * Every Abluo admin may VIEW billing (`requireAbluoAdmin()`). Only accounts
 * that also hold the platform permission `billing.admin` may CHANGE billing:
 * terms, overrides, cancellations, payment arrangements, issuer and client
 * billing details. At first only Tom's account holds it.
 *
 * The permission travels like `platform_role`: in the user's `app_metadata`
 * (`platform_permissions: ['billing.admin']`), which only the service role can
 * write — a client can never grant it to itself. It is read from the user the
 * Auth server returns for THIS request (`getUser()`), never from a cached JWT.
 *
 * Enforced in every billing server action by calling `requireBillingAdmin()`
 * first. Hiding controls in the UI is a convenience, not the check.
 */
import { createClient } from '@/lib/supabase/server'
import { adminGateDecision, readAssuranceLevel } from '@/lib/auth/admin-assurance'
import { toAuthenticatedActor, type AuthenticatedActor } from '@/lib/api/auth'

export const BILLING_ADMIN_PERMISSION = 'billing.admin'

/** Does this user's app_metadata grant a platform permission? Pure. Fails closed. */
export function hasPlatformPermission(appMetadata: Record<string, unknown> | null | undefined, permission: string): boolean {
  if (appMetadata?.platform_role !== 'abluo_admin') return false
  const granted = appMetadata.platform_permissions
  return Array.isArray(granted) && granted.some((p) => p === permission)
}

/**
 * The signed-in Abluo admin (two-factor assured, exactly as `requireAbluoAdmin`)
 * who ALSO holds `billing.admin`; otherwise null. Call it first in every
 * billing mutation, before any I/O.
 */
export async function requireBillingAdmin(): Promise<AuthenticatedActor | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const actor = toAuthenticatedActor(user)
  if (actor.platformRole !== 'abluo_admin') return null
  const decision = adminGateDecision({ hasUser: true, platformRole: actor.platformRole, currentLevel: await readAssuranceLevel(supabase) })
  if (decision !== 'allow') return null
  return hasPlatformPermission(user.app_metadata, BILLING_ADMIN_PERMISSION) ? actor : null
}
