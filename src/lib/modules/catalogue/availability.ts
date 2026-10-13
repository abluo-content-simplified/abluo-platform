// ── Catalogue — availability ──────────────────────────────────────────────────
//
// Authority: ADR-033 A1 (overnight intervals) and A8 (division of labour).
//
// This module answers ONE question: at this instant, in this timezone, do these
// rules say the thing is available? It returns exactly two values.
//
//   available | outOfHours
//
// It does not know whether something is published, archived, sold on a channel,
// or ambiguous. Publication belongs to ADR-032's deriveStatus(); "not sold" and
// "ambiguous" belong to the offer resolver. Keeping those three vocabularies
// apart is what stops "not visible" becoming a word that means four things.
//
// TIMEZONE AND DST ARE NOT OURS. src/lib/lifecycle/time.ts owns the conversion
// and its exact | gap | overlap resolution; this module owns interval and
// wrap-around semantics and composes it. Two implementations of timezone
// arithmetic is how two of them drift apart.
//
// THE ZONE IS A REQUIRED ARGUMENT WITH NO DEFAULT. A default would be the
// machine's, which is the server's, which is nobody's. An invisible default is
// the kind that survives review precisely because it never appears in a diff.

import { utcToLocal } from '@/lib/lifecycle/time'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type AvailabilityRule = {
  /** Empty or absent means every day. Names the day the interval STARTS. */
  days?: readonly string[]
  /** "HH:mm". Both absent means all day. */
  from?: string | null
  to?: string | null
}

export type AvailabilityState = 'available' | 'outOfHours'

export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7

/** "19:30" → 1170. Returns null for anything that is not HH:mm. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  if (typeof hhmm !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Weekday of a local 'YYYY-MM-DD'.
 *
 * Built with Date.UTC on the date parts, which is safe precisely because it
 * ignores zones: the weekday of a calendar date is a property of the date, and
 * constructing it at UTC midnight cannot drift across a boundary the way a
 * local-time constructor would.
 */
export function weekdayOf(localDate: string): Weekday {
  const [y, m, d] = localDate.split('-').map(Number)
  const js = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay() // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7]
}

/** Where an instant falls in the tenant's week: which day, and how far into it. */
export function localPosition(
  instant: Date | string,
  timeZone: string,
): { day: Weekday; minutes: number; localDate: string } {
  const iso = typeof instant === 'string' ? instant : instant.toISOString()
  const local = utcToLocal(iso, timeZone) // 'YYYY-MM-DDTHH:mm'
  const [localDate, localTime] = local.split('T')
  const [h, min] = localTime.split(':').map(Number)
  return { day: weekdayOf(localDate), minutes: h * 60 + min, localDate }
}

/**
 * A rule as absolute minute ranges on a notional week, 0 … 10080.
 *
 * This is the representation that makes wrap-around tractable. A Friday
 * 18:00–02:00 rule becomes one range that runs past the end of Friday into
 * Saturday; a Sunday one wraps past the end of the week and is split in two, so
 * every range returned is a plain half-open interval that can be compared
 * arithmetically.
 *
 * An invalid rule — a malformed time, or from === to, which matches nothing —
 * yields no ranges rather than throwing. Validation reports those; evaluation
 * must stay total.
 */
export function ruleRanges(rule: AvailabilityRule): { start: number; end: number }[] {
  const days =
    rule.days && rule.days.length > 0
      ? WEEKDAYS.filter((d) => rule.days!.includes(d))
      : WEEKDAYS

  const from = minutesOf(rule.from)
  const to = minutesOf(rule.to)
  const allDay = from === null && to === null
  if (!allDay && (from === null || to === null || from === to)) return []

  const out: { start: number; end: number }[] = []
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

const inRange = (point: number, r: { start: number; end: number }) => point >= r.start && point < r.end

/**
 * Is this rule in force at this instant?
 *
 * Half-open: a rule ending at 22:00 is over at 22:00, not still running. Two
 * adjacent rules therefore meet without overlapping, which is what lets the
 * overlap check below treat touching intervals as disjoint.
 */
export function ruleApplies(rule: AvailabilityRule, instant: Date | string, timeZone: string): boolean {
  const { day, minutes } = localPosition(instant, timeZone)
  const point = WEEKDAYS.indexOf(day) * MINUTES_PER_DAY + minutes
  return ruleRanges(rule).some((r) => inRange(point, r))
}

/**
 * The state of a set of rules at an instant.
 *
 * NO RULES MEANS AVAILABLE. An empty array is "whenever the site is live", not
 * "never" — the common case for a tenant who has not thought about hours, and
 * the one it would be perverse to read as a closed door.
 */
export function evaluate(
  rules: readonly AvailabilityRule[] | null | undefined,
  instant: Date | string,
  timeZone: string,
): AvailabilityState {
  if (!rules || rules.length === 0) return 'available'
  return rules.some((r) => ruleApplies(r, instant, timeZone)) ? 'available' : 'outOfHours'
}

/**
 * Do two sets of rules ever both apply?
 *
 * Used by validation to prove two offers in one scope are disjoint, statically,
 * without reference to any particular instant — which is what makes a runtime
 * ambiguity unreachable through the editor.
 *
 * Empty rules mean "always", so an empty set overlaps anything non-empty, and
 * two empty sets overlap each other.
 */
export function rulesOverlap(
  a: readonly AvailabilityRule[] | null | undefined,
  b: readonly AvailabilityRule[] | null | undefined,
): boolean {
  const ra = !a || a.length === 0 ? [{ start: 0, end: MINUTES_PER_WEEK }] : a.flatMap(ruleRanges)
  const rb = !b || b.length === 0 ? [{ start: 0, end: MINUTES_PER_WEEK }] : b.flatMap(ruleRanges)
  return ra.some((x) => rb.some((y) => x.start < y.end && y.start < x.end))
}

export type AvailabilityIssue =
  | { kind: 'invalidTime'; value: string }
  | { kind: 'zeroLengthWindow'; from: string }
  | { kind: 'unknownDay'; value: string }
  | { kind: 'incompleteWindow' }

/** What is wrong with a rule, for save-time validation. */
export function ruleIssues(rule: AvailabilityRule): AvailabilityIssue[] {
  const issues: AvailabilityIssue[] = []
  for (const d of rule.days ?? []) {
    if (!WEEKDAYS.includes(d as Weekday)) issues.push({ kind: 'unknownDay', value: d })
  }
  const hasFrom = typeof rule.from === 'string' && rule.from !== ''
  const hasTo = typeof rule.to === 'string' && rule.to !== ''
  if (hasFrom && minutesOf(rule.from) === null) issues.push({ kind: 'invalidTime', value: rule.from! })
  if (hasTo && minutesOf(rule.to) === null) issues.push({ kind: 'invalidTime', value: rule.to! })
  if (hasFrom !== hasTo) issues.push({ kind: 'incompleteWindow' })
  if (hasFrom && hasTo && rule.from === rule.to) {
    issues.push({ kind: 'zeroLengthWindow', from: rule.from! })
  }
  return issues
}
