// ── Catalogue commerce — availability rules and weekly schedules (C5a) ────────
//
// Authority: contract C2-C5-C10 §C5a (Rev 4); Tom D-6 (2026-11-02).
//
// A rule = a BASELINE state + optional weekly scheduled overrides. One rule is
// ever evaluated per (format, channel) — replace, never merge (D-6.1) — so
// nothing here combines rules; channel-availability.ts picks the rule.
//
// Time: wall-clock evaluation in an explicit IANA zone, reusing the window
// arithmetic of windows.ts (A1 overnight + week wrap, half-open) and the zone
// conversion of lifecycle/time.ts (A8). DST: at fall-back an override covering
// the repeated hour applies in both occurrences; at spring-forward minutes that
// do not exist never apply. The zone is REQUIRED; a malformed zone throws a
// typed error, never guesses (and never the machine zone).
//
// Price windows are NOT read here (D-6 independence): availability schedules
// and price windows share arithmetic, never meaning.

import {
  MINUTES_PER_DAY,
  MINUTES_PER_WEEK,
  WEEKDAYS,
  inRange,
  rangesOverlap,
  weekMinuteOf,
  windowIssues,
  windowRanges,
  type WeekRange,
  type Weekday,
} from './windows'
import { zoneOffsetMinutes } from '@/lib/lifecycle/time'
import {
  OVERRIDES_PER_RULE_LIMIT,
  isChannelAvailabilityState,
  type AvailabilityIssueCode,
  type ChannelAvailabilityRule,
  type ChannelAvailabilityState,
  type IssueLevel,
  type ScheduledOverride,
  type WeekProfile,
  type WeeklyOverride,
} from './commerce-types'

export type { ChannelAvailabilityRule, ScheduledOverride, WeekProfile, WeeklyOverride } from './commerce-types'

/** Stored member type names of `schedule[]` — the discriminator (C5a-2). */
export const WEEKLY_OVERRIDE_TYPE = 'catalogueWeeklyOverride'

const MINUTE = 60_000
const DAY = MINUTES_PER_DAY * MINUTE
/** "A weekly rule that has not changed in 8 days never changes" (C5a-4). */
const HORIZON = 8 * DAY

export class AvailabilityTimeZoneError extends Error {
  readonly code = 'availability.timeZoneInvalid'
  constructor(readonly timeZone: string) {
    super(`Not a valid IANA time zone: ${JSON.stringify(timeZone)}`)
  }
}

function assertZone(timeZone: string): void {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') throw new AvailabilityTimeZoneError(String(timeZone))
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw new AvailabilityTimeZoneError(timeZone)
  }
}

// ── Reading stored rows ───────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Stored `schedule[]` / `defaultSchedule[]` → overrides. Total, never throws.
 * Members of an unknown `_type` are reported and NEVER evaluated; a member with
 * an unknown day or an invalid state is reported and dropped (an unknown day
 * silently filtered could turn "only Fridays" into "every day").
 */
export function readSchedule(raw: unknown): { overrides: ScheduledOverride[]; issues: AvailabilityIssueCode[] } {
  const overrides: ScheduledOverride[] = []
  const issues: AvailabilityIssueCode[] = []
  if (!Array.isArray(raw)) return { overrides, issues }
  raw.forEach((m, i) => {
    if (!m || typeof m !== 'object') return
    const o = m as Record<string, unknown>
    const type = o._type
    if (type !== undefined && type !== WEEKLY_OVERRIDE_TYPE) {
      issues.push('availability.scheduleUnknownKind')
      return
    }
    if (!isChannelAvailabilityState(o.state)) {
      issues.push('availability.stateInvalid')
      return
    }
    const rawDays = Array.isArray(o.days) ? o.days : []
    if (rawDays.some((d) => !WEEKDAYS.includes(d as Weekday))) {
      issues.push('availability.scheduleUnknownDay')
      return
    }
    overrides.push({
      kind: 'weekly',
      key: str(o._key) ?? `s${i}`,
      days: WEEKDAYS.filter((d) => rawDays.includes(d)),
      from: str(o.from),
      to: str(o.to),
      state: o.state,
    })
  })
  return { overrides, issues }
}

