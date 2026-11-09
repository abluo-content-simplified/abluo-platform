// ── Courses module — what the dashboard's Courses list says about each course ──
//
// Pure helpers (no React, no I/O), unit-tested in
// src/lib/modules/courses/__tests__/list-overview.test.ts. The server
// (`courseScheduleDeps`) collects the facts per course — weekly classes, the
// dates that differ from their class, the last class date — and these turn
// them into what the list shows (Tom, 2026-11-08):
//
//   When         "Mon 12:30 · MERO", the first two, "+N" for the rest
//   Next class   + the nearest change in the next 14 days ("Cancelled Thu 26")
//   Runs until   the last class date; "ends soon" within 14 days
//   Status       ONE pill — the most important — and the rest in a tooltip
//   Needs attention  the strip above the list (term ending, this week's
//                changes, courses without image or description)
//
// Dates are 'YYYY-MM-DD' in the site's time zone; "today" is computed once by
// the caller (`siteToday`) so every helper agrees.

import type { ClassSeries } from '@/lib/scheduling/types'
import { dayNumber, dateOfDay, parseClassRule, previousRuleDate } from '@/lib/scheduling/recurrence'
import type { CourseClassSlot, CourseException, CourseScheduleSummary, CourseState } from '@/lib/api/course-drafts'

// ── Dates ────────────────────────────────────────────────────────────────────

