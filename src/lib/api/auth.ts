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
 * Convenience guard for Abluo-admin-only surfaces (slice 3 will gate `/studio`
 * and the admin dashboard on this — ADR-015 R6). Returns the actor only when
 * `platformRole === 'abluo_admin'`, otherwise `null`. Fail-safe: an
 * unauthenticated request and an authenticated tenant user are treated
 * identically (both `null`), so callers cannot accidentally distinguish
 * "logged in but not admin" from "not logged in" into an allow path.
 */
export async function requireAbluoAdmin(): Promise<AuthenticatedActor | null> {
  const actor = await getAuthenticatedActor()
  return actor?.platformRole === 'abluo_admin' ? actor : null
}

/**
 * Bounds the blast radius of id-addressed mutation routes (e.g.
 * `/api/media/[id]`) to a single expected Sanity `_type`. Even an
 * authenticated caller must only be able to mutate documents of the type the
 * route is meant to manage — never an arbitrary document by id.
 */
export function isExpectedDocType(
  actualType: string | null | undefined,
  expectedType: string
): boolean {
  return actualType === expectedType
}
