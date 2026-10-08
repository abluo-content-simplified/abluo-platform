import type { DateWindow, SnapshotWindows } from './types'

/** Days in the main reporting window (ADR-029 §3.4: 28-day window by default). */
export const WINDOW_DAYS = 28
export const SHORT_WINDOW_DAYS = 7
/** A snapshot older than this is "stale" in the admin (the job runs daily: a day or two of failed runs). */
export const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000
/** A good snapshot older than this is "out of date" (the job has not produced data for a week). */
export const OUT_OF_DATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** `iso` ± `days`, in UTC. */
export function addDays(iso: string, days: number): string {
  return isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS))
}

function windowEnding(end: string, days: number): DateWindow {
  return { start: addDays(end, -(days - 1)), end }
}

/** The four windows of a snapshot taken at `now`: all end yesterday (UTC). Pure. */
export function snapshotWindows(now: Date = new Date()): SnapshotWindows {
  const end = addDays(isoDay(now), -1)
  const current = windowEnding(end, WINDOW_DAYS)
  const last7 = windowEnding(end, SHORT_WINDOW_DAYS)
  return {
    current,
    previous: windowEnding(addDays(current.start, -1), WINDOW_DAYS),
    last7,
    previous7: windowEnding(addDays(last7.start, -1), SHORT_WINDOW_DAYS),
  }
}

/** Every ISO day of a window, oldest first. */
export function daysOf(w: DateWindow): string[] {
  const out: string[] = []
  for (let d = w.start; d <= w.end; d = addDays(d, 1)) out.push(d)
  return out
}

export function inWindow(day: string, w: DateWindow): boolean {
  return day >= w.start && day <= w.end
}
