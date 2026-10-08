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
 * folders under `src/app/[locale]/(admin)/` — the admin nav (ADR-030) — and
 * `__tests__/admin-surface.test.ts` reads that directory to keep the two in
 * lockstep, because an admin page missing here is an ungated service-role page.
 */
export const ADMIN_SURFACE_SEGMENTS = new Set([
  'dashboard',
  'projects',
  'analytics',
  'media',
  'backlog',
  'whats-new',
])

/**
 * Admin pages that no longer exist (ADR-030 removed the empty `clients`,
 * `content` and `settings` placeholders). They stay GATED exactly like a live
 * admin surface — retiring a page must not hand its path to tenant content or
 * the i18n fallthrough — and an admin who passes the gate is sent to Home
 * (`retiredAdminRedirect`), so an old bookmark lands somewhere useful.
 */
export const RETIRED_ADMIN_SEGMENTS = new Set(['clients', 'content', 'settings'])

function leadingSegment(pathname: string): string {
  return stripLocale(pathname).split('/').filter(Boolean)[0] ?? ''
}

/**
 * True when `pathname` addresses an admin dashboard surface (live or retired).
 * Pure: locale is stripped first, then the leading segment is matched against
 * the allowlists. `/unauthorized`, `/login`, and tenant paths are NOT admin
 * surfaces.
 */
export function isAdminSurface(pathname: string): boolean {
  const seg = leadingSegment(pathname)
  return ADMIN_SURFACE_SEGMENTS.has(seg) || RETIRED_ADMIN_SEGMENTS.has(seg)
}

/**
 * Where a retired admin path goes once the admin gate has let the request
 * through: admin Home, keeping the locale prefix when there was one
 * (`/it/clients/x` → `/it/dashboard`, `/settings` → `/dashboard`). Null for
 * every other path. Pure — the caller decides that the gate passed.
 */
export function retiredAdminRedirect(pathname: string): string | null {
  if (!RETIRED_ADMIN_SEGMENTS.has(leadingSegment(pathname))) return null
  const prefix = pathname.match(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/|$)/)?.[0] ?? ''
  return `${prefix}/dashboard`
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
  // Post-sign-in landing decision (src/app/(platform)/auth/continue). It reads
  // the session itself and redirects — no session → /login — so it must not be
  // gated, and it has no `[locale]` twin for the i18n middleware to prefix.
  '/auth/continue',
  '/invite/accept',
  '/forgot-password',
  '/reset-password',
  // Two-factor enrollment / challenge for Abluo admins. Reachable with an
  // aal1 session by construction — it is where the admin gate SENDS an aal1
  // admin — and it does its own session check (no session → /login).
  '/mfa',
] as const

export function isPreAuthSurface(pathname: string): boolean {
  return PRE_AUTH_SURFACES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
