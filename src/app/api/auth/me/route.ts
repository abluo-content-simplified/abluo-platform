import { NextResponse } from 'next/server'
import { getAuthenticatedActor } from '@/lib/api/auth'

/**
 * GET /api/auth/me — resolves the caller's `PlatformRole` for post-sign-in
 * redirect routing (ADR-017 slice 4, login-role-routing leg).
 *
 * Exists so `src/app/login/page.tsx` (a client component) never needs to
 * import `@/lib/api/auth` directly — that module pulls in
 * `@/lib/supabase/server`, which imports `next/headers` and is therefore
 * server-only. Routing the role lookup through this route keeps
 * `resolvePlatformRole` / `getAuthenticatedActor` the single source of truth
 * for platform-role resolution (ADR-015 R1/decision 4) instead of
 * duplicating the mapping logic client-side.
 *
 * NOTE: the login page no longer uses this for its landing decision — that is
 * made server-side by `GET /auth/continue` (src/lib/auth/post-login.ts), from
 * the cookies a full-page navigation carries. Kept as a read-only role hint.
 *
 * Returns `{ platformRole: null }` (200, not 401) for an unauthenticated
 * caller — this endpoint is a routing hint, not an authorization boundary,
 * so callers should treat a null role the same as "not signed in" rather
 * than branch on status codes.
 */
export async function GET() {
  const actor = await getAuthenticatedActor()
  return NextResponse.json({ platformRole: actor?.platformRole ?? null })
}
