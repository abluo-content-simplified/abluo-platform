import { createServerClient } from '@supabase/ssr'
import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'
import { resolvePlatformRole } from '@/lib/api/auth'
import { isAdminSurface, isStudio } from '@/lib/proxy/admin-surface'
import { isClientSurface } from '@/lib/proxy/client-surface'

const intlMiddleware = createMiddleware(routing)

/**
 * Resolve the project slug from the request hostname.
 *
 * Production domains:  studiomartegani.com        → "studiomartegani"
 * Abluo preview URLs:  studiomartegani.preview.abluo.app → "studiomartegani"
 * Dev convention:      studiomartegani.localhost:3000    → "studiomartegani"
 * Platform/admin:      abluo-platform.vercel.app        → null
 */
function resolveTenant(hostname: string): string | null {
  // Strip port, then normalize www. prefix so studiomartegani.com and
  // www.studiomartegani.com both resolve via the same domainMap entry.
  const host = hostname.split(':')[0].replace(/^www\./, '')

  // Abluo managed preview — *.preview.abluo.app
  // studiomartegani.preview.abluo.app → "studiomartegani"
  if (host.endsWith('.preview.abluo.app')) {
    const slug = host.slice(0, -'.preview.abluo.app'.length)
    if (slug && slug !== 'www') return slug
  }

  // Production custom domains — map known domains to project slugs
  const domainMap: Record<string, string> = {
    'livener.net': 'livener',
    'studiomartegani.com': 'studiomartegani',
    'abluo.app': 'abluo-the-tiny-cms',
    'dev.abluo.app': 'abluo-the-tiny-cms',
  }

  if (domainMap[host]) return domainMap[host]

  // Dev convention: <project>.localhost
  if (host.endsWith('.localhost')) {
    const sub = host.replace('.localhost', '')
    if (sub && sub !== 'www') return sub
  }

  return null
}

/**
 * Map URL tenant slug to actual Sanity projectSlug.
 * URL slugs are shorter (e.g., "livener"), Sanity projectSlugs have suffixes (e.g., "livener-main")
 */
function resolveSanityProjectSlug(urlTenant: string): string | null {
  const projectMap: Record<string, string> = {
    'livener': 'livener-main',
    'studiomartegani': 'studiomartegani-main',
  }
  return projectMap[urlTenant] ?? null
}

/**
 * Resolve the default display locale for a project.
 * Used when routing from a domain root — no locale in the URL yet.
 * Keep in sync with the projects table in Supabase.
 */
/**
 * Returns the default locale for a known project slug, or null if unknown.
 * Only known project slugs get preview routing — prevents false rewrites
 * on paths like /login, /unauthorized, etc.
 */
function resolveDefaultLocale(projectSlug: string): string | null {
  const localeMap: Record<string, string> = {
    'studiomartegani': 'it',
    'livener': 'en',
    'abluo-the-tiny-cms': 'en',
  }
  return localeMap[projectSlug] ?? null
}

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
  const host = hostname.split(':')[0]
  const tenantId = resolveTenant(hostname)
  const { pathname } = request.nextUrl

  // ── Bypass routes — no middleware processing ─────────────────────────────
  // /login and /unauthorized are the un-gated "escape hatch" pages: they must
  // stay reachable without an auth/role check, otherwise the admin-host and
  // admin-surface gates below would redirect them to themselves (a loop).
  // /studio is intentionally NOT bypassed here — it now reaches the admin gate.
  //
  // /auth/callback and /invite/accept (ADR-017 slice 4, invite-acceptance
  // flow) sit outside `[locale]` for the same reason as /login — they must
  // reach the browser exactly as-is, without intlMiddleware rewriting the
  // path to add a locale prefix (which would 404, since no [locale]/auth or
  // [locale]/invite route exists) and without the admin-surface gate below
  // (they are pre-authentication surfaces by definition: an invited user has
  // no session yet when they land here).
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/unauthorized') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/invite/accept')
  ) {
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
  if (host === 'preview.abluo.app') {
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
        const locale = resolveDefaultLocale(slug)
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
  // dev.abluo.app (root / unknown)  → falls through to domainMap → abluo-the-tiny-cms
  if (host === 'dev.abluo.app') {
    const segments = pathname.split('/').filter(Boolean)
    const slug = segments[0]
    const isLocale = slug && (routing.locales as readonly string[]).includes(slug)

    if (isLocale) {
      // Path is already in /{locale}/... form — happens after a language switch.
      // If the second segment is a known project slug, pass straight through to
      // the App Router (e.g. /de/livener). Otherwise fall through so the
      // domainMap block can inject abluo-the-tiny-cms (e.g. /de → /de/abluo-the-tiny-cms).
      const secondSegment = segments[1]
      if (secondSegment && resolveDefaultLocale(secondSegment)) {
        return NextResponse.next()
      }
    } else if (slug && slug !== 'studio') {
      // First segment is a project slug — prefix with the tenant's default locale.
      const slugLocale = resolveDefaultLocale(slug)
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
    // Root or unrecognised path — fall through to domainMap → abluo-the-tiny-cms
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
  // The tenant CLIENT dashboard `(client)` route group (account/posts/leads/
  // analytics) requires ANY authenticated session — not the abluo_admin role.
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
      // /it               → /it/abluo-the-tiny-cms
      // /it/some-page     → /it/abluo-the-tiny-cms/some-page
      const subPath = path === `/${localePrefix}` ? '' : path.slice(`/${localePrefix}`.length)
      url.pathname = `/${localePrefix}/${tenantId}${subPath}`
      return NextResponse.rewrite(url)
    }

    // Root path — determine locale from NEXT_LOCALE cookie, then Accept-Language,
    // then fall back to the project default.
    const defaultLocale = resolveDefaultLocale(tenantId) ?? 'en'
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
  const defaultLocale = firstSegment ? resolveDefaultLocale(firstSegment) : null

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
