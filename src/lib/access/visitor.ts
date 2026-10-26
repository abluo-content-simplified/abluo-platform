/**
 * Site Access — the visitor plane (ADR-040 §5–§7). Server-only.
 *
 * unlockWithPassword()  password prompt → atomic rate-limit reservation →
 *                       scrypt → session/grant
 * resolveVisitor()      cookie token → live groups of THIS project in THIS
 *                       environment, or null
 * logout()              revokes the current session
 *
 * The project id always comes from the REQUEST HOST (resolveScopeFromHost in
 * the route, B2), never from a body, query string or cookie. The environment
 * comes from resolveAccessEnvironment(). Every store call is keyed on both
 * where it matters, and migration 050 refuses cross-project rows, so a cookie
 * or a credential of one project is useless on another — including on the
 * platform's shared path-routed hosts — and a session made on dev or preview
 * is nothing in production.
 */
import type { AccessEnvironment } from './environment'
import { isAccessEnvironment } from './environment'
import { ACCESS_LIMITS, AccessError } from './model'
import { burnOneVerification, verifyPassword } from './password'
import type { VisitorGrants } from './policy'
import { hashIp, RATE_LIMITS, type AttemptReservation } from './rate-limit'
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from './session-token'
import type { SiteAccessStore } from './store'

export type UnlockResult =
  | { ok: true; token: string; sessionId: string; grantedCredentialIds: string[] }
  | { ok: false; code: 'wrong_password' | 'try_later' | 'unavailable' }
  | { ok: false; code: 'too_many_attempts'; retryAfterSeconds: number }

export async function unlockWithPassword(input: {
  store: SiteAccessStore
  projectId: string
  /** resolveAccessEnvironment(). null (undeterminable) → unavailable. */
  environment: AccessEnvironment | null
  password: unknown
  /** The visitor's current cookie token, if any — rotated, never reused (fixation). */
  currentToken: string | null | undefined
  ip: string
  /** ACCESS_IP_SALT. Missing → refuse (no salt = no rate limit = fail closed). */
  ipSalt: string | undefined
  /** Narrow to passwords that can help with this resource (groupsRelevantTo). null = all. */
  forGroupIds: string[] | null
  deviceLabel?: string | null
  sessionSeconds?: number
}): Promise<UnlockResult> {
  const { store, projectId } = input
  if (!input.ipSalt || !isAccessEnvironment(input.environment)) return { ok: false, code: 'unavailable' }
  const environment = input.environment
  const ipHash = hashIp(input.ip, input.ipSalt)

  // Reserve BEFORE any password is checked. Atomic in the database: parallel
  // requests from one address cannot each see "no failures yet".
  let reservation: AttemptReservation
  try {
    reservation = await store.reserveAttempt(projectId, ipHash, RATE_LIMITS)
  } catch (e) {
    if (e instanceof AccessError && e.code === 'unavailable' && /not installed/.test(e.message)) return { ok: false, code: 'unavailable' }
    return { ok: false, code: 'try_later' }
  }
  if (!reservation.allowed) return { ok: false, code: 'too_many_attempts', retryAfterSeconds: reservation.retryAfterSeconds }
  const attemptId = reservation.attemptId

  // From here on, every path that does not end in a session finishes the
  // reservation as a failure. If finishing itself fails, the pending row
  // already counts as a failure until it leaves the window.
  const fail = async <T extends UnlockResult>(result: T): Promise<T> => {
    try { await store.failAttempt(projectId, attemptId) } catch { /* pending = failure until the window passes */ }
    return result
  }

  const password = typeof input.password === 'string' ? input.password : ''
  const tooLong = [...password].length > ACCESS_LIMITS.passwordMaxLength

  let candidates: Awaited<ReturnType<SiteAccessStore['candidateCredentials']>>
  try {
    candidates = await store.candidateCredentials(projectId, input.forGroupIds)
  } catch {
    return fail({ ok: false, code: 'try_later' })
  }

  // Check EVERY candidate (no early exit) so the work done does not depend on
  // which password matched; with none to check, do the work of one.
  const matched: typeof candidates = []
  if (candidates.length === 0 || password.length === 0 || tooLong) {
    await burnOneVerification()
  } else {
    for (const c of candidates) {
      if (await verifyPassword(password, c.passwordHash)) matched.push(c)
    }
  }
  if (matched.length === 0) return fail({ ok: false, code: 'wrong_password' })

  // Passwords are unique per project (enforced at creation), so normally one
  // matches. Each unlock rotates the token: the previous one dies, and only
  // the token the database last accepted is handed back. The first successful
  // unlock marks the reservation succeeded in the same transaction.
  const initialHash = isWellFormedSessionToken(input.currentToken) ? hashSessionToken(input.currentToken) : null
  let issued: string | null = null
  let sessionId = ''
  const granted: string[] = []
  for (const c of matched) {
    const next = generateSessionToken()
    try {
      sessionId = await store.unlock({
        projectId,
        environment,
        credentialId: c.credentialId,
        credentialVersion: c.secretVersion,
        currentTokenHash: issued ? hashSessionToken(issued) : initialHash,
        newTokenHash: hashSessionToken(next),
        sessionSeconds: input.sessionSeconds ?? ACCESS_LIMITS.sessionDays * 86400,
        attemptId: issued ? null : attemptId,
        deviceLabel: input.deviceLabel ?? null,
      })
      issued = next
      granted.push(c.credentialId)
    } catch (e) {
      // Rotated or disabled between verify and unlock: that password no longer counts.
      if (e instanceof AccessError && e.code === 'credential_unavailable') continue
      if (!issued) return fail({ ok: false, code: 'try_later' })
    }
  }
  if (!issued) return fail({ ok: false, code: 'wrong_password' })
  return { ok: true, token: issued, sessionId, grantedCredentialIds: granted }
}

