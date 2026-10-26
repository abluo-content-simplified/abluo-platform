/**
 * Site Access — the visitor routes (ADR-040 §9, B2.3). Server only.
 *
 *   POST /{locale}/{project}/site-access/unlock     password → session cookie
 *   POST /{locale}/{project}/site-access/sign-out   revoke session, clear cookie
 *   GET  /{locale}/{project}/site-access/status     { signedIn } for the members bar
 *                                                   (R9: sign-out findable on every page)
 *
 * (On a project's own domain the visible path has no project segment; the
 * proxy adds it, exactly as for pages.)
 *
 * Both are plain HTML form posts — they work without JavaScript — and answer
 * 303 back to the page the visitor came from, with a one-word outcome
 * (`?access=wrong|wait|unavailable|signed_out`) that the page turns into a
 * localized message. Nothing about the page, its groups or the password is
 * ever echoed.
 *
 * Order of checks, each refusing before any database work:
 *   1. same-origin POST (Origin === this host, Sec-Fetch-Site same-origin)
 *   2. a supported locale and a project resolvable from the WEBSITE ADDRESS
 *   3. url-encoded body of bounded size
 *   4. a same-site return path inside this site (else the site's home)
 *   5. unlock only: the Access module enabled for the project (Sanity)
 * then the B1/B2.0 visitor plane does the rest (environment binding, atomic
 * rate limit, scrypt, rotation, project-keyed store calls).
 *
 * Every response: `Cache-Control: private, no-store`.
 */
import { NextResponse } from 'next/server'
import { tenantClient } from '@/lib/sanity/client'
import { projectModuleConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { extractIp } from '@/lib/forms/spam'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { ACCESS_MODULE_ID } from './model'
import { accessEnvironment, accessIpSalt, withSiteAccessStore } from './server'
import { sessionCookieAttributes, sessionCookieName } from './session-token'
import { logout, resolveVisitor, unlockWithPassword } from './visitor'
import {
  accessSiteBase,
  isSameOriginPost,
  isSecureAccessRequest,
  isSupportedLocale,
  requestOrigin,
  resolveAccessRouteProject,
  retryMinutes,
  safeReturnPath,
  withAccessNotice,
  ACCESS_FORM_FIELDS,
  readCookie,
  type AccessNotice,
  type AccessRouteProject,
} from './request'

const MAX_BODY_BYTES = 8 * 1024
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }

type RouteParams = { locale: string; tenant: string }

function plain(status: number, text: string): NextResponse {
  return new NextResponse(text, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } })
}

function seeOther(origin: string, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, origin), { status: 303, headers: NO_STORE })
}

type Prepared =
  | { ok: false; response: NextResponse }
  | { ok: true; origin: string; project: AccessRouteProject; locale: string; back: string; form: URLSearchParams; secure: boolean }

/** Steps 1–4, shared by both routes. */
async function prepare(request: Request, params: RouteParams): Promise<Prepared> {
  const h = request.headers
  if (!isSameOriginPost(h)) return { ok: false, response: plain(403, 'Forbidden') }
  const origin = requestOrigin(h)!
  if (!isSupportedLocale(params.locale)) return { ok: false, response: plain(404, 'Not found') }
  const project = resolveAccessRouteProject(h.get('host'), params.tenant)
  if (!project) return { ok: false, response: plain(404, 'Not found') }

  const type = (h.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/x-www-form-urlencoded') return { ok: false, response: plain(415, 'Unsupported Media Type') }
  const declared = Number(h.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return { ok: false, response: plain(413, 'Payload Too Large') }
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) return { ok: false, response: plain(413, 'Payload Too Large') }
  const form = new URLSearchParams(body)

  const siteBase = accessSiteBase(params.locale, project)
  const back = safeReturnPath(form.get(ACCESS_FORM_FIELDS.returnTo), siteBase) ?? siteBase
  return { ok: true, origin, project, locale: params.locale, back, form, secure: isSecureAccessRequest(h) }
}

/** The Access module is enabled for the project (Sanity installation record); unreadable → off. */
/** The project's enabled module ids; null when unreadable (callers treat that as off). */
export async function projectEnabledModuleIds(project: AccessRouteProject, locale: string): Promise<readonly string[] | null> {
  try {
    const scope = resolveScopeFromProjectSegment(project.segment)
    const { fetchForTenant } = tenantClient(asUrlProjectSegment(project.segment))
    const config = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale: scope?.defaultLocale ?? locale })
    const enabled = getEnabledModuleIds(config)
    return Array.isArray(enabled) ? enabled : null
  } catch {
    return null // unreadable → off (deny by default)
  }
}

