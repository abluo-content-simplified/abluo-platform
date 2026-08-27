/**
 * Pure, dependency-free path predicates for the admin-surface gate (ADR-015 R6).
 *
 * Extracted from `src/proxy.ts` so they can be unit-tested in isolation: the
 * proxy module pulls in `next-intl/middleware` (and, transitively, the Supabase
 * server client + `next/headers`), which does not resolve cleanly under the
 * vitest node environment. These functions carry no such dependencies.
 *
 * The gate's I/O half (cookies, `getUser()`, redirects) stays in `proxy.ts` and
 * is exercised by the localhost verification plan, not by mocked unit tests.
 */

/** Strip a leading locale prefix (e.g. /en/dashboard → /dashboard) before matching. */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/, '/')
}

/**
 * Abluo-admin-only dashboard surfaces (ADR-015 R6). The first path segment
 * (after any locale prefix) identifies the surface. These are the route-group
 * folders under `src/app/[locale]/(admin)/`.
 */
export const ADMIN_SURFACE_SEGMENTS = new Set([
  'dashboard',
  'clients',
  'content',
  'media',
  'projects',
  'settings',
])

/**
 * True when `pathname` addresses an admin dashboard surface. Pure: locale is
 * stripped first, then the leading segment is matched against the allowlist.
 * `/unauthorized`, `/login`, and tenant paths are NOT admin surfaces.
 */
export function isAdminSurface(pathname: string): boolean {
  const p = stripLocale(pathname)
  const seg = p.split('/').filter(Boolean)[0] ?? ''
  return ADMIN_SURFACE_SEGMENTS.has(seg)
}

/** True for the Sanity Studio route (`/studio` and everything beneath it). */
export function isStudio(pathname: string): boolean {
  return pathname === '/studio' || pathname.startsWith('/studio/')
}

/**
 * Surfaces reachable without a session.
 *
 * These sit outside `[locale]`, so intlMiddleware must not rewrite them to add
 * a locale prefix — there is no `[locale]/login` or `[locale]/reset-password`
 * route, so the rewrite would 404. They also skip the admin gate, because each
 * is where a user goes precisely when they cannot authenticate: signing in,
 * accepting an invite, or recovering a forgotten password.
 *
 * Adding a pre-auth page and forgetting to list it here produces a 404 that
 * reads like a broken route rather than a middleware list nobody updated, which
 * is why this is a named, tested predicate rather than an inline condition.
 */
const PRE_AUTH_SURFACES = [
  '/login',
  '/unauthorized',
  '/auth/callback',
  '/invite/accept',
  '/forgot-password',
  '/reset-password',
] as const

export function isPreAuthSurface(pathname: string): boolean {
  return PRE_AUTH_SURFACES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
