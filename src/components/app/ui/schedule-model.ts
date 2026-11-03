/**
 * Pure helpers for WeeklyScheduleEditor and AvailabilitySwitch (no React).
 *
 * Nothing here evaluates or validates a schedule — that is C5a
 * (`scheduleIssues`, availability-schedule.ts) and C4 (`windowIssues`,
 * windows.ts). This file only turns a rule into words and gives the editor
 * localized weekday names. Times are the stored "HH:mm" strings, which are
 * already 24-hour, so they are shown as they are in every language.
 */
import { WEEKDAYS, minutesOf, type Weekday, type WeeklyWindow } from '@/lib/modules/catalogue/commerce/windows'
import type { ChannelAvailabilityRule, ChannelAvailabilityState } from '@/lib/modules/catalogue/commerce/commerce-types'

export type { Weekday }
export { WEEKDAYS }

/** A message function: the component passes next-intl's `t` for `app.ui.schedule`. */
export type ScheduleT = (key: string, values?: Record<string, string | number>) => string

/** Monday 1 January 2024 — a fixed Monday to read localized weekday names from. */
const MONDAY_UTC = Date.UTC(2024, 0, 1)

/** Localized weekday names, Monday first (the order Abluo uses in every language). */
export function weekdayNames(locale: string, width: 'short' | 'long' = 'short'): Record<Weekday, string> {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' })
  const out = {} as Record<Weekday, string>
  WEEKDAYS.forEach((d, i) => {
    out[d] = fmt.format(new Date(MONDAY_UTC + i * 86_400_000))
  })
  return out
}

/** True when `to` is at or before `from`: the interval runs into the next day (A1). */
export function isOvernight(from: string | null | undefined, to: string | null | undefined): boolean {
  const a = minutesOf(from)
  const b = minutesOf(to)
  return a !== null && b !== null && b < a
}

/** "Mon–Fri, Sun" — consecutive days collapse into a range; empty or all seven = every day. */
export function daysText(days: readonly string[] | null | undefined, names: Record<Weekday, string>, t: ScheduleT): string {
  const set = new Set((days ?? []).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)))
  if (set.size === 0 || set.size === 7) return t('everyDay')
  const runs: Weekday[][] = []
  for (const d of WEEKDAYS) {
    if (!set.has(d)) continue
    const last = runs[runs.length - 1]
    if (last && WEEKDAYS.indexOf(last[last.length - 1]) === WEEKDAYS.indexOf(d) - 1) last.push(d)
    else runs.push([d])
  }
  return runs.map((r) => (r.length >= 3 ? t('dayRange', { from: names[r[0]], to: names[r[r.length - 1]] }) : r.map((d) => names[d]).join(', '))).join(', ')
}

/** "18:00–23:00", "22:00–02:00 overnight" or "all day". */
export function timeText(from: string | null | undefined, to: string | null | undefined, t: ScheduleT): string {
  const hasFrom = typeof from === 'string' && from !== ''
  const hasTo = typeof to === 'string' && to !== ''
  if (!hasFrom && !hasTo) return t('allDayPhrase')
  const values = { from: hasFrom ? from! : '…', to: hasTo ? to! : '…' }
  return isOvernight(from, to) ? t('rangeOvernight', values) : t('range', values)
}

/** One window or override in words: "18:00–23:00 every day". */
export function windowText(w: WeeklyWindow, names: Record<Weekday, string>, t: ScheduleT): string {
  return t('phrase', { time: timeText(w.from, w.to, t), days: daysText(w.days, names, t) })
}

/**
 * The human summary of an availability rule:
 *   baseline only                 → "Available all week"
 *   unavailable + available hours → "Available 18:00–23:00 every day"
 *   available + unavailable hours → "Unavailable all day Sun, otherwise available"
 *   mixed                         → "Usually available; unavailable …; available …"
 */
export function ruleSummary(rule: ChannelAvailabilityRule, names: Record<Weekday, string>, t: ScheduleT): string {
  const word = (s: ChannelAvailabilityState) => t(s === 'available' ? 'stateAvailable' : 'stateUnavailable')
  if (rule.overrides.length === 0) return t(rule.state === 'available' ? 'summaryAlwaysAvailable' : 'summaryAlwaysUnavailable')
  const phrases = (state: ChannelAvailabilityState) =>
    rule.overrides
      .filter((o) => o.state === state)
      .map((o) => windowText(o, names, t))
      .join('; ')
  const opposite: ChannelAvailabilityState = rule.state === 'available' ? 'unavailable' : 'available'
  const allOpposite = rule.overrides.every((o) => o.state === opposite)
  if (allOpposite && rule.state === 'unavailable') return t('summaryOnlyAvailable', { hours: phrases('available') })
  if (allOpposite && rule.state === 'available') return t('summaryExceptUnavailable', { hours: phrases('unavailable') })
  const parts = [t('summaryUsually', { state: word(rule.state) })]
  for (const s of ['available', 'unavailable'] as const) {
    const p = phrases(s)
    if (p) parts.push(t('summaryState', { state: word(s), hours: p }))
  }
  return parts.join('; ')
}

/** Price windows in words: [] = "Always", else the windows joined. */
export function windowsSummary(windows: readonly WeeklyWindow[], names: Record<Weekday, string>, t: ScheduleT): string {
  if (windows.length === 0) return t('summaryAlways')
  return windows.map((w) => windowText(w, names, t)).join('; ')
}

/** Message key for an issue code: "availability.scheduleOverlap" → "scheduleOverlap" (next-intl keys cannot contain dots). */
export function issueMessageKey(code: string): string {
  const i = code.indexOf('.')
  return i >= 0 ? code.slice(i + 1) : code
}

/** Issue codes this namespace has words for; anything else shows the generic message. */
export const SCHEDULE_ISSUE_KEYS = [
  'scheduleOverlap',
  'scheduleInvalidTime',
  'scheduleIncomplete',
  'scheduleZeroLength',
  'scheduleUnknownDay',
  'scheduleUnknownKind',
  'scheduleLimitExceeded',
  'scheduleRedundant',
  'scheduleOnImplicitFormat',
  'stateInvalid',
  'overlap',
  'windowInvalidTime',
  'windowIncomplete',
  'windowZeroLength',
  'windowUnknownDay',
] as const
