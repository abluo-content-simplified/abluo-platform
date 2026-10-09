/**
 * Contact requests → the Analytics page's numbers (analytics v2). Pure and
 * browser-safe. Same windows as the Google numbers on that page: the last 28
 * days ending yesterday (UTC) and the 28 before, so the request count lines up
 * with the visitor count next to it.
 */
import { percentChange } from '@/lib/client/home-cards'
import { daysOf, inWindow, snapshotWindows } from './periods'

export type RequestRow = { created_at: string; page_path: string | null }

export type RequestStats = {
  /** First day read (start of the previous window). */
  since: string
  current: number
  previous: number
  change: number | null
  daily: { date: string; value: number }[]
  dailyPrevious: { date: string; value: number }[]
  /** Pages the requests were sent from, current window, most first. */
  topPages: { label: string; value: number }[]
}

export const TOP_REQUEST_PAGES = 5

export function requestStats(rows: readonly RequestRow[], now: number = Date.now()): RequestStats {
  const w = snapshotWindows(new Date(now))
  const perDay = new Map<string, number>()
  const pages = new Map<string, number>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
    if (inWindow(day, w.current)) {
      const page = (r.page_path ?? '').trim() || '/'
      pages.set(page, (pages.get(page) ?? 0) + 1)
    }
  }
  const series = (days: string[]) => days.map((date) => ({ date, value: perDay.get(date) ?? 0 }))
  const daily = series(daysOf(w.current))
  const dailyPrevious = series(daysOf(w.previous))
  const current = daily.reduce((s, d) => s + d.value, 0)
  const previous = dailyPrevious.reduce((s, d) => s + d.value, 0)
  return {
    since: w.previous.start,
    current,
    previous,
    change: percentChange(current, previous),
    daily,
    dailyPrevious,
    topPages: [...pages.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_REQUEST_PAGES)
      .map(([label, value]) => ({ label, value })),
  }
}
