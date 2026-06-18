import { createServerClient } from '@supabase/ssr'
import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'

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
  // Strip port
  const host = hostname.split(':')[0]

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
 * Decode a single claim from a JWT without verifying the signature.
 * Safe to use here because getUser() has already validated the token
 * with the Supabase server above.
 */
function decodeJwtClaim(token: string | undefined, claim: string): string | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload[claim] ?? null
  } catch {
    return null
  }
}

// Dashboard routes that require a valid Supabase session
const PROTECTED_PREFIXES = ['/admin', '/client']
// Routes restricted to users with role = "admin"
const ADMIN_ONLY_PREFIXES = ['/admin']

/** Strip locale prefix (e.g. /en/admin → /admin) before matching. */
function stripLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(\/|$)/, '/')
}

function isProtectedPath(pathname: string): boolean {
  const p = stripLocale(pathname)
  return PROTECTED_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '/'))
}

function isAdminPath(pathname: string): boolean {
  const p = stripLocale(pathname)
  return ADMIN_ONLY_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '/'))
}

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') ?? ''
  const host = hostname.split(':')[0]
  const tenantId = resolveTenant(hostname)
  const { pathname } = request.nextUrl

  // ── Bypass routes — no middleware processing ─────────────────────────────
  if (pathname.startsWith('/studio') || pathname.startsWith('/login')) {
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

    // Authenticated — apply subdomain rewrite
    const url = request.nextUrl.clone()
    const alreadyLocaled = /^\/(en|it|de)(\/|$)/.test(pathname)
    if (!alreadyLocaled) {
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

  // ── Auth guard ────────────────────────────────────────────────────────────
  // Protected routes (/admin, /client) require a valid Supabase session.
  // TODO: Re-enable for /admin when login page is built.
  // Currently only enforced for /client routes.
  // ─────────────────────────────────────────────────────────────────────────
  if (isProtectedPath(pathname)) {
    // This response object may be mutated by setAll() below to carry
    // refreshed session cookies back to the browser.
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
            // Persist refreshed tokens onto both the request (for this
            // handler) and the response (sent back to the browser).
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

    // getUser() validates the token with the Supabase Auth server.
    // It also silently refreshes an expired token (via setAll above).
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      // Not signed in — redirect to login, preserving the intended destination.
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Admin-only routes: verify role from JWT custom claim.
    if (isAdminPath(pathname)) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const role = decodeJwtClaim(session?.access_token, 'user_role')

      if (role !== 'admin') {
        return NextResponse.redirect(new URL('/unauthorized', request.url))
      }
    }

    // Authenticated — return the (possibly cookie-refreshed) response.
    return supabaseResponse
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
