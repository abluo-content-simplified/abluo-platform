/**
 * Site Access — layered rate limiting for the password prompt (ADR-040 §7).
 *
 * The DECISION is made in the database, atomically:
 * `site_access_reserve_attempt()` counts and reserves under an advisory lock
 * on the IP hash, so parallel requests from one address are serialised and
 * cannot each see "zero failures" (the B1 review found 20 of 20 parallel
 * guesses were checked under the old count-then-record flow). This file only
 * holds the limits it is called with and the IP normalisation/hashing.
 *
 * With SHARED passwords a wrong guess cannot be attributed to one credential,
 * so the layers are:
 *
 *   1. per IP on this project      5 failures / 15 min → wait
 *   2. per IP across all projects  30 failures / 15 min → wait
 *   3. per project, all IPs        at ≥ 50 failures / 15 min the project is
 *                                  "under pressure" and layer 1 tightens to 2.
 *                                  NEVER to zero: no global lockout an attacker
 *                                  could use against members. Visitors holding a
 *                                  session are never rate-limited.
 *
 * A reservation is PENDING until the password check finishes; pending counts
 * as a failure and, like a failure, stops counting when it leaves the window,
 * so an abandoned one can block nobody for more than one window.
 * Unreadable or failed reservation → `try_later` (fail closed).
 */
import { createHash } from 'crypto'
import { isIP } from 'net'

export const RATE_LIMITS = {
  windowSeconds: 15 * 60,
  perIpProject: 5,
  perIpProjectUnderPressure: 2,
  perIpAllProjects: 30,
  projectPressure: 50,
} as const

export type RateLimits = typeof RATE_LIMITS

export type AttemptReservation =
  | { allowed: true; attemptId: number; underPressure: boolean }
  | { allowed: false; retryAfterSeconds: number; underPressure: boolean }

/**
 * The address a rate limit counts. IPv6 is cut to its /64 — one subscriber
 * line usually owns a whole /64, so counting /128s would hand an attacker a
 * fresh bucket per request. IPv4 is kept whole.
 */
export function rateLimitAddress(ip: string): string {
  const raw = ip.trim().replace(/^\[|\]$/g, '')
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4mapped) return v4mapped[1]
  if (isIP(raw) !== 6) return raw
  const [head, tail = ''] = raw.toLowerCase().split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const full = raw.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/**
 * Salted hash of the rate-limit address. The salt is a server secret
 * (ACCESS_IP_SALT); without it there is no rate limiting, so the caller must
 * refuse attempts (fail closed) rather than hash with an empty salt.
 */
export function hashIp(ip: string, salt: string): string {
  if (!salt) throw new Error('hashIp: ACCESS_IP_SALT missing')
  return createHash('sha256').update(`${rateLimitAddress(ip)}|${salt}`, 'utf8').digest('hex')
}
