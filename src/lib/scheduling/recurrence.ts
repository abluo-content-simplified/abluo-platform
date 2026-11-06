// ── Scheduling — class recurrence (ADR-038 Amendment A3, ADR-045) ────────────
//
// Pure and client-safe. A class repeats by one of four PRESETS (no free RRULE
// editor); `ClassRule` is their parsed form and `parseClassRule` /
// `formatClassRule` their stored text (event_series.rule):
//
//   once              'FREQ=DAILY;COUNT=1'                  one date (the class's first date)
//   weekly            'FREQ=WEEKLY;INTERVAL=n;BYDAY=MO,WE'  one or more weekdays, every n weeks
//   monthlyWeekday    'FREQ=MONTHLY;BYDAY=1MO' / '-1SU'     first … fourth / last <weekday> of the month
//   monthlyDay        'FREQ=MONTHLY;BYMONTHDAY=15'          day N of the month (months without it are skipped)
//
// `expandRule` turns a rule into the local date-times of a window (`expandWeekly`
// is the old single-weekday entry point, kept as a wrapper); the UTC instants come from `resolveSessionTimes`, so
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

// ── Class rules (the presets) ────────────────────────────────────────────────

export type Ordinal = 1 | 2 | 3 | 4 | -1
export const ORDINALS: readonly Ordinal[] = [1, 2, 3, 4, -1]

export type ClassRule =
  | { kind: 'once' }
  | {
      kind: 'weekly'
      /** 1 = Monday … 7 = Sunday, ascending, unique. */ weekdays: number[]
      interval: number
    }
  | { kind: 'monthlyWeekday'; ordinal: Ordinal; weekday: number }
  | { kind: 'monthlyDay'; day: number }

/** Stored text of "once": a daily rule that ends after one date (standard RRULE, never null). */
export const ONCE_RULE = 'FREQ=DAILY;COUNT=1'

const isWeekday = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7
const isInterval = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_WEEK_INTERVAL

function splitRule(rule: string | null | undefined): Map<string, string> | null {
  if (typeof rule !== 'string' || rule.length > 512) return null
  const parts = new Map<string, string>()
  for (const part of rule.split(';')) {
    const [k, v, ...extra] = part.split('=')
    if (!k || v === undefined || extra.length || parts.has(k)) return null
    parts.set(k, v)
  }
  return parts
}

/** Parses any stored preset text; null for anything else (odd legacy rows, free RRULEs). */
export function parseClassRule(rule: string | null | undefined): ClassRule | null {
  const parts = splitRule(rule)
  if (!parts) return null
  const only = (...allowed: string[]) => [...parts.keys()].every((k) => allowed.includes(k))
  const freq = parts.get('FREQ')
  if (freq === 'DAILY') return only('FREQ', 'COUNT') && parts.get('COUNT') === '1' ? { kind: 'once' } : null
  if (freq === 'WEEKLY') {
    if (!only('FREQ', 'INTERVAL', 'BYDAY')) return null
    const codes = (parts.get('BYDAY') ?? '').split(',')
    const days = codes.map((c) => DAY_CODES.indexOf(c as (typeof DAY_CODES)[number]) + 1)
    if (!days.length || days.some((d) => d < 1) || new Set(days).size !== days.length) return null
    const raw = parts.get('INTERVAL')
    if (raw !== undefined && !/^\d+$/.test(raw)) return null
    const interval = raw === undefined ? 1 : Number(raw)
    if (!isInterval(interval)) return null
    return { kind: 'weekly', weekdays: days.sort((a, b) => a - b), interval }
  }
  if (freq === 'MONTHLY') {
    if (!only('FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY')) return null
    if (parts.has('INTERVAL') && parts.get('INTERVAL') !== '1') return null
    if (parts.has('BYDAY') === parts.has('BYMONTHDAY')) return null
    if (parts.has('BYMONTHDAY')) {
      const raw = parts.get('BYMONTHDAY') as string
      const day = Number(raw)
      return /^\d{1,2}$/.test(raw) && day >= 1 && day <= 31 ? { kind: 'monthlyDay', day } : null
    }
    const m = /^(1|2|3|4|-1)(MO|TU|WE|TH|FR|SA|SU)$/.exec(parts.get('BYDAY') as string)
    return m
      ? {
          kind: 'monthlyWeekday',
          ordinal: Number(m[1]) as Ordinal,
          weekday: DAY_CODES.indexOf(m[2] as (typeof DAY_CODES)[number]) + 1,
        }
      : null
  }
  return null
}