export async function accessModuleEnabled(project: AccessRouteProject, locale: string): Promise<boolean> {
  const enabled = await projectEnabledModuleIds(project, locale)
  return Array.isArray(enabled) && enabled.includes(ACCESS_MODULE_ID)
}

export async function handleUnlock(request: Request, params: RouteParams): Promise<NextResponse> {
  const p = await prepare(request, params)
  if (!p.ok) return p.response
  const fail = (notice: AccessNotice, minutes?: number) => seeOther(p.origin, withAccessNotice(p.back, notice, minutes))

  if (!(await accessModuleEnabled(p.project, p.locale))) return fail('unavailable')

  const name = sessionCookieName(p.project.projectId, p.secure)
  let result: Awaited<ReturnType<typeof unlockWithPassword>>
  try {
    result = await withSiteAccessStore('visitor unlock route: check a shared password and start a session', (store) =>
      unlockWithPassword({
        store,
        projectId: p.project.projectId,
        environment: accessEnvironment(),
        password: p.form.get(ACCESS_FORM_FIELDS.password) ?? '',
        currentToken: readCookie(request.headers, name),
        ip: extractIp(request.headers),
        ipSalt: accessIpSalt(),
        // Any of the project's passwords may be used here; the page then
        // decides whether the resulting groups open it.
        forGroupIds: null,
      })
    )
  } catch {
    return fail('unavailable')
  }

  if (!result.ok) {
    if (result.code === 'wrong_password') return fail('wrong')
    if (result.code === 'too_many_attempts') return fail('wait', retryMinutes(result.retryAfterSeconds))
    return fail('unavailable')
  }
  const response = seeOther(p.origin, p.back)
  response.cookies.set(name, result.token, sessionCookieAttributes(p.secure))
  return response
}

export async function handleSignOut(request: Request, params: RouteParams): Promise<NextResponse> {
  const p = await prepare(request, params)
  if (!p.ok) return p.response
  const name = sessionCookieName(p.project.projectId, p.secure)
  const token = readCookie(request.headers, name)
  let outcome: 'revoked' | 'no_session' | 'failed' = 'no_session'
  if (token) {
    try {
      outcome = await withSiteAccessStore('visitor sign-out route: revoke the current session', (store) =>
        logout({ store, projectId: p.project.projectId, environment: accessEnvironment(), token })
      )
    } catch {
      outcome = 'failed'
    }
  }
  // The cookie is cleared either way. Only a CONFIRMED revocation (or nothing
  // to revoke) may say "signed out"; otherwise the visitor is told they are
  // signed out in this browser — the session may live on server-side until it
  // expires or is revoked from the dashboard (ADR-040 §9, residual risk).
  const response = seeOther(p.origin, withAccessNotice(p.back, outcome === 'failed' ? 'signed_out_browser' : 'signed_out'))
  // Clear with the same attributes it was set with (a __Host- cookie must be
  // Secure, Path=/ and host-only to be overwritten).
  response.cookies.set(name, '', { ...sessionCookieAttributes(p.secure), maxAge: 0 })
  return response
}


/**
 * R9 (ADR-040 §15) — is this browser signed in to the project? Answers only a
 * boolean about the visitor's OWN session (never groups, pages or names), so
 * the site can show "Members area · Sign out" on every page. No cookie → no
 * database call. Any failure → not signed in.
 */
export async function handleStatus(request: Request, params: RouteParams): Promise<NextResponse> {
  const h = request.headers
  const answer = (signedIn: boolean) => NextResponse.json({ signedIn }, { headers: NO_STORE })
  if (!isSupportedLocale(params.locale)) return answer(false)
  const project = resolveAccessRouteProject(h.get('host'), params.tenant)
  if (!project) return answer(false)
  const token = readCookie(h, sessionCookieName(project.projectId, isSecureAccessRequest(h)))
  if (!token) return answer(false)
  const environment = accessEnvironment()
  if (!environment) return answer(false)
  try {
    const visitor = await withSiteAccessStore('members bar: is this browser signed in to the project', (store) =>
      resolveVisitor({ store, projectId: project.projectId, environment, token })
    )
    return answer(Boolean(visitor))
  } catch {
    return answer(false)
  }
}
