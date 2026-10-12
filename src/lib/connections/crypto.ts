// ── Connections — secrets, hashes, PKCE checks (ADR-031 D2, Amendment B) ──────
//
// OUR responsibility, independent of the OAuth library: every secret Abluo
// issues is generated, prefixed, hashed and compared here. The database only
// ever sees SHA-256 hex digests (migration 040 CHECKs enforce the shape).
//
// Server-only: uses node:crypto.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Unbiased base62 string of `length` characters from the OS CSPRNG (rejection sampling). */
export function randomBase62(length: number): string {
  let out = ''
  while (out.length < length) {
    const buf = randomBytes(length * 2)
    for (const b of buf) {
      // 248 = 62 * 4: values ≥ 248 are rejected so every character is equally likely.
      if (b < 248) out += BASE62[b % 62]
      if (out.length === length) break
    }
  }
  return out
}

/**
 * Every secret kind Abluo issues. The prefix makes a leaked value recognisable
 * by secret scanners and by support ("that is a refresh token, not a key").
 * 43 base62 characters ≈ 256 bits of entropy.
 */
export const SECRET_KINDS = {
  accessToken: { prefix: 'abluo_at_', length: 43 },
  refreshToken: { prefix: 'abluo_rt_', length: 43 },
  authorizationCode: { prefix: 'abluo_ac_', length: 43 },
  clientSecret: { prefix: 'abluo_cs_', length: 43 },
  clientId: { prefix: 'abluo_app_', length: 24 },
} as const
export type SecretKind = keyof typeof SECRET_KINDS

export function generateSecret(kind: SecretKind): string {
  const { prefix, length } = SECRET_KINDS[kind]
  return prefix + randomBase62(length)
}

const SECRET_PATTERNS: Record<SecretKind, RegExp> = {
  accessToken: /^abluo_at_[A-Za-z0-9]{43}$/,
  refreshToken: /^abluo_rt_[A-Za-z0-9]{43}$/,
  authorizationCode: /^abluo_ac_[A-Za-z0-9]{43}$/,
  clientSecret: /^abluo_cs_[A-Za-z0-9]{43}$/,
  clientId: /^abluo_app_[A-Za-z0-9]{16,64}$/,
}

/** Shape check before any lookup: a malformed value never reaches the database. */
export function isSecretOfKind(value: unknown, kind: SecretKind): value is string {
  return typeof value === 'string' && SECRET_PATTERNS[kind].test(value)
}

/** SHA-256 hex digest — the only form a secret is stored in. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Constant-time comparison of two equal-format hex digests. */
export function hexDigestsEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/** Does `secret` hash to `storedHash`? Constant time. */
export function secretMatchesHash(secret: string, storedHash: string): boolean {
  return hexDigestsEqual(sha256Hex(secret), storedHash)
}

/** `abluo_at_XXXX` — what migration 040 stores in token_prefix (never usable). */
export function tokenPrefix(token: string): string {
  return token.slice(0, 13)
}

// ── PKCE (RFC 7636) ──────────────────────────────────────────────────────────

/** RFC 7636 §4.1: 43–128 characters of [A-Z a-z 0-9 - . _ ~]. */
export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(value)
}

/** S256 challenge: base64url (no padding) of SHA-256 — always 43 characters. */
export function isValidS256Challenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** Our own PKCE check, constant time. The library repeats it (defence in depth). */
export function verifierMatchesChallenge(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidS256Challenge(challenge)) return false
  const a = Buffer.from(s256Challenge(verifier))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}