/** The stored text of a preset. Throws ScheduleError('invalid') for a value outside the presets. */
export function formatClassRule(rule: ClassRule): string {
  switch (rule.kind) {
    case 'once':
      return ONCE_RULE
    case 'weekly': {
      const days = [...new Set(rule.weekdays)].sort((a, b) => a - b)
      if (!days.length || !days.every(isWeekday)) throw new ScheduleError('invalid', 'The weekday is not valid.')
      if (!isInterval(rule.interval)) throw new ScheduleError('invalid', 'The interval is not valid.')
      return `FREQ=WEEKLY;INTERVAL=${rule.interval};BYDAY=${days.map((d) => DAY_CODES[d - 1]).join(',')}`
    }
    case 'monthlyWeekday':
      if (!isWeekday(rule.weekday) || !ORDINALS.includes(rule.ordinal)) throw new ScheduleError('invalid', 'The weekday is not valid.')
      return `FREQ=MONTHLY;BYDAY=${rule.ordinal}${DAY_CODES[rule.weekday - 1]}`
    case 'monthlyDay':
      if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) throw new ScheduleError('invalid', 'The day of the month is not valid.')
      return `FREQ=MONTHLY;BYMONTHDAY=${rule.day}`
    default:
      throw new ScheduleError('invalid', 'The repeat is not valid.')
  }
}

/** A rule from untrusted input (a request body): the cleaned preset, or null when it is not one. Never throws. */
export function coerceClassRule(value: unknown): ClassRule | null {
  try {
    return parseClassRule(formatClassRule(value as ClassRule))
  } catch {
    return null
  }
}

/** The weekdays a rule uses: all of them (weekly), the one (monthly weekday), or the weekday of `firstDate` (once / day of month — display only). */
export function ruleWeekdays(rule: ClassRule, firstDate: string | null): number[] {
  if (rule.kind === 'weekly') return [...new Set(rule.weekdays)].sort((a, b) => a - b)
  if (rule.kind === 'monthlyWeekday') return [rule.weekday]
  const n = firstDate ? dayNumber(firstDate) : null
  return [n === null ? 1 : mod(n + 3, 7) + 1]
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1..12

/**
 * Does the rule produce a session on `day` (a day number)? `anchor` is the class's first date: it is "week 0" of
 * an every-N-weeks rule and the one date of "once". It does not exclude days before the anchor otherwise —
 * windows do that.
 */
function ruleHitsDay(rule: ClassRule, day: number, anchor: number): boolean {
  if (rule.kind === 'once') return day === anchor
  const weekday = mod(day + 3, 7) + 1
  if (rule.kind === 'weekly') {
    if (!rule.weekdays.includes(weekday)) return false
    const weekStart = (d: number) => d - mod(d + 3, 7)
    return mod(Math.floor((weekStart(day) - weekStart(anchor)) / 7), rule.interval) === 0
  }
  const date = new Date(day * 86_400_000)
  const dom = date.getUTCDate()
  if (rule.kind === 'monthlyDay') return dom === rule.day
  if (weekday !== rule.weekday) return false
  if (rule.ordinal === -1) return dom + 7 > daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)
  return Math.ceil(dom / 7) === rule.ordinal
}

/** Does the rule produce a session on this 'YYYY-MM-DD' (ignoring closures, terms and single-date edits)? False for a bad date. */
export function ruleOccursOn(rule: ClassRule, date: string, anchor: string): boolean {
  const d = dayNumber(date)
  const a = dayNumber(anchor)
  return d !== null && a !== null && ruleHitsDay(rule, d, a)
}