/** Normalise a stored `catalogueChannelRule` row (any level) → rule. Total, never throws. */
export function readChannelRule(row: unknown): { rule: ChannelAvailabilityRule | null; issues: AvailabilityIssueCode[] } {
  if (!row || typeof row !== 'object') return { rule: null, issues: ['availability.stateInvalid'] }
  const r = row as Record<string, unknown>
  if (!isChannelAvailabilityState(r.state)) return { rule: null, issues: ['availability.stateInvalid'] }
  const { overrides, issues } = readSchedule(r.schedule)
  return { rule: { state: r.state, overrides }, issues }
}

// ── Instant-free ──────────────────────────────────────────────────────────────

export function overrideRanges(o: ScheduledOverride): WeekRange[] {
  return windowRanges({ days: o.days, from: o.from, to: o.to })
}

/** The state at a wall-clock minute of the week, and the override in force (first in stored order wins on invalid overlap). */
export function stateAtMinute(rule: ChannelAvailabilityRule, minute: number): { state: ChannelAvailabilityState; override: ScheduledOverride | null } {
  for (const o of rule.overrides) {
    if (overrideRanges(o).some((r) => inRange(minute, r))) return { state: o.state, override: o }
  }
  return { state: rule.state, override: null }
}

/** Instant-free weekly profile (wall clock): merged, sorted, covering [0, 10080). */
export function weekProfile(rule: ChannelAvailabilityRule): WeekProfile {
  const cuts = new Set<number>([0, MINUTES_PER_WEEK])
  for (const o of rule.overrides) for (const r of overrideRanges(o)) cuts.add(r.start).add(r.end)
  const points = [...cuts].sort((a, b) => a - b)
  const out: { start: number; end: number; state: ChannelAvailabilityState }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const state = stateAtMinute(rule, points[i]).state
    const last = out[out.length - 1]
    if (last && last.state === state) last.end = points[i + 1]
    else out.push({ start: points[i], end: points[i + 1], state })
  }
  return out
}

