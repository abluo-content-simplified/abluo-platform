/**
 * Invitation link tokens — ADR-028 §6.
 *
 * 32 random bytes (256 bits), base64url in the link. The database stores only
 * the SHA-256 of the token (base64url, 43 chars — `invitations.token_hash`),
 * so a database leak cannot be turned into working links.
 */
import { createHash, randomBytes } from 'node:crypto'

export function newInvitationToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/** Shape check only — a malformed token is answered "invalid" without touching the database. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}
