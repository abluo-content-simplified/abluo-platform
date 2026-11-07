// The phone agenda's pure logic: which day is "active" for a scroll position,
// and which week the date strip shows. No DOM here, so it is unit-tested.

import { weekStart } from '@/lib/modules/courses/timetable'
import { addDays } from '@/lib/scheduling/recurrence'

export type DayPosition = { date: string; top: number }

/**
 * The active day for a threshold line (y, in viewport pixels): the last day
 * whose top is at or above the line — i.e. the day the line is inside, or the
 * one just above it when the line falls in a gap. Before the first day: the
 * first day. `days` must be in date order.
 */
export function pickActiveDay(days: readonly DayPosition[], line: number): string | null {
  if (days.length === 0) return null
  let active = days[0].date
  for (const d of days) {
    if (d.top <= line) active = d.date
    else break
  }
  return active
}

/** The Monday of the strip's week after the active day changed: unchanged while the day is inside the shown week, else the active day's week. */
export function nextStripMonday(active: string, stripMonday: string): string {
  return active >= stripMonday && active <= addDays(stripMonday, 6) ? stripMonday : weekStart(active)
}

/** Every date from `from` to `to` inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
