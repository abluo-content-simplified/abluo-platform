import { createServerClient } from '@supabase/ssr'
import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'
import { resolvePlatformRole } from '@/lib/api/auth'
import { isAdminSurface, isStudio, isPreAuthSurface } from '@/lib/proxy/admin-surface'
import { isClientSurface } from '@/lib/proxy/client-surface'
import {
  resolveScopeFromHost,
  defaultLocaleForProjectSegment,
  normalizeHost,
} from '@/lib/tenancy/host-scope'
import { unbrand } from '@/lib/tenancy/ids'

const intlMiddleware = createMiddleware(routing)

// ── How this middleware resolves a host (was `resolveTenant`) ───────────────
//
// Production domains:  studiomartegani.com               → "studiomartegani"
// Abluo preview URLs:  studiomartegani.preview.abluo.app → "studiomartegani"
// Dev convention:      studiomartegani.localhost:3000    → "studiomartegani"
// Platform/admin:      admin.abluo.app, bare localhost   → null
//
// ── This used to be three hand-typed maps ────────────────────────────────────
// `domainMap` (host → slug), `resolveSanityProjectSlug` (a dead second copy of
// TENANT_TO_PROJECT) and `resolveDefaultLocale` (slug → locale, with a comment
// asking a human to "keep in sync with the projects table in Supabase"). They
// drifted, exactly as `src/lib/tenancy/RENAME.md` predicted they would: each
// grew one line per onboarding until somebody forgot, and `amelie` was the
// onboarding somebody forgot. All three are gone. The table now comes from
// `src/lib/tenancy/generated/route-config.ts`, generated from Supabase.
//
// ── Two deliberate behaviour changes vs. the old maps ────────────────────────
//  1. NO SUBDOMAIN GUESSING. The old code returned whatever `<x>.localhost` or
//     `<x>.preview.abluo.app` said, for any `<x>`, and let the route 404 later.
//     An unknown subdomain now resolves to `null` and gets platform routes. A
//     guessed project slug at the edge is how one tenant's host gets made to
//     render another tenant's route; `host-scope.ts` divergence (C).
//  2. INACTIVE PROJECTS DO NOT SERVE. `t42.preview.abluo.app` resolved to
//     "t42" and then 404'd at the route boundary; it now resolves to null.
//     Same visible outcome, decided one layer earlier and on purpose.
//
// Host normalisation (port, case, trailing dot, `www.`, IPv6 literals) is
// `normalizeHost()` inside the resolver — it is stricter than the
// `split(':')[0].replace(/^www\./,'')` this function used to do inline.

/**
 * Local admin gate for the middleware boundary (ADR-015 R6). Builds a Supabase
 * server client from the request cookies — reusing the exact cookie-refresh
 * pattern the `admin.abluo.app` block uses — validates the session with
 * `getUser()`, and returns either the cookie-refreshed continue response (admin)
 * or a redirect. Fail-safe: no user → `/login`; authenticated non-admin →
 * `/unauthorized`. `resolvePlatformRole` is fail-closed by construction, so only
 * an exact `abluo_admin` platform role is allowed through.
 */
async function requireAdminInProxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // This response may be mutated by setAll() below to carry refreshed
  // session cookies back to the browser.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the token against the Supabase Auth server (not just
  // decoding the cookie) and silently refreshes an expired token via setAll.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (resolvePlatformRole(user.app_metadata) !== 'abluo_admin') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  // Admin — return the (possibly cookie-refreshed) continue response.
  return supabaseResponse
}

/**
 * Client-dashboard gate for the middleware boundary (ADR-017 slice 6 /
 * ADR-015 close-out). Sibling to `requireAdminInProxy`: reuses the exact
 * cookie-refresh + `getUser()` pattern, but requires only ANY authenticated
 * session — there is deliberately NO `abluo_admin` role check. The client
 * dashboard is the tenant client's surface, not an Abluo-admin surface.
 *
 * Fail-safe: no user → `/login?next=<path>`. An authenticated user is allowed
 * through regardless of platform role; the per-project authorization decision
 * (which projects, which role, which modules) is made downstream by
 * `getTenantAuthorizationContext()` at the route/data layer, never here. This
 * gate's single job is "is there a session at all" — it is a coarse
 * authentication boundary, not the fine-grained authorization boundary.
 */
