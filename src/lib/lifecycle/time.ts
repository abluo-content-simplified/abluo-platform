/**
 * Content lifecycle — dates in the project's time zone (ADR-032 D8).
 *
 * Stored: UTC ISO instants. Shown and entered: local wall-clock time in the
 * project's IANA zone (`siteConfig.timeZone`; an event venue zone wins for
 * event dates, ADR-031).
 *
 * DST rules for a local time an editor types:
 *   - it does not exist (spring forward gap) → the first valid minute after
 *     the gap (in Europe/Rome, 02:30 on the change day → 03:00);
 *   - it exists twice (fall back overlap) → the first occurrence;
 *   the result says which happened so the UI can show the resolved time.
 */

import { instant } from './visibility'

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const MINUTE = 60_000
const HOUR = 60 * MINUTE

export type LocalDateTime = string // 'YYYY-MM-DDTHH:mm'
export type Resolution = 'exact' | 'gap' | 'overlap'

function parts(ms: number, timeZone: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const out: Record<string, number> = {}
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (Europe/Rome summer → 120). */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return Math.round((asUtc - Math.floor(ms / MINUTE) * MINUTE) / MINUTE)
}

/** The wall-clock time of a UTC instant in `timeZone`, as 'YYYY-MM-DDTHH:mm'. */
export function utcToLocal(utc: string, timeZone: string): LocalDateTime {
  const ms = instant(utc)
  if (ms === null) throw new Error('utcToLocal: not a date')
  const p = parts(ms, timeZone)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * The UTC instant for a wall-clock time typed in `timeZone`, with the DST rules
 * above. Throws on a malformed local value; the zone must be valid IANA.
 */
export function localToUtc(local: LocalDateTime, timeZone: string): { utc: string; resolution: Resolution } {
  const m = LOCAL.exec(local)
  if (!m) throw new Error('localToUtc: expected YYYY-MM-DDTHH:mm')
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== d || mo < 1 || mo > 12 || h > 23 || mi > 59) {
    throw new Error('localToUtc: not a calendar date')
  }
  // DST transitions are at most a few hours apart from the guess.
  const offsets = new Set([zoneOffsetMinutes(guess - 12 * HOUR, timeZone), zoneOffsetMinutes(guess + 12 * HOUR, timeZone)])
  const candidates = [...offsets]
    .map((o) => guess - o * MINUTE)
    .filter((c) => utcToLocal(new Date(c).toISOString(), timeZone) === local)
    .sort((a, b) => a - b)
  if (candidates.length) {
    return { utc: new Date(candidates[0]).toISOString(), resolution: candidates.length > 1 ? 'overlap' : 'exact' }
  }
  // Gap: the local time never happens. Find the transition instant (first
  // minute after the gap) between the two candidate instants.
  const [o1, o2] = [...offsets]
  let lo = Math.min(guess - o1 * MINUTE, guess - o2 * MINUTE)
  let hi = Math.max(guess - o1 * MINUTE, guess - o2 * MINUTE)
  const before = zoneOffsetMinutes(lo, timeZone)
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE
    if (zoneOffsetMinutes(mid, timeZone) === before) lo = mid
    else hi = mid
  }
  return { utc: new Date(hi).toISOString(), resolution: 'gap' }
}

export type WindowError = 'invalid_date' | 'unpublish_in_past' | 'unpublish_not_after_publish'

/**
 * Validates a publication window before it is written (ADR-032 D6).
 * `publishedAt` may be in the past (publish now / keep the original date);
 * `expiresAt`, when set, must be in the future and after `publishedAt`.
 */
export function validateWindow(
  window: { publishedAt?: string | null; expiresAt?: string | null },
  now: Date
): WindowError | null {
  const p = window.publishedAt == null ? null : instant(window.publishedAt)
  const e = window.expiresAt == null ? null : instant(window.expiresAt)
  if ((window.publishedAt != null && p === null) || (window.expiresAt != null && e === null)) return 'invalid_date'
  if (e !== null && e <= now.getTime()) return 'unpublish_in_past'
  if (e !== null && p !== null && e <= p) return 'unpublish_not_after_publish'
  return null
}