/** The state of a profile at a minute of the week. */
export function profileStateAt(profile: WeekProfile, minute: number): ChannelAvailabilityState {
  const m = ((minute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
  return profile.find((p) => m >= p.start && m < p.end)?.state ?? 'unavailable'
}

/** Minutes of the week at which the profile is available. */
export function availableMinutes(profile: WeekProfile): number {
  return profile.reduce((n, p) => n + (p.state === 'available' ? p.end - p.start : 0), 0)
}

/** True when the rule is available at some minute of the week (instant-free). */
export function availableSometime(rule: ChannelAvailabilityRule): boolean {
  return weekProfile(rule).some((p) => p.state === 'available')
}

/** A rule whose weekProfile equals `profile` (baseline unavailable + one weekly override per available day-chunk). */
export function ruleFromProfile(profile: WeekProfile, keyPrefix = 'p'): ChannelAvailabilityRule {
  if (profile.length === 1) return { state: profile[0].state, overrides: [] }
  const overrides: WeeklyOverride[] = []
  for (const p of profile) {
    if (p.state !== 'available') continue
    let s = p.start
    while (s < p.end) {
      const dayIndex = Math.floor(s / MINUTES_PER_DAY)
      const dayEnd = (dayIndex + 1) * MINUTES_PER_DAY
      const e = Math.min(p.end, dayEnd)
      const fullDay = s === dayIndex * MINUTES_PER_DAY && e === dayEnd
      overrides.push({
        kind: 'weekly',
        key: `${keyPrefix}${overrides.length}`,
        days: [WEEKDAYS[dayIndex]],
        from: fullDay ? null : hhmm(s),
        to: fullDay ? null : hhmm(e),
        state: 'available',
      })
      s = e
    }
  }
  return { state: 'unavailable', overrides }
}

const hhmm = (minuteOfWeek: number) => {
  const m = minuteOfWeek % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Union of profiles: available wherever any is available. [] → constant unavailable. */
export function unionProfile(profiles: readonly WeekProfile[]): WeekProfile {
  const cuts = new Set<number>([0, MINUTES_PER_WEEK])
  for (const p of profiles) for (const r of p) cuts.add(r.start).add(r.end)
  const points = [...cuts].sort((a, b) => a - b)
  const out: { start: number; end: number; state: ChannelAvailabilityState }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const state: ChannelAvailabilityState = profiles.some((p) => profileStateAt(p, points[i]) === 'available') ? 'available' : 'unavailable'
    const last = out[out.length - 1]
    if (last && last.state === state) last.end = points[i + 1]
    else out.push({ start: points[i], end: points[i + 1], state })
  }
  return out
}

export type ScheduleIssue = { code: AvailabilityIssueCode; level: IssueLevel; keys?: string[] }

/** Save-time validation of one rule (C5a-1, C5-10). Rows are read with readChannelRule first. */
export function scheduleIssues(rule: ChannelAvailabilityRule): ScheduleIssue[] {
  const out: ScheduleIssue[] = []
  if (rule.overrides.length > OVERRIDES_PER_RULE_LIMIT) out.push({ code: 'availability.scheduleLimitExceeded', level: 'error' })
  for (const o of rule.overrides) {
    if (!isChannelAvailabilityState(o.state)) out.push({ code: 'availability.stateInvalid', level: 'error', keys: [o.key] })
    for (const w of windowIssues({ days: o.days, from: o.from, to: o.to })) {
      const code: AvailabilityIssueCode =
        w.kind === 'invalidTime'
          ? 'availability.scheduleInvalidTime'
          : w.kind === 'incompleteWindow'
            ? 'availability.scheduleIncomplete'
            : w.kind === 'zeroLengthWindow'
              ? 'availability.scheduleZeroLength'
              : 'availability.scheduleUnknownDay'
      out.push({ code, level: 'error', keys: [o.key] })
    }
    if (o.state === rule.state) out.push({ code: 'availability.scheduleRedundant', level: 'warning', keys: [o.key] })
  }
  for (let i = 0; i < rule.overrides.length; i++) {
    for (let j = i + 1; j < rule.overrides.length; j++) {
      const a = rule.overrides[i]
      const b = rule.overrides[j]
      if (rangesOverlap(overrideRanges(a), overrideRanges(b))) out.push({ code: 'availability.scheduleOverlap', level: 'error', keys: [a.key, b.key] })
    }
  }
  return out
}

// ── At an instant ─────────────────────────────────────────────────────────────

/** State at an instant. `timeZone` is REQUIRED (no default, A8). */
export function evaluateRule(rule: ChannelAvailabilityRule, at: Date, timeZone: string): { state: ChannelAvailabilityState; activeOverride: ScheduledOverride | null } {
  assertZone(timeZone)
  const { state, override } = stateAtMinute(rule, weekMinuteOf(at, timeZone))
  return { state, activeOverride: override }
}

/** Constant-offset stretches of UTC time in `timeZone` between two instants (DST transitions split them). */
function offsetSegments(fromMs: number, toMs: number, timeZone: string): { start: number; end: number }[] {
  const STEP = 6 * 60 * MINUTE
  const segments: { start: number; end: number }[] = []
  let segStart = fromMs
  let prevT = fromMs
  let prevOffset = zoneOffsetMinutes(fromMs, timeZone)
  for (let t = fromMs + STEP; ; t += STEP) {
    const probe = Math.min(t, toMs)
    const off = zoneOffsetMinutes(probe, timeZone)
    if (off !== prevOffset) {
      // Binary search the first minute with the new offset in (prevT, probe].
      let lo = Math.floor(prevT / MINUTE) * MINUTE
      let hi = Math.ceil(probe / MINUTE) * MINUTE
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE
        if (zoneOffsetMinutes(mid, timeZone) === prevOffset) lo = mid
        else hi = mid
      }
      segments.push({ start: segStart, end: hi })
      segStart = hi
      prevOffset = off
    }
    prevT = probe
    if (probe >= toMs) break
  }
  segments.push({ start: segStart, end: toMs })
  return segments
}

/**
 * The first instant t > at at which `valueAt(weekMinute(t))` differs from its
 * value at `at`, or null within the 8-day horizon. `points` are the week
 * minutes at which the value can change. Exact under DST: within a
 * constant-offset stretch wall time is linear in UTC; each stretch boundary is
 * checked on its own (a DST jump can itself be the transition).
 */
function nextChange(valueAt: (minute: number) => string, points: readonly number[], at: Date, timeZone: string): Date | null {
  const atMs = at.getTime()
  const cur = valueAt(weekMinuteOf(at, timeZone))
  const sorted = [...new Set(points.map((p) => ((p % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK))].sort((a, b) => a - b)
  const segments = offsetSegments(atMs, atMs + HORIZON, timeZone)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (i > 0 && valueAt(weekMinuteOf(new Date(seg.start), timeZone)) !== cur) return new Date(seg.start)
    if (sorted.length === 0) continue
    const baseMinute = Math.floor(seg.start / MINUTE)
    const wm0 = weekMinuteOf(new Date(baseMinute * MINUTE), timeZone)
    // Walk the change points in increasing order after wm0 (two laps cover the 8-day horizon), until the stretch ends.
    let stop = false
    for (let lap = 0; lap < 3 && !stop; lap++) {
      for (const p of sorted) {
        const P = p + lap * MINUTES_PER_WEEK
        if (P <= wm0) continue
        const candidate = (baseMinute + (P - wm0)) * MINUTE
        if (candidate >= seg.end || candidate > atMs + HORIZON) {
          stop = true
          break
        }
        if (candidate > atMs && valueAt(p) !== cur) return new Date(candidate)
      }
    }
  }
  return null
}

function profileChangePoints(profile: WeekProfile): number[] {
  if (profile.length <= 1) return []
  const pts = profile.map((p) => p.start)
  // The week wrap is a change only when Sunday's last state differs from Monday's first.
  if (profile[0].state === profile[profile.length - 1].state) return pts.filter((p) => p !== 0)
  return pts
}

/**
 * The earliest instant t' > at such that the state differs from the state at
 * `at` (same wall-clock semantics as evaluateRule). null when the state never
 * changes. Searches at most 8 days ahead; one-minute resolution (C5a-4).
 */
export function nextAvailabilityTransition(rule: ChannelAvailabilityRule, at: Date, timeZone: string): Date | null {
  assertZone(timeZone)
  const profile = weekProfile(rule)
  const points = profileChangePoints(profile)
  if (points.length === 0) return null
  return nextChange((m) => profileStateAt(profile, m), points, at, timeZone)
}

/** When the override in force at `at` stops applying (null when it covers the whole week). */
export function overrideEndsAt(rule: ChannelAvailabilityRule, override: ScheduledOverride, at: Date, timeZone: string): Date | null {
  assertZone(timeZone)
  const ranges = overrideRanges(override)
  const points = ranges.flatMap((r) => [r.start, r.end])
  return nextChange((m) => (stateAtMinute(rule, ((m % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK).override?.key === override.key ? 'in' : 'out'), points, at, timeZone)
}

/** The one result shape any "available now" claim must carry (C5a-4). */
export type AvailableNow =
  | { kind: 'known'; state: ChannelAvailabilityState; evaluatedAt: Date; timeZone: string; validUntil: Date | null }
  | { kind: 'scheduleOnly'; reason: 'timeZoneMissing' | 'cannotGuaranteeFreshness'; profile: WeekProfile }

// `availableNow(inputs, item, formatKey, ctx, at, timeZone)` composes the C5
// precedence, so it lives in channel-availability.ts (it is re-exported from
// the commerce barrel with the type above).

/** For tests and diagnostics: the day-of-week index of a week minute. */
export const dayOfWeekMinute = (m: number) => WEEKDAYS[Math.floor((((m % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK) / MINUTES_PER_DAY)]
