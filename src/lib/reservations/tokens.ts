// ── Reservations — management / My-pass link tokens (ADR-044 D11) ────────────
// Same format as the Site Access session token (32 random bytes, base64url, only
// the sha256 hex is stored), so the existing helpers are re-exported, not copied.
export {
  generateSessionToken as generateManagementToken,
  hashSessionToken as hashToken,
  isWellFormedSessionToken as isWellFormedToken,
} from '@/lib/access/session-token'
