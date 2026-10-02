import { createServerClient } from '@supabase/ssr'
import createMiddleware from 'next-intl/middleware'
import { negotiateLocale } from '@/lib/i18n/negotiate-locale'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'
import { resolvePlatformRole } from '@/lib/api/auth'
import { adminGateDecision, mfaRedirectPath, readAssuranceLevel } from '@/lib/auth/admin-assurance'
import { isAdminSurface, isStudio, isPreAuthSurface } from '@/lib/proxy/admin-surface'
import { isClientSurface } from '@/lib/proxy/client-surface'
import {
  resolveScopeFromHost,
  defaultLocaleForProjectSegment,
  normalizeHost,
  isPlatformHost,
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

  // Two-factor (AAL2) for every admin surface — see admin-assurance.ts.
  const mfa = await requireAdminAal2(request, supabase, supabaseResponse)
  if (mfa) return mfa

  // Admin — return the (possibly cookie-refreshed) continue response.
  return supabaseResponse
}

/**
 * The two-factor half of the admin gate, shared by `requireAdminInProxy` and
 * the `admin.abluo.app` host block. Called only after `getUser()` returned an
 * `abluo_admin` on this same client, which is what makes the decoded `aal`
 * claim server-validated. Returns `null` when the session is AAL2 (continue),
 * otherwise a redirect to `/mfa?next=<original path>` — enrollment when the
 * admin has no verified factor yet, a challenge when they do. Fail-closed: an
 * error reading the level is "not AAL2". The redirect carries any refreshed
 * session cookies so the MFA page sees the same session.
 */
