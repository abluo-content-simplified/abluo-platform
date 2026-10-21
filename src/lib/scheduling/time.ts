// ── Scheduling — session times (ADR-038 D3) ──────────────────────────────────
//
// The local wall-clock time + IANA zone is the truth ("18:00 every Monday stays
// 18:00 across daylight saving"); the UTC instants are derived from it here, in
// ONE place, with the platform's DST rules (ADR-032, src/lib/lifecycle/time.ts):
//   - a local time that does not exist (spring-forward gap) moves to the first
//     valid minute after the gap, and the stored local time says so;
//   - a local time that exists twice (autumn overlap) takes the first occurrence.
// Start and end are converted independently, so a session that crosses a DST
// change keeps its wall-clock end ("01:00–04:00" on the night the clocks go back
// lasts four real hours, not three).

import { localToUtc, utcToLocal, type Resolution } from '@/lib/lifecycle/time'
import { isValidTimeZone } from '@/lib/time/zones'
import { ScheduleError, type LocalDateTime } from './types'

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export type SessionTimes = {
  timeZone: string
  startLocal: LocalDateTime
  endLocal: LocalDateTime | null
  startsAt: string
  endsAt: string | null
  /** How DST resolved the typed start / end ('exact' almost always). */
  startResolution: Resolution
  endResolution: Resolution | null
}

/** Normalises 'YYYY-MM-DD HH:mm[:ss]' / 'YYYY-MM-DDTHH:mm[:ss[.sss]]' to 'YYYY-MM-DDTHH:mm'. */
export function normaliseLocal(value: unknown): LocalDateTime | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(' ', 'T').slice(0, 16)
  return LOCAL.test(v) ? v : null
}

/**
 * The stored times of one session from what an editor typed. Throws
 * ScheduleError('invalid') for an unknown zone, a malformed time, or an end
 * that is not after the start (after DST resolution).
 */
export function resolveSessionTimes(input: { timeZone: string; startLocal: string; endLocal?: string | null }): SessionTimes {
  const zone = typeof input.timeZone === 'string' ? input.timeZone.trim() : ''
  if (!zone || !isValidTimeZone(zone)) throw new ScheduleError('invalid', 'Unknown time zone.')
  const startTyped = normaliseLocal(input.startLocal)
  if (!startTyped) throw new ScheduleError('invalid', 'The start date is not valid.')
  const endTyped = input.endLocal == null || input.endLocal === '' ? null : normaliseLocal(input.endLocal)
  if (input.endLocal != null && input.endLocal !== '' && !endTyped) throw new ScheduleError('invalid', 'The end date is not valid.')

  let start: { utc: string; resolution: Resolution }
  let end: { utc: string; resolution: Resolution } | null = null
  try {
    start = localToUtc(startTyped, zone)
    if (endTyped) end = localToUtc(endTyped, zone)
  } catch {
    throw new ScheduleError('invalid', 'The date is not a real calendar date.')
  }
  if (end && Date.parse(end.utc) < Date.parse(start.utc)) throw new ScheduleError('invalid', 'The end is before the start.')

  // A gap moves the time: store the local time that actually happens.
  const startLocal = start.resolution === 'gap' ? utcToLocal(start.utc, zone) : startTyped
  const endLocal = end ? (end.resolution === 'gap' ? utcToLocal(end.utc, zone) : endTyped) : null
  return {
    timeZone: zone,
    startLocal,
    endLocal,
    startsAt: start.utc,
    endsAt: end ? end.utc : null,
    startResolution: start.resolution,
    endResolution: end ? end.resolution : null,
  }
}

/** The local time of a UTC instant in a zone (for showing stored sessions and migrating legacy dates). */
export function localOf(utc: string, timeZone: string): LocalDateTime {
  if (!isValidTimeZone(timeZone)) throw new ScheduleError('invalid', 'Unknown time zone.')
  try {
    return utcToLocal(utc, timeZone)
  } catch {
    throw new ScheduleError('invalid', 'Not a date.')
  }
}
