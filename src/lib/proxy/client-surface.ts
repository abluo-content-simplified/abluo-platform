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
 * User-level client-dashboard surfaces — NOT scoped to a single project. The
 * LEADING path segment (after any locale prefix) identifies the surface. These
 * are the static route-group folders directly under `src/app/[locale]/(client)/`
 * that list or act across all of a user's grants (currently just `account`).
 *
 * ADR-017 Phase 2 route restructure: the project-scoped pages (`posts`,
 * `leads`, `analytics`, `submissions`) moved OUT of this leading-segment set and UNDER the
 * `[tenant]` (projectSlug) dynamic segment — matched by
 * `CLIENT_PROJECT_SEGMENTS` at the SECOND position below.
 */
export const CLIENT_USER_SEGMENTS = new Set(['account'])

/**
 * Project-scoped client-dashboard sub-pages. In the ADR-017 Phase 2 shape these
 * live at `/{projectSlug}/{segment}` — i.e. the SECOND path segment (after any
 * locale prefix), because the first segment is the dynamic projectSlug. Kept in
 * lockstep with `src/app/[locale]/(client)/[tenant]/*` — a new project-scoped
 * client page must be added here to be gated. That lockstep is no longer a
 * promise in a comment: `__tests__/client-surface.test.ts` reads the directory
 * at test time and fails when the two disagree in either direction. (It had
 * already drifted once — `submissions` shipped without being listed here.)
 *
 * These names are deliberately disjoint from the public tenant sub-routes
 * (`blog`, `events`, `live`, and free-form page slugs under
 * `(website)/[tenant]`), so that on the platform host the gate cannot mistake a
 * public-style path for a client surface via a name clash.
 */
export const CLIENT_PROJECT_SEGMENTS = new Set([
  'posts',
  'leads',
  'analytics',
  'submissions',
])

/**
 * True when `pathname` addresses a client dashboard surface. Pure: the locale
 * prefix is stripped first, then:
 *   • the LEADING segment is matched against the user-level allowlist
 *     (`/account`, `/en/account`), OR
 *   • the SECOND segment is matched against the project-scoped allowlist
 *     (`/{projectSlug}/posts`, `/en/{projectSlug}/leads`, …).
 *
 * `/login`, `/unauthorized`, admin surfaces, the bare locale root, and public
 * tenant paths are NOT client surfaces. The proxy only ever consults this on a
 * `tenantId === null` host (no public tenant resolves there), so a public
 * tenant site can never reach this predicate.
 */
export function isClientSurface(pathname: string): boolean {
  const p = stripLocale(pathname)
  const segs = p.split('/').filter(Boolean)
  if (segs.length === 0) return false
  if (CLIENT_USER_SEGMENTS.has(segs[0])) return true
  if (segs.length >= 2 && CLIENT_PROJECT_SEGMENTS.has(segs[1])) return true
  return false
}
