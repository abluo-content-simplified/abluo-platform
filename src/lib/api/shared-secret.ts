import { createHash, timingSafeEqual } from 'crypto'

/**
 * Constant-time shared-secret checks for machine-to-machine routes (Vercel
 * Cron, the Supabase database webhook, one-off maintenance endpoints).
 *
 * Those routes used `header !== secret` / `header !== \`Bearer ${secret}\``,
 * which short-circuits on the first differing byte. Both sides are hashed to a
 * fixed 32 bytes first so the comparison is constant-time AND length-blind
 * (`timingSafeEqual` throws on unequal lengths, which would itself leak the
 * secret's length).
 *
 * Fail-closed: an unset or empty configured secret never matches anything,
 * including an empty presented value.
 */
export function secretEquals(presented: string | null | undefined, configured: string | null | undefined): boolean {
  if (!configured || typeof presented !== 'string') return false
  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(configured, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** `Authorization: Bearer <secret>` against a configured secret. */
export function bearerMatches(authorization: string | null | undefined, configured: string | null | undefined): boolean {
  if (!configured || typeof authorization !== 'string') return false
  return secretEquals(authorization, `Bearer ${configured}`)
}