/** Today in `zone` ('YYYY-MM-DD'); the viewer's zone when `zone` is not a valid IANA name. */
export function siteToday(now: Date, zone: string | null | undefined): string {
  const fmt = (timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  try {
    return fmt(zone || undefined)
  } catch {
    return fmt()
  }
}

/** Calendar days from `a` to `b` (negative when b is earlier); null for a bad date. */
export function daysBetween(a: string, b: string): number | null {
  const x = dayNumber(a)
  const y = dayNumber(b)
  return x === null || y === null ? null : y - x
}

/** 'YYYY-MM-DD' plus `n` days ('' for a bad date). */
export function plusDays(date: string, n: number): string {
  const d = dayNumber(date)
  return d === null ? '' : dateOfDay(d + n)
}

/** The Monday-to-Sunday week that contains `today`. */
export function weekOf(today: string): { from: string; to: string } {
  const d = dayNumber(today)
  if (d === null) return { from: today, to: today }
  const weekday = (((d + 3) % 7) + 7) % 7 // 0 = Monday (1970-01-01 was a Thursday)
  return { from: dateOfDay(d - weekday), to: dateOfDay(d - weekday + 6) }
}

// ── Last class date ──────────────────────────────────────────────────────────

/**
 * The last date a class meets: the rule's last date on or before its own last
 * date or its term's end (whichever is earlier). A "once" class meets on its
 * first date. `open` = it repeats with no end (no last date, no term end).
 */
export function seriesLastDate(
  s: Pick<ClassSeries, 'rule' | 'startsOn' | 'endsOn' | 'startLocal'>,
  termEnd: string | null
): { date: string | null; open: boolean } {
  const first = s.startsOn ?? s.startLocal.slice(0, 10)
  const rule = parseClassRule(s.rule)
  if (rule?.kind === 'once') return { date: first, open: false }
  const ends = [s.endsOn, termEnd].filter((d): d is string => !!d && dayNumber(d) !== null)
  if (!ends.length) return { date: null, open: true }
  const end = ends.reduce((a, b) => (a < b ? a : b))
  const last = rule ? previousRuleDate(rule, end, first) : end
  return { date: last && last >= first ? last : null, open: false }
}

// ── When ─────────────────────────────────────────────────────────────────────

/** How many class lines a row shows before "+N". */
export const WHEN_PREVIEW = 2

export type WhenLine = { key: string; weekday: number; time: string; place: string }

/**
 * One line per weekday of every class, Monday first, then by time. `place`
 * names the place token (a location's short name, else its name; '' none) —
 * an online class says "Online" (the caller's word).
 */
export function whenLines(slots: readonly CourseClassSlot[] | undefined, place: (token: string) => string, online: string): WhenLine[] {
  return [...(slots ?? [])]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    .map((s, i) => ({
      key: `${s.seriesId}:${s.weekday}:${i}`,
      weekday: s.weekday,
      time: s.startTime,
      place: s.mode === 'online' ? online : place(s.placeToken) || (s.mode === 'mixed' ? online : ''),
    }))
}

/** The lines a row shows: the first WHEN_PREVIEW, or all when expanded; `more` = how many "+N" hides. */
export function visibleWhen<T>(lines: readonly T[], expanded: boolean): { shown: T[]; more: number } {
  if (expanded || lines.length <= WHEN_PREVIEW) return { shown: [...lines], more: 0 }
  return { shown: lines.slice(0, WHEN_PREVIEW), more: lines.length - WHEN_PREVIEW }
}

/** Only one row is expanded at a time: clicking the open row closes it, another row replaces it. */
export const toggleExpanded = (current: string | null, id: string): string | null => (current === id ? null : id)

// ── Next class: the nearest change ───────────────────────────────────────────

export const EXCEPTION_AHEAD_DAYS = 14

/** The course's nearest date that differs from its class, today included, at most `days` ahead. */
export function nextException(exceptions: readonly CourseException[] | undefined, today: string, days = EXCEPTION_AHEAD_DAYS): CourseException | null {
  const until = plusDays(today, days)
  const ahead = (exceptions ?? []).filter((e) => e.date >= today && e.date <= until)
  ahead.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
  return ahead[0] ?? null
}

// ── This week ────────────────────────────────────────────────────────────────

/** Changed dates of the course in the week (Monday–Sunday): all of them, and how many of those are cancelled. */
export function weekChanges(exceptions: readonly CourseException[] | undefined, week: { from: string; to: string }): { changes: number; cancelled: number } {
  const inWeek = (exceptions ?? []).filter((e) => e.date >= week.from && e.date <= week.to)
  return { changes: inWeek.length, cancelled: inWeek.filter((e) => e.kind === 'cancelled').length }
}

export const changedInWeek = (schedule: CourseScheduleSummary | null | undefined, week: { from: string; to: string }) => weekChanges(schedule?.exceptions, week).changes > 0

// ── Runs until ───────────────────────────────────────────────────────────────

export const ENDS_SOON_DAYS = 14

/** The last class date, and whether it is close (within 14 days, today included; nothing set up after it). */
export function runsUntil(schedule: CourseScheduleSummary | null | undefined, today: string, soonDays = ENDS_SOON_DAYS): { date: string | null; endsSoon: boolean; daysLeft: number | null } {
  if (!schedule || schedule.openEnded || !schedule.lastDate) return { date: null, endsSoon: false, daysLeft: null }
  const daysLeft = daysBetween(today, schedule.lastDate)
  return { date: schedule.lastDate, endsSoon: daysLeft !== null && daysLeft >= 0 && daysLeft <= soonDays, daysLeft }
}

// ── Status ───────────────────────────────────────────────────────────────────

export type CourseStatusItem =
  | { kind: 'archived' }
  | { kind: 'draft' }
  | { kind: 'scheduled'; at: string | null }
  | { kind: 'unpublished' }
  | { kind: 'noClasses' }
  | { kind: 'noAddress' }
  | { kind: 'endsSoon'; days: number }
  | { kind: 'missing'; languages: string[] }
  | { kind: 'unpublishOn'; at: string }
  | { kind: 'changes' }
  | { kind: 'live' }

export type CourseStatusTone = 'success' | 'warning' | 'highlight' | 'outline' | 'muted'

export const STATUS_TONE: Record<CourseStatusItem['kind'], CourseStatusTone> = {
  archived: 'muted',
  draft: 'outline',
  scheduled: 'highlight',
  unpublished: 'muted',
  noClasses: 'warning',
  noAddress: 'warning',
  endsSoon: 'warning',
  missing: 'warning',
  unpublishOn: 'outline',
  changes: 'outline',
  live: 'success',
}

export type CourseStatusInput = {
  state: CourseState
  isPublished: boolean
  publishedAt: string | null
  unpublishOn: string | null
  schedule: CourseScheduleSummary | null
  hasPageAddress: boolean
  missingLanguages: readonly string[]
}

/**
 * Everything worth saying about a course's status, MOST IMPORTANT FIRST — the
 * list shows the first as its one pill and the rest in a tooltip:
 *   1. where it is in its life: Archived · Draft · Scheduled for … · Unpublished
 *   2. warnings (amber): No classes · No page address (the site has course
 *      pages, the published course has no address in the main language) ·
 *      Ends in N days · Missing DE
 *   3. Unpublishes on … · Pending changes
 *   4. Live (published and nothing above).
 * An archived course says only that.
 */
export function courseStatusItems(c: CourseStatusInput, ctx: { today: string; coursePages: boolean }): CourseStatusItem[] {
  if (c.state === 'archived') return [{ kind: 'archived' }]
  const out: CourseStatusItem[] = []
  if (c.state === 'draft') out.push({ kind: 'draft' })
  else if (c.state === 'scheduled') out.push({ kind: 'scheduled', at: c.publishedAt })
  else if (c.state === 'unpublished') out.push({ kind: 'unpublished' })
  if (c.schedule && c.schedule.classes === 0) out.push({ kind: 'noClasses' })
  if (ctx.coursePages && c.isPublished && !c.hasPageAddress) out.push({ kind: 'noAddress' })
  const ends = runsUntil(c.schedule, ctx.today)
  if (ends.endsSoon && ends.daysLeft !== null && c.state !== 'unpublished') out.push({ kind: 'endsSoon', days: ends.daysLeft })
  if (c.missingLanguages.length) out.push({ kind: 'missing', languages: [...c.missingLanguages] })
  if (c.unpublishOn && (c.state === 'published' || c.state === 'changes' || c.state === 'scheduled')) out.push({ kind: 'unpublishOn', at: c.unpublishOn })
  if (c.state === 'changes') out.push({ kind: 'changes' })
  if (c.state === 'published' || c.state === 'changes') out.push({ kind: 'live' })
  return out
}

// ── Needs attention ──────────────────────────────────────────────────────────

/** The schedule's end shows in the strip when it is this close. */
export const TERM_ENDING_DAYS = 21

export type CourseAttentionItem =
  | { kind: 'termEnding'; date: string }
  | { kind: 'weekChanges'; changes: number; cancelled: number }
  | { kind: 'incomplete'; count: number }

export type AttentionCourse = {
  state: CourseState
  shortDescription: string
  hasImage: boolean
  schedule: CourseScheduleSummary | null
}

/** A course without an image or a short description (archived ones are left out of every count). */
export const isIncompleteCourse = (c: Pick<AttentionCourse, 'state' | 'shortDescription' | 'hasImage'>) => c.state !== 'archived' && (!c.hasImage || !c.shortDescription.trim())

/**
 * The "Needs attention" strip, only what is true:
 *   termEnding   the site's latest class date is within 21 days and nothing —
 *                no class that keeps going, no later term — is set up after it
 *   weekChanges  this week's changed dates (Monday–Sunday), cancelled ones counted too
 *   incomplete   courses without an image or a short description
 */
export function courseAttention(courses: readonly AttentionCourse[], terms: ReadonlyArray<{ startsOn: string; endsOn: string }>, today: string): CourseAttentionItem[] {
  const live = courses.filter((c) => c.state !== 'archived')
  const out: CourseAttentionItem[] = []

  const scheduled = live.map((c) => c.schedule).filter((s): s is CourseScheduleSummary => !!s && s.classes > 0)
  if (scheduled.length && !scheduled.some((s) => s.openEnded)) {
    const last = scheduled.map((s) => s.lastDate).filter((d): d is string => !!d).reduce<string | null>((a, b) => (!a || b > a ? b : a), null)
    const days = last ? daysBetween(today, last) : null
    const laterTerm = last ? terms.some((t) => t.startsOn > last) : false
    if (last && days !== null && days >= 0 && days <= TERM_ENDING_DAYS && !laterTerm) out.push({ kind: 'termEnding', date: last })
  }

  const week = weekOf(today)
  const totals = live.reduce((n, c) => {
    const w = weekChanges(c.schedule?.exceptions, week)
    return { changes: n.changes + w.changes, cancelled: n.cancelled + w.cancelled }
  }, { changes: 0, cancelled: 0 })
  if (totals.changes > 0) out.push({ kind: 'weekChanges', ...totals })

  const incomplete = live.filter(isIncompleteCourse).length
  if (incomplete > 0) out.push({ kind: 'incomplete', count: incomplete })
  return out
}
