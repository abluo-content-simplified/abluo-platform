/**
 * Pure, dependency-free path predicates for the client-dashboard-surface gate
 * (ADR-017 slice 6 / ADR-015 close-out).
 *
 * Sibling to `admin-surface.ts`. Where `isAdminSurface` allowlists the
 * Abluo-admin-only dashboard segments, `isClientSurface` allowlists the tenant
 * CLIENT dashboard segments — the route-group folders under
 * `src/app/[locale]/(client)/`. The two allowlists are disjoint, so a path is
 * never both an admin surface and a client surface.
 *
 * These functions carry no I/O and no Next/Supabase imports, so they can be
 * unit-tested in isolation (the proxy module itself pulls in
 * `next-intl/middleware`, which does not resolve under the vitest node
 * environment). The gate's I/O half (cookies, `getUser()`, redirects) stays in
 * `proxy.ts`.
 */
import { stripLocale } from './admin-surface'

/**
 * Tenant client-dashboard surfaces. The first path segment (after any locale
 * prefix) identifies the surface. These are the route-group folders under
 * `src/app/[locale]/(client)/`. Kept in lockstep with that directory — a new
 * client route must be added here to be gated.
 */
export const CLIENT_SURFACE_SEGMENTS = new Set([
  'account',
  'posts',
  'leads',
  'analytics',
])

/**
 * True when `pathname` addresses a client dashboard surface. Pure: locale is
 * stripped first, then the leading segment is matched against the allowlist.
 * `/login`, `/unauthorized`, admin surfaces, and tenant paths are NOT client
 * surfaces.
 */
export function isClientSurface(pathname: string): boolean {
  const p = stripLocale(pathname)
  const seg = p.split('/').filter(Boolean)[0] ?? ''
  return CLIENT_SURFACE_SEGMENTS.has(seg)
}
