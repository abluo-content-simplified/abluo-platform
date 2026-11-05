// ── Scheduling — weekly recurrence (ADR-038 Amendment A3, ADR-045) ────────────
//
// Pure and client-safe. Only the "weekly on one weekday, every N weeks" preset
// exists (no free RRULE editor). `expandWeekly` turns a rule into the local
// date-times of a window; the UTC instants come from `resolveSessionTimes`, so
// DST follows ADR-032 (18:00 stays 18:00; a time in the spring gap moves to the
// first valid minute; an autumn overlap takes the first instant).
//
// Identity: `originalStartLocal` is the time the RULE generated ('YYYY-MM-DDTHH:mm'
// as typed, even when DST moved the stored `startLocal`). It is the stable key the
// database matches on, so regenerating never creates duplicates.
// "Every N weeks" counts weeks from the week (Monday–Sunday) of `anchor`.

import { resolveSessionTimes } from './time'
import { ScheduleError } from './types'

/** Hard cap on the dates examined by one expansion (sessions + closed dates). */
export const MAX_EXPANDED_SESSIONS = 400
export const MAX_WEEK_INTERVAL = 52

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export type WeeklyRule = { weekday: number; interval: number }
export type DateRange = { startsOn: string; endsOn: string }

export type ExpandWeeklyInput = {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
  /** Every N weeks (1 = every week). */
  interval: number
  startTime: string
  endTime: string | null
  timeZone: string
  /** First / last date to consider, inclusive ('YYYY-MM-DD'). */
  from: string
  until: string
  /** A date in the "week 0" of the rule; decides which weeks count when interval > 1. */
  anchor: string
  /** Holidays: dates inside any range generate no session (inclusive). */
  closures?: readonly DateRange[]
}

export type ExpandedSession = {
  /** The rule's own time — the stable key (not moved by DST). */
  originalStartLocal: string
  startLocal: string
  endLocal: string | null
  startsAt: string
  endsAt: string | null
}

export type ExpandWeeklyResult = {
  sessions: ExpandedSession[]
  /** originalStartLocal of the dates dropped because of a closure. */
  closed: string[]
  /** True when MAX_EXPANDED_SESSIONS stopped the expansion early. */
  truncated: boolean
}

/** Parses 'FREQ=WEEKLY;INTERVAL=n;BYDAY=XX' (parts in any order, INTERVAL optional); null when it is anything else. */
export function parseWeeklyRule(rule: string | null | undefined): WeeklyRule | null {
  if (typeof rule !== 'string' || rule.length > 512) return null
  const parts = new Map<string, string>()
  for (const part of rule.split(';')) {
    const [k, v] = part.split('=')
    if (!k || v === undefined || parts.has(k)) return null
    parts.set(k, v)
  }
  if (parts.get('FREQ') !== 'WEEKLY') return null
  for (const k of parts.keys()) if (k !== 'FREQ' && k !== 'INTERVAL' && k !== 'BYDAY') return null
  const day = DAY_CODES.indexOf((parts.get('BYDAY') ?? '') as (typeof DAY_CODES)[number])
  if (day < 0) return null
  const rawInterval = parts.get('INTERVAL')
  const interval = rawInterval === undefined ? 1 : Number(rawInterval)
  if (!/^\d+$/.test(rawInterval ?? '1') || !Number.isInteger(interval) || interval < 1 || interval > MAX_WEEK_INTERVAL) return null
  return { weekday: day + 1, interval }
}

/** 'FREQ=WEEKLY;INTERVAL=n;BYDAY=XX'. Throws ScheduleError('invalid') for a weekday outside 1..7 or an interval outside 1..52. */
export function formatWeeklyRule(rule: WeeklyRule): string {
  if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) throw new ScheduleError('invalid', 'The weekday is not valid.')
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_WEEK_INTERVAL) throw new ScheduleError('invalid', 'The interval is not valid.')
  return `FREQ=WEEKLY;INTERVAL=${rule.interval};BYDAY=${DAY_CODES[rule.weekday - 1]}`
}

// ── Calendar-day arithmetic (days since 1970-01-01, UTC; no time zones involved) ──

/** Days since the epoch for a real 'YYYY-MM-DD' date; null when malformed or not a real date. */
export function dayNumber(date: string): number | null {
  const m = DATE.exec(date)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(ms)
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return Math.round(ms / 86_400_000)
}

export function dateOfDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' plus `days` calendar days. Throws ScheduleError('invalid') for a bad date. */
export function addDays(date: string, days: number): string {
  const n = dayNumber(date)
  if (n === null) throw new ScheduleError('invalid', 'The date is not valid.')
  return dateOfDay(n + days)
}

/** 1 = Monday … 7 = Sunday of a real 'YYYY-MM-DD' date. */
export function weekdayOf(date: string): number {
  const n = dayNumber(date)
  if (n === null) throw new ScheduleError('invalid', 'The date is not valid.')
  return mod(n + 3, 7) + 1 // 1970-01-01 was a Thursday
}

const mod = (a: number, n: number) => ((a % n) + n) % n

/**
 * The sessions of a weekly class between `from` and `until` (inclusive), minus
 * closures. `until` before `from` gives nothing. Invalid input throws
 * ScheduleError('invalid'). Never examines more than MAX_EXPANDED_SESSIONS dates.
 */
export function expandWeekly(input: ExpandWeeklyInput): ExpandWeeklyResult {
  const invalid = (what: string) => new ScheduleError('invalid', `The ${what} is not valid.`)
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) throw invalid('weekday')
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > MAX_WEEK_INTERVAL) throw invalid('interval')
  if (!TIME.test(input.startTime)) throw invalid('start time')
  if (input.endTime !== null && !TIME.test(input.endTime)) throw invalid('end time')
  const from = dayNumber(input.from)
  const until = dayNumber(input.until)
  const anchor = dayNumber(input.anchor)
  if (from === null) throw invalid('first date')
  if (until === null) throw invalid('last date')
  if (anchor === null) throw invalid('anchor date')
  const ranges = (input.closures ?? []).map((c) => {
    const s = dayNumber(c.startsOn)
    const e = dayNumber(c.endsOn)
    if (s === null || e === null || e < s) throw invalid('closure')
    return [s, e] as const
  })

  const out: ExpandWeeklyResult = { sessions: [], closed: [], truncated: false }
  if (until < from) return out

  const weekStart = (day: number) => day - mod(day + 3, 7) // Monday on/before `day`
  const anchorWeek = weekStart(anchor)
  // First week index (counted from the anchor's week) at/after the week of `from` that the interval allows.
  let k = Math.floor((weekStart(from) - anchorWeek) / 7)
  k += mod(-k, input.interval)

  let examined = 0
  for (; ; k += input.interval) {
    const day = anchorWeek + 7 * k + (input.weekday - 1)
    if (day > until) break
    if (day < from) continue
    if (examined >= MAX_EXPANDED_SESSIONS) {
      out.truncated = true
      break
    }
    examined++
    const date = dateOfDay(day)
    const originalStartLocal = `${date}T${input.startTime}`
    if (ranges.some(([s, e]) => day >= s && day <= e)) {
      out.closed.push(originalStartLocal)
      continue
    }
    const times = resolveSessionTimes({
      timeZone: input.timeZone,
      startLocal: originalStartLocal,
      endLocal: input.endTime ? `${date}T${input.endTime}` : null,
    })
    out.sessions.push({ originalStartLocal, startLocal: times.startLocal, endLocal: times.endLocal, startsAt: times.startsAt, endsAt: times.endsAt })
  }
  return out
}
