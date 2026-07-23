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