/**
 * The visitor's live grants on THIS project in THIS environment, or null.
 * Never throws: an undeterminable environment, a malformed token or a store
 * failure all answer null, which every gate treats as "no session" — deny by
 * default. Failures are logged without the token.
 */
export async function resolveVisitor(input: {
  store: SiteAccessStore
  projectId: string
  environment: AccessEnvironment | null
  token: string | null | undefined
}): Promise<VisitorGrants | null> {
  if (!isAccessEnvironment(input.environment) || !isWellFormedSessionToken(input.token)) return null
  try {
    const s = await input.store.resolve(input.projectId, input.environment, hashSessionToken(input.token))
    if (!s) return null
    return { sessionId: s.sessionId, groupIds: new Set(s.groupIds.map((g) => g.toLowerCase())) }
  } catch (e) {
    console.error('[site-access] resolve failed — denying', e instanceof AccessError ? e.code : 'error')
    return null
  }
}

/**
 * Revokes the current session. Idempotent. Reports what it could CONFIRM:
 *   revoked     the session existed here and is now revoked server-side;
 *   no_session  nothing live to revoke (no, malformed, foreign, expired or
 *               already revoked token) — nothing remains server-side;
 *   failed      the environment is undeterminable or the store failed — the
 *               session may still be valid server-side until it expires or is
 *               revoked from the dashboard. Callers must not claim otherwise.
 */
export async function logout(input: {
  store: SiteAccessStore
  projectId: string
  environment: AccessEnvironment | null
  token: string | null | undefined
}): Promise<'revoked' | 'no_session' | 'failed'> {
  if (!isWellFormedSessionToken(input.token)) return 'no_session'
  if (!isAccessEnvironment(input.environment)) return 'failed'
  try {
    const s = await input.store.resolve(input.projectId, input.environment, hashSessionToken(input.token))
    if (!s) return 'no_session'
    await input.store.revokeSessions(input.projectId, s.sessionId, 'logout', null)
    return 'revoked'
  } catch (e) {
    console.error('[site-access] logout failed', e instanceof AccessError ? e.code : 'error')
    return 'failed'
  }
}
