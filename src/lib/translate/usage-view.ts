/**
 * Translation usage as people see it (Tom, 2026-11-08) — the tenant's
 * Settings and the admin Projects list. Pure: no I/O.
 *
 * The numbers are the same ones the Translate button enforces (ADR-023 §8):
 * characters metered in `translation_usage` this calendar month (UTC), against
 * the Translate module's "Monthly limit (characters)". No limit set = unlimited.
 */

import { monthStartUtc } from './quota'

/** From this share of the limit on, the site is "near the limit". */
export const NEAR_LIMIT_SHARE = 0.8

export type TranslationUsageState = 'unlimited' | 'ok' | 'near' | 'reached'

export type TranslationUsageView = {
  /** Characters translated this month. */
  used: number
  /** Monthly limit, or null for no limit. */
  limit: number | null
  /** used / limit, 0–1 (capped); null without a limit. */
  share: number | null
  state: TranslationUsageState
  /** ISO date (YYYY-MM-DD, UTC) of the first day of next month — when the count starts again. */
  resetsOn: string
}

export function translationUsageView(used: number, limit: number | null, now: Date = new Date()): TranslationUsageView {
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0
  const start = monthStartUtc(now)
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const resetsOn = next.toISOString().slice(0, 10)
  if (limit === null || !(limit > 0)) return { used: safeUsed, limit: null, share: null, state: 'unlimited', resetsOn }
  const share = Math.min(1, safeUsed / limit)
  const state: TranslationUsageState = safeUsed >= limit ? 'reached' : share >= NEAR_LIMIT_SHARE ? 'near' : 'ok'
  return { used: safeUsed, limit, share, state, resetsOn }
}

/** One project's cell on the admin Projects list. */
export type TranslationUsageSummary =
  | { kind: 'off' }
  | { kind: 'unavailable' }
  | ({ kind: 'usage' } & TranslationUsageView)
