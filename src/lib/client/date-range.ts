/**
 * Pure date logic for the client dashboard's DateRangePicker. All dates are
 * ISO calendar days (YYYY-MM-DD) and all arithmetic is done in UTC on
 * year/month/day numbers, so it never shifts with the viewer's time zone or DST.
 * Months are 0-based (like Date); week starts are 0 = Sunday … 6 = Saturday.
 */

export type DateRange = { from: string | null; to: string | null }
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type YearMonth = { y: number; m: number }
export type GridCell = { iso: string; day: number; inMonth: boolean }
export type RangePreset = 'last7' | 'last30' | 'thisYear'

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function toISO(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(2000, 0, 1))
  dt.setUTCFullYear(y, m, d)
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Parses YYYY-MM-DD; null when malformed or not a real calendar day. */
export function parseISO(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2]) - 1
  const d = Number(match[3])
  return toISO(y, m, d) === iso ? { y, m, d } : null
}

export function addDays(iso: string, n: number): string {
  const p = parseISO(iso)
  if (!p) return iso
  return toISO(p.y, p.m, p.d + n)
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const total = ym.y * 12 + ym.m + n
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }
}

/** Today as a local calendar day. */
export function todayISO(now: Date = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth(), now.getDate())
}

export function monthOf(iso: string): YearMonth | null {
  const p = parseISO(iso)
  return p ? { y: p.y, m: p.m } : null
}

/** Weekday (0 = Sunday) of an ISO day. */
export function weekdayOf(iso: string): number {
  const p = parseISO(iso)
  return p ? new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() : 0
}

/** Always six weeks (42 cells) so the calendar keeps a stable height. */
export function monthGrid(y: number, m: number, weekStart: WeekStart = 1): GridCell[][] {
  const first = toISO(y, m, 1)
  const offset = (weekdayOf(first) - weekStart + 7) % 7
  const weeks: GridCell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: GridCell[] = []
    for (let i = 0; i < 7; i++) {
      const iso = addDays(first, w * 7 + i - offset)
      const p = parseISO(iso)!
      row.push({ iso, day: p.d, inMonth: p.y === y && p.m === m })
    }
    weeks.push(row)
  }
  return weeks
}

/** Weekday indices (0 = Sunday) in display order for the given week start. */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
}

/** Orders two ISO days (a tap before the start swaps them). ISO strings sort lexically. */
export function orderRange(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/** Inclusive: true for the from day, the to day and everything between. */
export function isInRange(iso: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  const r = orderRange(from, to)
  return iso >= r.from && iso <= r.to
}

/** The next draft after a day is tapped: first tap sets the start, second sets the end. */
export function pickDay(draft: DateRange, iso: string): DateRange {
  if (!draft.from || draft.to) return { from: iso, to: null }
  return orderRange(draft.from, iso)
}

export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  if (preset === 'last7') return { from: addDays(today, -6), to: today }
  if (preset === 'last30') return { from: addDays(today, -29), to: today }
  const p = parseISO(today)
  return { from: toISO(p ? p.y : 1970, 0, 1), to: today }
}

/** Monday-first except for locales that start on Sunday (en). Intl week info when available. */
export function weekStartForLocale(locale: string): WeekStart {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return (info.firstDay % 7) as WeekStart
  } catch {
    /* fall through to the map */
  }
  const lang = locale.toLowerCase().split('-')[0]
  return lang === 'en' ? 0 : 1
}
