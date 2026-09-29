/**
 * Monthly quota maths (ADR-023 §8). Pure.
 */

/** First instant of the calendar month (UTC) containing `now`. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** Normalise the config value: empty, 0, negative or non-numeric = no limit. */
export function normaliseQuota(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

export function isQuotaReached(quota: number | null, used: number): boolean {
  return quota !== null && used >= quota
}

/** A request is refused whole when it would cross the limit — never a partial translation. */
export function wouldExceedQuota(quota: number | null, used: number, requested: number): boolean {
  return quota !== null && used + requested > quota
}
