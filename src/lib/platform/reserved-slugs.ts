/**
 * Words a tenant slug (`client.tenantSlug`) or project slug
 * (`project.projectSlug`) may never be.
 *
 * A slug is matched as the first path segment on the platform hosts
 * (`dev.abluo.app/<slug>`, `preview.abluo.app/<slug>`, `/<locale>/<slug>`), the
 * same position as the admin pages (`/dashboard`, `/projects` …), the client
 * dashboard (`/sites`, `/account`), the platform pages (`/login`, `/studio` …)
 * and the API. A project called `analytics` would be shadowed by the admin
 * Analytics page — or worse, shadow it. Tenant-level segments (`/<slug>/posts`,
 * `/<slug>/blog` …) are reserved too: the proxy and a customer domain put the
 * page slug in that position, and a site called `posts` reads as nonsense in
 * every URL it appears in.
 *
 * `src/lib/platform/__tests__/reserved-slugs.test.ts` walks `src/app` and fails
 * when a new top-level or tenant-level static route segment is missing here.
 *
 * Kept deliberately as a plain array + one predicate (no Set export, no
 * derived values) so parallel edits merge as one-line additions.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // ── Platform (outside [locale]) ───────────────────────────────────────────
  '_next',
  '_vercel',
  'admin',
  'api',
  'app',
  'auth',
  'callback',
  'dev',
  'favicon.ico',
  'forgot-password',
  'invite',
  'llms.txt',
  'login',
  'logout',
  'mfa',
  'public',
  'reset-password',
  'robots.txt',
  'signup',
  'sitemap.xml',
  'static',
  'studio',
  'unauthorized',
  'www',

  // ── Interface locales (the optional /<locale> prefix) ─────────────────────
  'de',
  'en',
  'es',
  'fr',
  'it',
  'nl',
  'pt',

  // ── Admin dashboard (ADR-030) — live and retired segments ─────────────────
  'analytics',
  'backlog',
  'clients',
  'content',
  'dashboard',
  'media',
  'projects',
  'settings',
  'whats-new',

  // ── Client dashboard — top level ──────────────────────────────────────────
  'account',
  'sites',

  // ── Client dashboard — tenant level (/<tenant>/…) ─────────────────────────
  'galleries',
  'home',
  'people',
  'posts',
  'submissions',

  // ── Public website — tenant level (/<tenant>/…) ───────────────────────────
  'blog',
  'category',
  'events',
  'live',
  'news',
  'preview',
  // Well-known file stems and the admin wizard route (/projects/new)
  'sitemap',
  'robots',
  'llms',
  'favicon',
  'apple-touch-icon',
  'new',
]

/**
 * True when `slug` collides with a route segment. Case- and
 * whitespace-insensitive; a slug starting with `_` or `.` is always reserved
 * (framework and dot-file paths).
 */
export function isReservedSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase()
  if (s === '') return false
  if (s.startsWith('_') || s.startsWith('.')) return true
  return RESERVED_SLUGS.includes(s)
}
