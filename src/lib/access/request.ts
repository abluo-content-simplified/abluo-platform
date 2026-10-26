/**
 * Site Access — what the visitor routes may trust about a request (ADR-040
 * §9, B2.3). Pure and edge-safe: headers in, decisions out.
 *
 *   requestOrigin()          the origin the BROWSER used (Host + protocol)
 *   isSameOriginPost()       strict CSRF check for the unlock / sign-out POSTs
 *   resolveAccessRouteProject()  project from the WEBSITE ADDRESS — never a body
 *   safeReturnPath()         a same-site relative path inside this site, or null
 *   withAccessNotice() / parseAccessNotice()  the one-word outcome carried back
 *
 * The project is decided exactly the way the page route decides it: the proxy
 * puts the project segment in the URL (from the host on a project's own
 * domain, from the path on the platform's shared hosts), and this module
 * re-checks that the host may serve that segment at all.
 */
import { routing } from '@/i18n/routing'
import { isPlatformHost, lookupHostRoute, resolveScopeFromHost, resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { unbrand } from '@/lib/tenancy/ids'

type HeaderReader = { get(name: string): string | null }

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$|\.localhost(:\d+)?$/i

/** `https://host[:port]` as the browser addressed it, or null when the Host header is unusable. */
export function requestOrigin(headers: HeaderReader): string | null {
  const host = (headers.get('host') ?? '').trim().toLowerCase()
  if (!host || !/^[a-z0-9.\-[\]:]+$/.test(host)) return null
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : LOCAL_HOST.test(host) ? 'http' : 'https'
  // Plain http is only believed for local development hosts.
  if (proto === 'http' && !LOCAL_HOST.test(host)) return `https://${host}`
  return `${proto}://${host}`
}

/**
 * Whether the access cookie is a `__Host-` Secure cookie on this request. The
 * page gate (reading) and the routes (writing) MUST agree, so both use this.
 * Everything except plain-http local development is secure.
 */
export function isSecureAccessRequest(headers: HeaderReader): boolean {
  const origin = requestOrigin(headers)
  return origin === null || origin.startsWith('https://')
}

/**
 * Strict same-origin check for a state-changing POST (login CSRF, forced
 * sign-out). The browser's `Origin` must be present and equal the request's
 * own origin; `Sec-Fetch-Site`, when sent, must say same-origin. A missing or
 * `null` Origin is refused — every browser sends Origin on a POST.
 */
export function isSameOriginPost(headers: HeaderReader): boolean {
  const expected = requestOrigin(headers)
  const origin = headers.get('origin')?.trim().toLowerCase()
  if (!expected || !origin || origin === 'null' || origin !== expected) return false
  const site = headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return false
  return true
}

export type AccessRouteProject = {
  projectId: string
  /** The project's URL segment (the `[tenant]` route param). */
  segment: string
  /** True on the project's own host, where public paths have no project segment. */
  hostScoped: boolean
}

/**
 * The project a visitor route acts for, from the website address only:
 *   - on a project's own host: that project, and the path segment must agree
 *     (the proxy rewrote it — anything else is refused);
 *   - on the platform's shared, path-routed hosts (preview.abluo.app,
 *     dev.abluo.app, localhost): the project in the path;
 *   - on any other host: nothing.
 */
export function resolveAccessRouteProject(host: string | null | undefined, segment: string | null | undefined): AccessRouteProject | null {
  const bySegment = resolveScopeFromProjectSegment(segment)
  if (!bySegment || !segment) return null
  const hostScope = resolveScopeFromHost(host)
  if (hostScope && unbrand(hostScope.projectSlug) === segment && hostScope.projectId === bySegment.projectId) {
    return { projectId: bySegment.projectId, segment, hostScoped: true }
  }
  // Path-routed hosts: the platform hosts, and a platform ALIAS such as
  // dev.abluo.app, which serves its own project at the root and every other
  // project by path (the proxy's dev.abluo.app branch). lookupHostRoute() is
  // read for the host's KIND only; whether the segment's project serves at
  // all was decided above by resolveScopeFromProjectSegment().
  if (isPlatformHost(host) || lookupHostRoute(host)?.hostKind === 'platform-alias') {
    return { projectId: bySegment.projectId, segment, hostScoped: false }
  }
  return null
}

export function isSupportedLocale(locale: unknown): locale is string {
  return typeof locale === 'string' && (routing.locales as readonly string[]).includes(locale)
}

/** The public path prefix of the site in this language (same rule as siteBasePath). */
export function accessSiteBase(locale: string, project: AccessRouteProject): string {
  return project.hostScoped ? `/${locale}` : `/${locale}/${project.segment}`
}

export const ACCESS_NOTICE_PARAM = 'access'
export const ACCESS_WAIT_PARAM = 'wait'
export const ACCESS_NOTICES = ['wrong', 'wait', 'unavailable', 'signed_out', 'signed_out_browser'] as const
export type AccessNotice = (typeof ACCESS_NOTICES)[number]

/**
 * A same-site relative path inside this site (`siteBase` or below), with any
 * earlier access notice removed — or null. Refuses absolute and
 * protocol-relative URLs, backslashes, control characters and paths outside
 * the site (another project on a shared host).
 */
export function safeReturnPath(raw: unknown, siteBase: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw, 'https://return.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://return.invalid') return null
  const path = url.pathname
  if (/(^|\/)\.\.?(\/|$)/.test(raw.split(/[?#]/)[0])) return null
  const base = siteBase === '/' ? '' : siteBase.replace(/\/+$/, '')
  if (base && path !== base && !path.startsWith(`${base}/`)) return null
  url.searchParams.delete(ACCESS_NOTICE_PARAM)
  url.searchParams.delete(ACCESS_WAIT_PARAM)
  const search = url.searchParams.toString()
  return `${path}${search ? `?${search}` : ''}${url.hash}`
}

/** `path` with the outcome attached (path must come from safeReturnPath). */
export function withAccessNotice(path: string, notice: AccessNotice, waitMinutes?: number): string {
  const url = new URL(path, 'https://return.invalid')
  url.searchParams.set(ACCESS_NOTICE_PARAM, notice)
  if (notice === 'wait' && waitMinutes !== undefined) url.searchParams.set(ACCESS_WAIT_PARAM, String(clampMinutes(waitMinutes)))
  return `${url.pathname}${url.search}${url.hash}`
}

function clampMinutes(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.ceil(n), 1), 120) : 15
}

/** Reads the outcome back on the page. Anything unknown is ignored. */
export function parseAccessNotice(searchParams: Record<string, string | string[] | undefined> | null | undefined): { notice: AccessNotice | null; waitMinutes: number | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const raw = one(searchParams?.[ACCESS_NOTICE_PARAM])
  const notice = (ACCESS_NOTICES as readonly string[]).includes(raw ?? '') ? (raw as AccessNotice) : null
  const waitRaw = Number(one(searchParams?.[ACCESS_WAIT_PARAM]))
  const waitMinutes = notice === 'wait' && Number.isInteger(waitRaw) && waitRaw > 0 ? clampMinutes(waitRaw) : null
  return { notice, waitMinutes }
}

/** Seconds → whole minutes for the "try again in" message. */
export function retryMinutes(seconds: number): number {
  return clampMinutes(seconds / 60)
}

// ── The visitor routes' public addresses and form fields ────────────────────

export const ACCESS_ROUTE_SEGMENT = 'site-access'
export const UNLOCK_PATH = `${ACCESS_ROUTE_SEGMENT}/unlock`
export const SIGN_OUT_PATH = `${ACCESS_ROUTE_SEGMENT}/sign-out`

/** Form field names — shared with the prompt so the two cannot drift. */
export const ACCESS_FORM_FIELDS = { password: 'password', returnTo: 'returnTo' } as const

/** The form actions for a page of this site (public paths, as the visitor sees them). */
export function accessFormActions(siteBase: string): { unlock: string; signOut: string } {
  const base = siteBase === '/' ? '' : siteBase
  return { unlock: `${base}/${UNLOCK_PATH}`, signOut: `${base}/${SIGN_OUT_PATH}` }
}

/** One cookie from the request's Cookie header (the browser sends name=value pairs only). */
export function readCookie(headers: HeaderReader, name: string): string | null {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null
  }
  return null
}

/** The site's sign-in page, carrying where to go back to (a same-site path). */
export function signInPath(siteBase: string, returnTo: string): string {
  const base = siteBase === '/' ? '' : siteBase
  return `${base}/${ACCESS_ROUTE_SEGMENT}/sign-in?${new URLSearchParams({ returnTo }).toString()}`
}
