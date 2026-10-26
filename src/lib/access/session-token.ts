/**
 * Site Access — the session cookie (ADR-040 §6). Server-only (Node crypto).
 *
 * The cookie value is an OPAQUE random token (32 bytes, base64url). Only its
 * sha256 is stored (site_access_sessions.token_hash), so a database leak gives
 * nobody a usable cookie. There is nothing to sign: the token carries no
 * claims, every decision is read live from the database. That is what makes
 * revocation, rotation and group changes take effect on the next request.
 */
import { createHash, randomBytes } from 'crypto'
import { ACCESS_LIMITS } from './model'

const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** True only for something that could have been minted by generateSessionToken(). */
export function isWellFormedSessionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * One cookie per PROJECT, named with a fragment of the project id.
 *
 * `__Host-` makes the browser enforce Secure, Path=/ and no Domain — the
 * cookie is bound to the exact host. The project fragment matters on the
 * platform's PATH-routed hosts (dev.abluo.app/<project>, preview.abluo.app/
 * <project>) where many projects share one host and one cookie jar; the lookup
 * is ALSO keyed on the project server-side, so the name is about not
 * clobbering each other, not about security.
 *
 * Plain http://localhost cannot hold a `__Host-` cookie, so local development
 * drops the prefix and the Secure flag.
 */
export function sessionCookieName(projectId: string, secure: boolean): string {
  const fragment = projectId.replace(/-/g, '').slice(0, 12).toLowerCase()
  return `${secure ? '__Host-' : ''}abluo-access-${fragment}`
}

export type SessionCookieAttributes = {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function sessionCookieAttributes(secure: boolean, maxAgeSeconds = ACCESS_LIMITS.sessionDays * 86400): SessionCookieAttributes {
  // Lax, not Strict: a member following a link from the association's email
  // must arrive signed in. The cookie authorises reads only; every state change
  // is a POST that the routes also origin-check (B2).
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds }
}

/** Secure cookies everywhere except plain-http local development. */
export function isSecureRequest(url: URL): boolean {
  return url.protocol === 'https:' || !/^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(url.hostname)
}
