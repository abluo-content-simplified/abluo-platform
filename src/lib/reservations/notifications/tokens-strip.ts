// ── Reservations outbox — remove clear-text tokens after delivery (ADR-044 D10/D11)
//
// The management and My-pass tokens travel in the outbox payload only until the
// email is out. After that the row must not keep working links (the database
// stores just the sha256 of each token). Applied on delivered, skipped and dead.

/** Any key that carries a credential: managementToken, passTokens, calendarToken, token … */
const TOKEN_KEY = /^(token|.*tokens?)$/i

export function stripTokens<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripTokens(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TOKEN_KEY.test(k)) continue
      out[k] = stripTokens(v)
    }
    return out as T
  }
  return value
}

export function hasTokens(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTokens)
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => TOKEN_KEY.test(k) || hasTokens(v))
  }
  return false
}