/** Searches this many days for the next / previous date of a rule (a "day 31" rule needs up to ~3 months, a 52-week one a year). */
const SEARCH_DAYS = 800

/** First date on/after `date` the rule produces (anchor = the class's first date), or null within the search window. */
export function nextRuleDate(rule: ClassRule, date: string, anchor: string): string | null {
  const d = dayNumber(date)
  const a = dayNumber(anchor)
  if (d === null || a === null) return null
  for (let i = 0; i <= SEARCH_DAYS; i++) if (ruleHitsDay(rule, d + i, a)) return dateOfDay(d + i)
  return null
}

/**
 * The first date on/after `from` a class with this rule can START on (the first session is its anchor, so every
 * weekday / day of the month the rule names qualifies; "once" is any date). Null within the search window.
 */
export function nextStartDate(rule: ClassRule, from: string): string | null {
  const d = dayNumber(from)
  if (d === null) return null
  for (let i = 0; i <= SEARCH_DAYS; i++) if (ruleHitsDay(rule, d + i, d + i)) return dateOfDay(d + i)
  return null
}

/** Last date on/before `date` the rule produces, or null within the search window. */
export function previousRuleDate(rule: ClassRule, date: string, anchor: string): string | null {
  const d = dayNumber(date)
  const a = dayNumber(anchor)
  if (d === null || a === null) return null
  for (let i = 0; i <= SEARCH_DAYS; i++) if (ruleHitsDay(rule, d - i, a)) return dateOfDay(d - i)
  return null
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

export type ExpandRuleInput = {
  rule: ClassRule
  startTime: string
  endTime: string | null
  timeZone: string
  /** First / last date to consider, inclusive ('YYYY-MM-DD'). */
  from: string
  until: string
  /** The class's first date: "week 0" of an every-N-weeks rule, the one date of "once". */
  anchor: string
  /** Holidays: dates inside any range generate no session (inclusive). */
  closures?: readonly DateRange[]
}

/** Never scans more days than this in one expansion (400 sessions of an every-52-weeks rule fit). */
const MAX_SCAN_DAYS = 150_000

/**
 * The sessions of a class between `from` and `until` (inclusive), minus closures. `until` before `from` gives
 * nothing. Invalid input throws ScheduleError('invalid'). Never examines more than MAX_EXPANDED_SESSIONS dates.
 * Local times follow ADR-032 (see the header); the key `originalStartLocal` is the date and the rule's own time.
 */
export function expandRule(input: ExpandRuleInput): ExpandWeeklyResult {
  const invalid = (what: string) => new ScheduleError('invalid', `The ${what} is not valid.`)
  formatClassRule(input.rule) // validates the rule
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

  const out: ExpandWeeklyResult = {
    sessions: [],
    closed: [],
    truncated: false,
  }
  if (until < from) return out

  // "Once" is a single date: no scan needed.
  const last = input.rule.kind === 'once' ? Math.min(until, anchor) : until
  const first = input.rule.kind === 'once' ? Math.max(from, anchor) : from
  let examined = 0
  for (let day = first; day <= last; day++) {
    if (day - first > MAX_SCAN_DAYS) {
      out.truncated = true
      break
    }
    if (!ruleHitsDay(input.rule, day, anchor)) continue
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
    out.sessions.push({
      originalStartLocal,
      startLocal: times.startLocal,
      endLocal: times.endLocal,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
    })
  }
  return out
}

/** The sessions of a class that repeats on ONE weekday every N weeks — `expandRule` with a weekly rule. */
export function expandWeekly(input: ExpandWeeklyInput): ExpandWeeklyResult {
  if (!isWeekday(input.weekday)) throw new ScheduleError('invalid', 'The weekday is not valid.')
  if (!isInterval(input.interval)) throw new ScheduleError('invalid', 'The interval is not valid.')
  const { weekday, interval, ...rest } = input
  return expandRule({
    ...rest,
    endTime: input.endTime,
    rule: { kind: 'weekly', weekdays: [weekday], interval },
  })
}
