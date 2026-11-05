// Formatting helpers for the Timetable section. Every word that is not tenant
// content comes from Intl (weekday and month names, language names) or from the
// timetable dictionary — nothing user-facing is written here.

import { addDays, weekdayOf } from '@/lib/scheduling/recurrence'

/** A 'YYYY-MM-DD' date as a Date at noon UTC (formatted with timeZone 'UTC', so the day never shifts). */
const noon = (date: string) => new Date(`${date}T12:00:00Z`)

export function formatDate(locale: string, date: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(noon(date))
  } catch {
    return date
  }
}

/** Mon = 1 … Sun = 7, as a short / long name in the page language. */
export function weekdayName(locale: string, weekday: number, style: 'short' | 'long' = 'short'): string {
  // 2024-01-01 was a Monday.
  return formatDate(locale, addDays('2024-01-01', (weekday - 1) % 7), { weekday: style })
}

export function monthTitle(locale: string, month: string): string {
  return formatDate(locale, `${month}-01`, { month: 'long', year: 'numeric' })
}

/** '7/12' — day and month only, in the page language's order. */
export function shortDate(locale: string, date: string, withYear = false): string {
  return formatDate(locale, date, withYear ? { day: 'numeric', month: 'numeric', year: 'numeric' } : { day: 'numeric', month: 'numeric' })
}

export const dayNumber = (locale: string, date: string) => formatDate(locale, date, { day: 'numeric' })

export const timeRange = (start: string, end: string | null) => (end ? `${start}–${end}` : start)

/** A language code as its name in the page language (aria label); the code itself when unknown. */
export function languageName(locale: string, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

export function listNames(locale: string, names: readonly string[]): string {
  try {
    return new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

/**
 * Splits a dictionary template that receives names ("with {names}") into the
 * text before and after the names, so the names can be rendered as links.
 */
export function splitTemplate(template: (names: string) => string): [string, string] {
  const marker = '\u0001'
  const [before, after = ''] = template(marker).split(marker)
  return [before, after]
}

/** Only https links are ever rendered as hrefs. */
export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export { weekdayOf }
