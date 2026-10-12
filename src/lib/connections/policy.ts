// ── Connections — lifetimes and windows (ADR-031 D2, Amendment B) ─────────────

/** Access tokens: short-lived (1 h). Every call re-checks the Connection anyway. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60

/** Refresh tokens: 90 days, renewed on every rotation (an idle partner must reconnect). */
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60

/** Authorization codes: 5 minutes (migration 040 caps them at 10). */
export const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000

/**
 * A retired refresh token presented within this window is treated as a retry
 * of a refresh whose response was lost (network blip), not as theft.
 */
export const REFRESH_GRACE_MS = 30 * 1000

/** last_used_at is written at most once per this interval per token. */
export const TOUCH_INTERVAL_MS = 60 * 1000

/** The only grants a partner app can use. No password, no client_credentials. */
export const ALLOWED_GRANTS = ['authorization_code', 'refresh_token'] as const

export type Clock = () => Date
export const systemClock: Clock = () => new Date()