async function requireAuthenticatedInProxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated (any platform role) — return the (possibly cookie-refreshed)
  // continue response.
  return supabaseResponse
}

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') ?? ''
  // Same normalisation the route table is keyed by (case, port, trailing dot,
  // `www.`, IPv6 literals) so the three platform-host equality checks below
  // cannot be defeated by a host header spelling `Dev.Abluo.App`.
  const host = normalizeHost(hostname)
  // ONE host lookup per request. `hostScope` carries the tenant slug and the
  // project's default locale as well as the URL slug, so nothing below has to
  // look the same host up a second time by a different key.
  const hostScope = resolveScopeFromHost(hostname)
  const tenantId = hostScope ? unbrand(hostScope.projectSlug) : null
  const { pathname } = request.nextUrl

  // ── Bypass routes — no middleware processing ─────────────────────────────
  // Pre-authentication surfaces bypass both intlMiddleware and the admin gate.
  // See isPreAuthSurface() for why the list lives there rather than here.
  if (isPreAuthSurface(pathname)) {
    return NextResponse.next()
  }

  // ── Bypass static assets and favicons ──────────────────────────────────────
  if (pathname.match(/\.(png|ico|svg|webp|jpg|jpeg|gif|txt|xml|json|woff|woff2)$/i) ||
      pathname.includes('apple-touch-icon') ||
      pathname.includes('favicon') ||
      pathname.includes('robots.txt') ||
      pathname.includes('sitemap')) {
    return NextResponse.next()
  }

  // ── Admin subdomain — admin.abluo.app ────────────────────────────────────
  // All requests to admin.abluo.app require a valid session.
  // Auth is checked here (before rewrite) because the rewrite changes
  // the pathname and the generic auth guard would never see it.
  if (host === 'admin.abluo.app') {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Admin-only host (ADR-015 R6): upgrade "any authenticated user" to
    // admin-only. Fail-closed — an authenticated non-admin is sent to
    // /unauthorized, which is bypassed at the top of proxy() (no loop).
    if (resolvePlatformRole(user.app_metadata) !== 'abluo_admin') {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }

    // Authenticated admin — apply subdomain rewrite (skip API and static paths)
    const url = request.nextUrl.clone()
    const alreadyLocaled = /^\/(en|it|de)(\/|$)/.test(pathname)
    const isApiOrStatic = pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.startsWith('/studio')
    if (!alreadyLocaled && !isApiOrStatic) {
      const subPath = pathname === '/' ? '/dashboard' : pathname
      url.pathname = `/en${subPath}`
      return NextResponse.rewrite(url)
    }
    return supabaseResponse
  }

  // ── Abluo preview platform — preview.abluo.app/[project-slug] ────────────
  // preview.abluo.app/studiomartegani       → /it/studiomartegani
  // preview.abluo.app/studiomartegani/blog  → /it/studiomartegani/blog
  // ⚠️ This branch sits ABOVE the admin-surface gate, so anything it returns
  // skips that gate entirely. `/dashboard` used to rewrite to `/null/dashboard`,
  // which `[locale]/layout.tsx` 404s on an unknown locale — an accident that
  // happened to keep the surface closed. Resolving the locale honestly turned
  // that 404 into a 307 to `/en/dashboard`: a signpost onto a service-role admin
  // page that has no auth of its own. Admin/client/studio paths must fall
  // through to the real gate below.
  if (
    host === 'preview.abluo.app' &&
    !isAdminSurface(pathname) &&
    !isClientSurface(pathname) &&
    !isStudio(pathname)
  ) {
    const segments = pathname.split('/').filter(Boolean)
    const slug = segments[0]

    // Only rewrite if the first segment looks like a project slug
    // (not a locale prefix, not /studio, not empty)
    const isLocale = slug && (routing.locales as readonly string[]).includes(slug)
    if (slug && !isLocale && slug !== 'studio') {
      const alreadyRewritten = (routing.locales as readonly string[]).some(
        (l) => pathname === `/${l}/${slug}` || pathname.startsWith(`/${l}/${slug}/`)
      )
      if (!alreadyRewritten) {
        // An unknown first segment gets NO rewrite. The old code interpolated
        // the null straight into the path and rewrote to `/null/<slug>`, which
        // 404s with a nonsense URL in the logs. Falling through to intl gives
        // the same 404 with a truthful one.
        const locale = defaultLocaleForProjectSegment(slug)
        if (!locale) return intlMiddleware(request)
        const subPath = segments.slice(1).join('/')
        const url = request.nextUrl.clone()
        url.pathname = `/${locale}/${slug}${subPath ? '/' + subPath : ''}`
        return NextResponse.rewrite(url)
      }
      return NextResponse.next()
    }
    // Root or unrecognised path on preview domain — fall through to intl
    return intlMiddleware(request)
  }

  // ── Dev platform — dev.abluo.app/[project-slug] ──────────────────────────
  // Mirrors preview.abluo.app path-based routing for full platform testing.
  //
  // dev.abluo.app/livener           → /en/livener
  // dev.abluo.app/studiomartegani   → /it/studiomartegani
  // dev.abluo.app/de/livener        → pass through (language switch on livener)
  // dev.abluo.app (root / unknown)  → falls through to the host lookup → abluo
  if (host === 'dev.abluo.app') {
    const segments = pathname.split('/').filter(Boolean)
    const slug = segments[0]
    const isLocale = slug && (routing.locales as readonly string[]).includes(slug)

    if (isLocale) {
      // Path is already in /{locale}/... form — happens after a language switch.
      // If the second segment is a known project slug, pass straight through to
      // the App Router (e.g. /de/livener). Otherwise fall through so the
      // host lookup can inject abluo (e.g. /de → /de/abluo).
      const secondSegment = segments[1]
      if (secondSegment && defaultLocaleForProjectSegment(secondSegment)) {
        return NextResponse.next()
      }
    } else if (slug && slug !== 'studio') {
      // First segment is a project slug — prefix with the tenant's default locale.
      const slugLocale = defaultLocaleForProjectSegment(slug)
      if (slugLocale) {
        const alreadyRewritten = (routing.locales as readonly string[]).some(
          (l) => pathname === `/${l}/${slug}` || pathname.startsWith(`/${l}/${slug}/`)
        )
        if (!alreadyRewritten) {
          const subPath = segments.slice(1).join('/')
          const url = request.nextUrl.clone()
          url.pathname = `/${slugLocale}/${slug}${subPath ? '/' + subPath : ''}`
          return NextResponse.rewrite(url)
        }
        return NextResponse.next()
      }
    }
    // Root or unrecognised path — fall through to the host lookup → abluo
  }

  // ── Admin-surface gate (ADR-015 R6) ──────────────────────────────────────
  // Admin dashboard surfaces and Sanity Studio are Abluo-admin-only. The
  // `tenantId === null` guard is the public-site safety boundary: every public
  // tenant website resolves a NON-null tenant, so this gate is provably INERT
  // for every tenant host and can never touch a paying client's site. It fires
  // only on platform/admin hosts (localhost, dev.abluo.app root, etc.) where no
  // tenant resolves. Must run BEFORE the tenant-routes block below.
  if (tenantId === null && (isAdminSurface(pathname) || isStudio(pathname))) {
    return await requireAdminInProxy(request) // NextResponse (continue) or redirect
  }

  // ── Client-dashboard-surface gate (ADR-017 slice 6 / ADR-015 close-out) ──
  // The tenant CLIENT dashboard `(client)` route group — the user-level
  // `account` page plus the project-scoped `/{projectSlug}/{posts,leads,
  // analytics}` pages (ADR-017 Phase 2) — requires ANY authenticated session,
  // not the abluo_admin role.
  // The same `tenantId === null` guard as the admin gate keeps this provably
  // INERT for every public tenant host (which always resolves a non-null
  // tenant): it fires only on platform/admin hosts where the client dashboard
  // actually lives. The CLIENT_SURFACE_SEGMENTS allowlist is disjoint from
  // ADMIN_SURFACE_SEGMENTS, so this never double-gates an admin surface. Runs
  // AFTER the admin gate and BEFORE the tenant-routes block, mirroring its
  // placement — intl middleware ordering is undisturbed (both gates short-
  // circuit before the intl fall-through at the end of proxy()).
  if (tenantId === null && isClientSurface(pathname)) {
    return await requireAuthenticatedInProxy(request) // NextResponse (continue) or redirect
  }

  // ── Tenant routes — rewrite to [locale]/(website)/[tenant] ───────────────
  // Handles custom production domains (studiomartegani.com → /it/studiomartegani)
  if (tenantId) {
    const url = request.nextUrl.clone()
    const path = url.pathname

    // Already correctly rewritten — pass through.
    const alreadyRewritten = routing.locales.some(
      (l) => path === `/${l}/${tenantId}` || path.startsWith(`/${l}/${tenantId}/`)
    )
    if (alreadyRewritten) return NextResponse.next()

    // Detect a locale-prefix path (e.g. /it or /it/some-page).
    // This happens when the LanguageSwitcher calls router.replace(pathname, { locale })
    // on a custom domain where the visible browser path doesn't include the tenant slug.
    const localePrefix = (routing.locales as readonly string[]).find(
      (l) => path === `/${l}` || path.startsWith(`/${l}/`)
    )

    if (localePrefix) {
      // /it               → /it/abluo
      // /it/some-page     → /it/abluo/some-page
      const subPath = path === `/${localePrefix}` ? '' : path.slice(`/${localePrefix}`.length)
      url.pathname = `/${localePrefix}/${tenantId}${subPath}`
      return NextResponse.rewrite(url)
    }

    // Root path — determine locale from NEXT_LOCALE cookie, then Accept-Language,
    // then fall back to the project default.
    // `hostScope` is non-null here (tenantId came from it), so this is the
    // project's own default — not a guess, and not the platform's 'en'.
    const defaultLocale = hostScope?.defaultLocale ?? 'en'
    let locale = defaultLocale

    if (path === '/') {
      // 1. Honour a previously persisted locale preference (written by next-intl).
      const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value
      if (cookieLocale && (routing.locales as readonly string[]).includes(cookieLocale)) {
        locale = cookieLocale
      } else {
        // 2. Negotiate from Accept-Language header.
        const acceptLanguage = request.headers.get('accept-language') ?? ''
        const preferred = acceptLanguage
          .split(',')
          .map((part) => part.split(';')[0].trim().slice(0, 2))
          .find((code) => (routing.locales as readonly string[]).includes(code))
        if (preferred) locale = preferred
      }
    }

    // All other paths (e.g. /about): use tenant default locale.
    const subPath = path === '/' ? '' : path
    url.pathname = `/${locale}/${tenantId}${subPath}`
    return NextResponse.rewrite(url)
  }

  // ── Project slug routing ───────────────────────────────────────────────────
  // Handles preview.abluo.app/[slug] and any platform URL where the first
  // path segment is a known project slug — no host header dependency.
  // preview.abluo.app/studiomartegani → /it/studiomartegani
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]
  const defaultLocale = firstSegment ? defaultLocaleForProjectSegment(firstSegment) : null

  if (firstSegment && defaultLocale && !routing.locales.includes(firstSegment as (typeof routing.locales)[number])) {
    const alreadyRewritten = routing.locales.some(
      (l) => pathname === `/${l}/${firstSegment}` || pathname.startsWith(`/${l}/${firstSegment}/`)
    )
    if (!alreadyRewritten) {
      const subPath = segments.slice(1).join('/')
      const url = request.nextUrl.clone()
      url.pathname = `/${defaultLocale}/${firstSegment}${subPath ? '/' + subPath : ''}`
      return NextResponse.rewrite(url)
    }
  }

  // ── Platform routes (no tenant) — apply i18n middleware ───────────────────
  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
