/**
 * Rotating single-use step-completion tokens — ADR-018 slice 1 (Decision 6).
 *
 * A multi-step submission is created in a `partial` state and issued an opaque
 * token. Each successful step SPENDS the presented token and issues a fresh one
 * (rotation). Only a sha256 HASH of the current token is persisted
 * (`form_submissions.step_token_hash`); the plaintext is returned to the client
 * exactly once and never stored — the same discipline as a password.
 *
 * Pure/Node-crypto only. No DB access here; persistence + comparison happens in
 * the submission service, which calls `hashToken()` and `tokensMatch()`.
 */
import { randomBytes, createHash, timingSafeEqual } from 'crypto'

/** Default lifetime of a step token (Tom-confirmed: 30 minutes). */
export const STEP_TOKEN_TTL_MS = 30 * 60 * 1000

/** Generates a fresh, URL-safe opaque token (32 random bytes, base64url). */
export function generateStepToken(): string {
  return randomBytes(32).toString('base64url')
}

/** sha256(token) as lowercase hex. This is what is stored, never the plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 * Returns false for any missing/empty input rather than throwing, so callers
 * can treat "no token on the row" and "wrong token" identically.
 */
export function tokensMatch(presentedToken: string | undefined | null, storedHash: string | undefined | null): boolean {
  if (!presentedToken || !storedHash) return false
  const presentedHash = hashToken(presentedToken)
  if (presentedHash.length !== storedHash.length) return false
  try {
    return timingSafeEqual(Buffer.from(presentedHash, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

/** True if `expiresAt` (ISO string or Date) is in the past relative to `now`. */
export function isTokenExpired(expiresAt: string | Date | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return true
  const ts = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt.getTime()
  if (Number.isNaN(ts)) return true
  return ts <= now
}

/**
 * Issues a new token + its stored hash + expiry. The caller persists
 * `{ hash, expiresAt }` and returns `token` to the client.
 */
export function issueStepToken(now: number = Date.now(), ttlMs: number = STEP_TOKEN_TTL_MS): {
  token: string
  hash: string
  expiresAt: string
} {
  const token = generateStepToken()
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(now + ttlMs).toISOString(),
  }
}