async function requireAdminAal2(
  request: NextRequest,
  supabase: Parameters<typeof readAssuranceLevel>[0],
  supabaseResponse: NextResponse
): Promise<NextResponse | null> {
  const currentLevel = await readAssuranceLevel(supabase)
  const decision = adminGateDecision({ hasUser: true, platformRole: 'abluo_admin', currentLevel })
  if (decision === 'allow') return null
  const redirect = NextResponse.redirect(
    new URL(mfaRedirectPath(request.nextUrl.pathname, request.nextUrl.search), request.url)
  )
  for (const c of supabaseResponse.cookies.getAll()) redirect.cookies.set(c)
  return redirect
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

  // ── Auth gates — keyed on the PATH, on every host ───────────────────────
  // ADR-015 R6 (admin surfaces + Studio) and ADR-017 slice 6 (client dashboard).
  //
  // These used to sit BELOW the host-specific branches and carry a
  // `tenantId === null` conjunct. Both were wrong, for the same reason:
  //
  //   • The conjunct meant the gates did not run at all on any host that
  //     resolves to a project — livener.net, studiomartegani.com, nologo.cloud,
  //     abluo.app, dev.abluo.app, ch-psicoterapeuta.com. `/dashboard` was closed
  //     on those hosts only because it fell through to the tenant rewrite and
  //     landed on a route that does not exist. That is a routing accident, not
  //     authentication, and it changes whenever the rewrite changes.
  //   • The position meant any host branch that returned first skipped them.
  //     That is exactly what leaked on 2026-09-02:
  //     `preview.abluo.app/en/dashboard` returned 200 unauthenticated with every
  //     project name and UUID in the flight payload, because the preview branch
  //     answered the request above the gate.
  //
  // So the gate now keys on the PATH and nothing else, and the ordering
  // invariant is positional: the ONLY things allowed to return before this
  // block are the pre-auth surfaces and the static-asset bypass above it, both
  // of which must be reachable without a session by construction. Anything
  // added below this line cannot re-open a gated surface by accident.
  //
  // `admin.abluo.app` is the one exemption, and it is not a hole: that host's
  // own inline gate immediately below requires an `abluo_admin` session for
  // EVERY path on it, not merely the gated ones — strictly stronger than this
  // block. It is exempted so that (a) an admin request does not pay for two
  // `getUser()` round-trips, and (b) the host still reaches its subdomain
  // rewrite (`/dashboard` → `/en/dashboard`), which returning from here would
  // skip. Removing the exemption would break that rewrite, not tighten anything.
  //
  // ── `/studio` is now admin-gated on EVERY host (deliberate change) ───────
  // Sanity Studio is one app at `src/app/studio/[[...tool]]`, outside `[locale]`
  // and outside `[tenant]`. It was previously gated only when `tenantId === null`;
  // on a customer host `/studio` instead fell into the tenant rewrite and became
  // `/{locale}/{project}/studio`, i.e. it was matched by the public catch-all
  // `(website)/[tenant]/[slug]` and served (or 404'd) as an ordinary CMS page.
  // The Studio itself was never reachable there either way, so gating it costs
  // no functionality; what it costs is the string `studio` as a client-authored
  // page slug on a customer domain. That word was ALREADY reserved on the
  // platform's own path-routed hosts — both the `preview.abluo.app` and
  // `dev.abluo.app` branches below hard-code `slug !== 'studio'` — so this makes
  // one reservation uniform instead of host-dependent, and removes a case where
  // a reserved platform path is answered by tenant content.
  if (host !== 'admin.abluo.app') {
    if (isAdminSurface(pathname) || isStudio(pathname)) {
      return await requireAdminInProxy(request) // NextResponse (continue) or redirect
    }
    if (isClientSurface(pathname)) {
      return await requireAuthenticatedInProxy(request) // NextResponse (continue) or redirect
    }
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

    // Two-factor (AAL2) for every path on the admin host.
    const mfa = await requireAdminAal2(request, supabase, supabaseResponse)
    if (mfa) return mfa

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
  // The three `!is…Surface` conjuncts below are now REDUNDANT — the gates run
  // above every host branch, so no gated path can reach this line. They are kept
  // deliberately, as the last line of defence for the hole that actually leaked:
  // this branch once answered `/en/dashboard` itself (307 → `/en/dashboard`, a
  // signpost onto a service-role admin page with no auth of its own) precisely
  // because it sat above the gate. If anyone ever moves the gate back down,
  // these conjuncts keep that specific 200 from returning.
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

  // ── Where the two auth gates used to live ───────────────────────────
  // The admin-surface gate and the client-dashboard gate ran HERE, each behind a
  // `tenantId === null` conjunct. Both have moved to the top of proxy(), above
  // every host-specific branch, and lost the conjunct — see the comment there.
  // Nothing gated can reach this point: an admin/client/studio path on any host
  // but `admin.abluo.app` (which gates itself, harder) has already been answered.

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

    // Root path — the platform rule (src/lib/i18n/negotiate-locale.ts):
    // earlier choice on this site (NEXT_LOCALE) → first browser language the
    // SITE offers → the site's default. Negotiated against the PROJECT's
    // languages, never the platform registry: a German browser on a site
    // without German used to be sent to /de and 404ed by the [tenant] layout.
    // `hostScope` is non-null here (tenantId came from it), so the default and
    // the language list are the project's own.
    const defaultLocale = hostScope?.defaultLocale ?? 'en'
    let locale = defaultLocale

    if (path === '/') {
      locale = negotiateLocale({
        cookieLocale: request.cookies.get('NEXT_LOCALE')?.value,
        acceptLanguage: request.headers.get('accept-language'),
        supportedLocales: hostScope?.supportedLocales,
        defaultLocale,
      })
    }

    // All other paths (e.g. /about): use tenant default locale.
    const subPath = path === '/' ? '' : path
    url.pathname = `/${locale}/${tenantId}${subPath}`
    return NextResponse.rewrite(url)
  }

  // ── Project slug routing ───────────────────────────────────────────────────
  // Path-based access to a project on the PLATFORM's own hosts:
  // preview.abluo.app/studiomartegani → /it/studiomartegani, and the same on
  // localhost during development.
  //
  // ⚠️ GUARDED BY isPlatformHost. This block used to run for ANY host that
  // reached it, so a hostname the route table does not know — a domain someone
  // points at this deployment, a raw *.vercel.app URL — could reach any project
  // by path. `whatever.example.com/livener` served Livener.
  //
  // That was never a data leak (the content is a public website either way) and
  // *.vercel.app is already noindex'd by src/lib/seo/indexability.ts, so the
  // duplicate-content half was covered. But serving a customer's site from a
  // hostname that is not theirs is not something to do by omission. A host now
  // has to be a known platform host to route by path; everything else falls
  // through to the platform routes below.
  //
  // Not affected: hosts the route table DOES know resolve earlier and return
  // before this point — the tenant branch for custom domains, and the
  // dedicated dev.abluo.app / preview.abluo.app branches above.
  const segments = pathname.split('/').filter(Boolean)
  const firstSegment = segments[0]
  const defaultLocale =
    firstSegment && isPlatformHost(host) ? defaultLocaleForProjectSegment(firstSegment) : null

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
