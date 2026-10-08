/**
 * Where a user lands after signing in — the pure half of `GET /auth/continue`.
 *
 * ── Why this is decided on the SERVER ──────────────────────────────────────
 * The login page used to decide the landing itself: sign in with the browser
 * client, then `fetch('/api/auth/me')` from the same page to learn the role,
 * then `router.push()`. Three problems, all seen on preview v1.0.42:
 *   1. The role answer came from a second, client-initiated request that races
 *      the browser client's own session bookkeeping, and its failure mode was
 *      "assume tenant user" — so an admin who got `{ platformRole: null }` was
 *      sent to the tenant page.
 *   2. That tenant page was the bare `/account`, which has no route (the client
 *      dashboard lives under `[locale]`), so the fallback itself 404'd.
 *   3. `router.push()` across two root layouts (`(platform)` → `[locale]`) is a
 *      soft navigation that Next has to turn into a hard one anyway.
 *
 * Now the login page does ONE full-page navigation to `/auth/continue`, the
 * document request carries the cookies the browser client just wrote, and this
 * function — fed by `getUser()` + the AAL read in the route — makes the call.
 *
 * No I/O, no Next or Supabase imports: the route, the proxy and the tests all
 * share it.
 */
import type { PlatformRole } from '@/lib/api/auth'
import { negotiateLocale } from '@/lib/i18n/negotiate-locale'
import { normalizeAssuranceLevel, type AssuranceLevel } from './admin-assurance'
import { isAdminSurface, isStudio, isPreAuthSurface } from '@/lib/proxy/admin-surface'

/** The route that makes the post-login decision. Locale-free on purpose. */
export const CONTINUE_PATH = '/auth/continue'

export interface PlatformLocaleConfig {
  /** `routing.locales` — the platform's UI locales. */
  locales: readonly string[]
  /** `routing.defaultLocale`. */
  defaultLocale: string
}

/**
 * The first path segment when it is one of the platform locales, else null.
 * `/it/account` → `it`; `/account`, `/fr/x` (fr not a platform locale) → null.
 */
export function localeOfPath(path: string, locales: readonly string[]): string | null {
  const first = path.split(/[?#]/)[0].split('/').filter(Boolean)[0]
  return first && locales.includes(first) ? first : null
}

/**
 * The locale for a platform (non-tenant-site) page when the URL does not say:
 * the visitor's earlier choice (NEXT_LOCALE), else their browser's languages
 * in preference order, else the platform default — negotiated against the
 * platform's own locales, never a hardcoded one.
 */
export function platformLocale(
  input: { cookieLocale?: string | null; acceptLanguage?: string | null },
  config: PlatformLocaleConfig
): string {
  return negotiateLocale({
    cookieLocale: input.cookieLocale,
    acceptLanguage: input.acceptLanguage,
    supportedLocales: config.locales,
    defaultLocale: config.defaultLocale,
  })
}

/**
 * A `next` we are willing to follow after sign-in, or null.
 * Same-origin relative only (no `//host`, no `/\host`, no scheme), no control
 * characters, and never a pre-auth page (`/login`, `/mfa`, `/auth/*` …) —
 * following those would loop straight back into the sign-in flow.
 */
export function acceptableNext(next: string | null | undefined, depth = 0): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null
  const pathOnly = next.split(/[?#]/)[0]
  // `/mfa?next=X` (the MFA page sends a signed-out visitor to
  // `/login?next=/mfa?next=X`): the real target is X — the continue route
  // re-derives whether MFA is still needed.
  if (pathOnly === '/mfa' && depth === 0) {
    const inner = new URLSearchParams(next.slice(pathOnly.length).split('#')[0]).get('next')
    return acceptableNext(inner, depth + 1)
  }
  if (isPreAuthSurface(pathOnly) || pathOnly === CONTINUE_PATH || pathOnly.startsWith(`${CONTINUE_PATH}/`)) {
    return null
  }
  return next
}

/** An admin-only destination: an admin surface or Sanity Studio. */
function isAdminDestination(path: string): boolean {
  const pathOnly = path.split(/[?#]/)[0]
  return isAdminSurface(pathOnly) || isStudio(pathOnly)
}

export interface PostLoginInput extends PlatformLocaleConfig {
  hasUser: boolean
  platformRole: PlatformRole | null
  /** The session's AAL, read only for an admin (null otherwise). */
  currentLevel: AssuranceLevel | string | null | undefined
  /** The raw `?next=` the login page was given, if any. */
  next: string | null | undefined
  cookieLocale?: string | null
  acceptLanguage?: string | null
}

/**
 * The path to redirect to after sign-in.
 *
 *   no session                    → /login (carrying a safe `next`)
 *   abluo_admin, not AAL2         → /mfa?next=<destination>
 *   abluo_admin, AAL2             → <destination>
 *   tenant_user                   → <destination>, unless it is admin-only
 *
 * <destination> is a safe explicit `next`, else the role's home:
 * `/<locale>/dashboard` for an admin, `/<locale>/sites` for a tenant user (one site →
 * straight to it; several → the "Your websites" overview — Tom, 2026-10-08).
 * <locale> comes from the `next` path when it names one, else NEXT_LOCALE /
 * Accept-Language against the platform locales, else the platform default.
 */
export function postLoginDestination(input: PostLoginInput): string {
  const next = acceptableNext(input.next)

  if (!input.hasUser) {
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login'
  }

  const locale =
    (next && localeOfPath(next, input.locales)) ??
    platformLocale(
      { cookieLocale: input.cookieLocale, acceptLanguage: input.acceptLanguage },
      input
    )

  if (input.platformRole === 'abluo_admin') {
    const destination = next ?? `/${locale}/dashboard`
    return normalizeAssuranceLevel(input.currentLevel) === 'aal2'
      ? destination
      : `/mfa?next=${encodeURIComponent(destination)}`
  }

  // tenant_user (and any non-admin): an admin-only `next` would only bounce
  // off the admin gate to /unauthorized — send them to their own home.
  if (next && !isAdminDestination(next)) return next
  return `/${locale}/sites`
}
