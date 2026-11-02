// ── Catalogue commerce — weekly windows (interval arithmetic only) ────────────
//
// Authority: ADR-033 A1 (overnight intervals), A8 (division of labour);
// contract C2-C5-C10 §0 (Rev 4, "Naming"): under K-3 a weekly window no longer
// expresses availability — it is the interval arithmetic shared by PRICE
// windows (C4) and AVAILABILITY schedules (C5a). They share arithmetic, never
// meaning: nothing here knows what a window is for.
//
// Renamed from availability.ts (which keeps deprecated re-exports until R3):
//   AvailabilityRule  → WeeklyWindow
//   AvailabilityState → WindowState ('inWindow' | 'outsideWindow')
//   evaluate          → evaluateWindows
//   rulesOverlap      → windowsOverlap
//   ruleIssues        → windowIssues
//
// Semantics carried over UNCHANGED (A1, A8): `days` names the day an interval
// STARTS; `to <= from` is overnight into the next day; Sunday wraps into
// Monday; intervals are half-open; both times absent = all day; no days = every
// day; an empty window LIST = always. Wall-clock evaluation in an explicit IANA
// zone via src/lib/lifecycle/time.ts — the zone is a required argument with no
// default (never the machine's).

import { utcToLocal } from '@/lib/lifecycle/time'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type WeeklyWindow = {
  /** Empty or absent means every day. Names the day the interval STARTS. */
  days?: readonly string[]
  /** "HH:mm". Both absent means all day. */
  from?: string | null
  to?: string | null
}

export type WindowState = 'inWindow' | 'outsideWindow'

/** A half-open range of minutes on the notional week [0, 10080). */
export type WeekRange = { start: number; end: number }

export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7

/** "19:30" → 1170. Returns null for anything that is not HH:mm. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  if (typeof hhmm !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 1170 → "19:30" (minutes within a day; 1440 → "00:00"). */
export function hhmmOf(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Weekday of a local 'YYYY-MM-DD'. Built with Date.UTC on the date parts: the
 * weekday of a calendar date is a property of the date, and constructing it at
 * UTC midnight cannot drift across a boundary the way a local constructor would.
 */
export function weekdayOf(localDate: string): Weekday {
  const [y, m, d] = localDate.split('-').map(Number)
  const js = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay() // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7]
}

/** Where an instant falls in the tenant's week: which day, and how far into it. */
export function localPosition(instant: Date | string, timeZone: string): { day: Weekday; minutes: number; localDate: string } {
  const iso = typeof instant === 'string' ? instant : instant.toISOString()
  const local = utcToLocal(iso, timeZone) // 'YYYY-MM-DDTHH:mm'
  const [localDate, localTime] = local.split('T')
  const [h, min] = localTime.split(':').map(Number)
  return { day: weekdayOf(localDate), minutes: h * 60 + min, localDate }
}

/** The wall-clock minute of the week (Mon 00:00 = 0) of an instant in `timeZone`. */
export function weekMinuteOf(instant: Date | string, timeZone: string): number {
  const { day, minutes } = localPosition(instant, timeZone)
  return WEEKDAYS.indexOf(day) * MINUTES_PER_DAY + minutes
}

/**
 * A window as absolute minute ranges on a notional week, 0 … 10080. A Friday
 * 18:00–02:00 window becomes one range running past the end of Friday; a Sunday
 * one wraps past the end of the week and is split in two, so every range is a
 * plain half-open interval. An invalid window (malformed time, from === to)
 * yields no ranges: validation reports those; evaluation stays total.
 */
export function windowRanges(window: WeeklyWindow): WeekRange[] {
  const days = window.days && window.days.length > 0 ? WEEKDAYS.filter((d) => window.days!.includes(d)) : WEEKDAYS

  const from = minutesOf(window.from)
  const to = minutesOf(window.to)
  const allDay = from === null && to === null
  if (!allDay && (from === null || to === null || from === to)) return []

  const out: WeekRange[] = []
  for (const day of days) {
    const base = WEEKDAYS.indexOf(day) * MINUTES_PER_DAY
    const start = base + (allDay ? 0 : from!)
    const end = base + (allDay ? MINUTES_PER_DAY : to! > from! ? to! : to! + MINUTES_PER_DAY)
    if (end <= MINUTES_PER_WEEK) {
      out.push({ start, end })
    } else {
      // Wraps past Sunday midnight into Monday.
      out.push({ start, end: MINUTES_PER_WEEK })
      out.push({ start: 0, end: end - MINUTES_PER_WEEK })
    }
  }
  return out
}

export const inRange = (point: number, r: WeekRange) => point >= r.start && point < r.end

/** Is this window in force at this instant? Half-open: a window ending at 22:00 is over at 22:00. */
export function windowApplies(window: WeeklyWindow, instant: Date | string, timeZone: string): boolean {
  const point = weekMinuteOf(instant, timeZone)
  return windowRanges(window).some((r) => inRange(point, r))
}

/** The ranges a list of windows covers; an empty/absent list = the whole week ("always"). */
export function windowListRanges(windows: readonly WeeklyWindow[] | null | undefined): WeekRange[] {
  return !windows || windows.length === 0 ? [{ start: 0, end: MINUTES_PER_WEEK }] : windows.flatMap(windowRanges)
}

/** NO WINDOWS MEANS ALWAYS: an empty list is "whenever", never "never". */
export function evaluateWindows(windows: readonly WeeklyWindow[] | null | undefined, instant: Date | string, timeZone: string): WindowState {
  if (!windows || windows.length === 0) return 'inWindow'
  return windows.some((w) => windowApplies(w, instant, timeZone)) ? 'inWindow' : 'outsideWindow'
}

/** Do two window lists ever both apply? Static, instant-free; empty lists mean "always". */
export function windowsOverlap(a: readonly WeeklyWindow[] | null | undefined, b: readonly WeeklyWindow[] | null | undefined): boolean {
  return rangesOverlap(windowListRanges(a), windowListRanges(b))
}

export function rangesOverlap(a: readonly WeekRange[], b: readonly WeekRange[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end))
}

export type WindowIssue =
  | { kind: 'invalidTime'; value: string }
  | { kind: 'zeroLengthWindow'; from: string }
  | { kind: 'unknownDay'; value: string }
  | { kind: 'incompleteWindow' }

/** What is wrong with one window, for save-time validation. */
export function windowIssues(window: WeeklyWindow): WindowIssue[] {
  const issues: WindowIssue[] = []
  for (const d of window.days ?? []) {
    if (!WEEKDAYS.includes(d as Weekday)) issues.push({ kind: 'unknownDay', value: d })
  }
  const hasFrom = typeof window.from === 'string' && window.from !== ''
  const hasTo = typeof window.to === 'string' && window.to !== ''
  if (hasFrom && minutesOf(window.from) === null) issues.push({ kind: 'invalidTime', value: window.from! })
  if (hasTo && minutesOf(window.to) === null) issues.push({ kind: 'invalidTime', value: window.to! })
  if (hasFrom !== hasTo) issues.push({ kind: 'incompleteWindow' })
  if (hasFrom && hasTo && window.from === window.to) issues.push({ kind: 'zeroLengthWindow', from: window.from! })
  return issues
}
