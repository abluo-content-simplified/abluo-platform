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
    'livener': 'it',
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

  // ── Sanity Studio — bypass all middleware ─────────────────────────────────
  if (pathname.startsWith('/studio')) {
    return NextResponse.next()
  }

  // ── Admin subdomain — admin.abluo.app → /[locale]/admin ──────────────────
  // admin.abluo.app           → /en/admin/dashboard
  // admin.abluo.app/clients   → /en/admin/clients
  if (host === 'admin.abluo.app') {
    const url = request.nextUrl.clone()
    const alreadyLocaled = /^\/(en|it|de)(\/|$)/.test(pathname)
    if (!alreadyLocaled) {
      const subPath = pathname === '/' ? '/dashboard' : pathname
      url.pathname = `/en${subPath}`
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
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
  if (isProtectedPath(pathname) && !pathname.includes('/admin')) {
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

  // ── Tenant routes — rewrite to [locale]/(website)/[tenant] ───────────────
  // Handles custom production domains (studiomartegani.com → /it/studiomartegani)
  if (tenantId) {
    const url = request.nextUrl.clone()
    const path = url.pathname

    const alreadyRewritten = routing.locales.some(
      (l) => path === `/${l}/${tenantId}` || path.startsWith(`/${l}/${tenantId}/`)
    )

    if (!alreadyRewritten) {
      const subPath = path === '/' ? '' : path
      const locale = resolveDefaultLocale(tenantId) ?? 'it'
      url.pathname = `/${locale}/${tenantId}${subPath}`
      return NextResponse.rewrite(url)
    }

    return NextResponse.next()
  }

  // ── Project slug routing ───────────────────────────────────────────────────
  // Handles preview.abluo.app/[slug] and any platform URL where the first
  // path segment is a known project slug — no host header dependency.
  // preview.abluo.app/studiomartegani → /it/studiomartegani
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]
  const defaultLocale = firstSegment ? resolveDefaultLocale(firstSegment) : null

  if (firstSegment && defaultLocale && !routing.locales.includes(firstSegment as 'en' | 'it' | 'de')) {
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
