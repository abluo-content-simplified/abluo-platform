/**
 * Shared server-side auth/guard helpers for API route handlers.
 *
 * `src/proxy.ts` cannot protect `/api/*` routes — its matcher excludes them
 * (`matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']`) — so any
 * route handler that mutates data must perform its own session check. This
 * module reuses the same Supabase session-verification pattern proxy.ts uses
 * for the `admin.abluo.app` host and the `/admin`/`/client` protected-path
 * guard: `supabase.auth.getUser()` via the server client, which validates the
 * token against the Supabase Auth server (not just decoding the cookie).
 */
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  adminGateDecision,
  readAssuranceLevel,
  type AdminGateDecision,
} from '@/lib/auth/admin-assurance'

/**
 * Returns the authenticated Supabase user for the current request, or `null`
 * if there is no valid session. Route handlers must return 401 immediately
 * when this returns `null` — before performing any mutation.
 */
export async function requireAuthenticatedUser(): Promise<User | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * The two platform-level identities (ADR-015 decision 1/2). `abluo_admin` is a
 * distinct, narrowly-granted operator identity; `tenant_user` is every
 * authenticated non-admin. This is NOT a tenant-scoped role — per-tenant roles
 * and permissions live in `tenant_members` and are resolved per-request
 * (ADR-015 R1), never here and never in the JWT.
 */
export type PlatformRole = 'abluo_admin' | 'tenant_user'

/**
 * The single central actor shape (ADR-015 decision 4, "structural model").
 * Every route that needs to know who the requester is resolves this via one
 * helper — no route interprets JWT claims independently. Carries only what
 * ADR-015 R1 permits in-token: identity + `platformRole`. Memberships and
 * permissions are deliberately absent.
 */
export interface AuthenticatedActor {
  userId: string
  platformRole: PlatformRole
}

/**
 * Pure, I/O-free mapping from a Supabase `app_metadata` bag to a
 * `PlatformRole`. Fail-safe by construction: returns `'abluo_admin'` ONLY on
 * an exact `'abluo_admin'` string match; every other input — `undefined`,
 * `null`, a missing key, a non-string value, or any other string — resolves to
 * `'tenant_user'`. This mirrors the `coalesce(..., 'tenant_user')` default in
 * the `custom_access_token_hook` (migration 006): absent or unexpected means
 * "not an admin", never a fail-open.
 */
export function resolvePlatformRole(
  appMetadata: Record<string, unknown> | null | undefined
): PlatformRole {
  return appMetadata?.platform_role === 'abluo_admin'
    ? 'abluo_admin'
    : 'tenant_user'
}

/**
 * Pure mapping from a validated Supabase `User` to an `AuthenticatedActor`.
 * Reads `platform_role` from `user.app_metadata` — the server-controlled,
 * unspoofable bag (migration 006 header; app_metadata is not user-editable) —
 * through the fail-safe `resolvePlatformRole`.
 */
export function toAuthenticatedActor(user: User): AuthenticatedActor {
  return {
    userId: user.id,
    platformRole: resolvePlatformRole(user.app_metadata),
  }
}

/**
 * Resolves the central `AuthenticatedActor` for the current request, or `null`
 * if there is no valid session. This is the one auth helper ADR-015 mandates:
 * every route that needs the requester's identity + platform role calls this,
 * closing the "different code paths read the same claim inconsistently" failure
 * the ADR's pivotal finding describes.
 *
 * Uses the same `createClient()` + `getUser()` path as
 * `requireAuthenticatedUser()` — `getUser()` validates the token against the
 * Supabase Auth server, so the returned `app_metadata.platform_role` is fresh
 * and reflects an immediate promotion/demotion, rather than trusting a claim
 * baked into an already-issued JWT (see the design note in the handoff).
 */
export async function getAuthenticatedActor(): Promise<AuthenticatedActor | null> {
  const user = await requireAuthenticatedUser()
  return user ? toAuthenticatedActor(user) : null
}

/**
 * The admin gate's full decision for the current request — identity, role
 * AND two-factor. `decision` is `'allow'` only for an `abluo_admin` whose
 * session is at AAL2 (password + TOTP in this session); see
 * `src/lib/auth/admin-assurance.ts`. `actor` is present whenever there is a
 * valid session, so callers can still log who was refused.
 *
 * `getUser()` runs BEFORE the AAL read on the same client — that ordering is
 * what makes the decoded `aal` claim server-validated (admin-assurance.ts).
 */
export async function resolveAdminAccess(): Promise<{
  decision: AdminGateDecision
  actor: AuthenticatedActor | null
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { decision: 'login', actor: null }

  const actor = toAuthenticatedActor(user)
  // Only an admin pays for the AAL read; tenant users never reach it.
  const currentLevel =
    actor.platformRole === 'abluo_admin' ? await readAssuranceLevel(supabase) : null
  return {
    decision: adminGateDecision({ hasUser: true, platformRole: actor.platformRole, currentLevel }),
    actor,
  }
}

/**
 * Guard for Abluo-admin-only surfaces (ADR-015 R6) — every admin API route
 * calls this. Returns the actor only when `platformRole === 'abluo_admin'`
 * AND the session is two-factor (AAL2); otherwise `null`. Fail-safe: an
 * unauthenticated request, an authenticated tenant user and a password-only
 * (aal1) admin are all treated identically (`null` → the route's 403), so
 * callers cannot accidentally distinguish them into an allow path.
 */
export async function requireAbluoAdmin(): Promise<AuthenticatedActor | null> {
  const { decision, actor } = await resolveAdminAccess()
  return decision === 'allow' ? actor : null
}
