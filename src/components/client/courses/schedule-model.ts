// Pure helpers for the course schedule screens (Classes panel, Timetable). No React, no I/O.
import type { ClassView, EditionView, PlaceOption } from '@/lib/api/course-schedule'

/** Today's date ('YYYY-MM-DD') in a time zone. */
export function todayIn(zone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** A text per language: the main language's, else the first one written. */
export function textOf(map: Record<string, string> | null | undefined, defaultLocale: string): string {
  if (!map) return ''
  return map[defaultLocale] ?? Object.values(map).find(Boolean) ?? ''
}

/** The term that runs today, else the next one to start, else the last one; '' when there is none. */
export function currentEditionId(editions: readonly EditionView[], today: string): string {
  const running = editions.find((e) => e.startsOn <= today && today <= e.endsOn)
  if (running) return running.id
  const upcoming = [...editions].filter((e) => e.startsOn > today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0]
  if (upcoming) return upcoming.id
  return [...editions].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0]?.id ?? ''
}

/** The later of two ISO days. */
export const laterDay = (a: string, b: string) => (a > b ? a : b)

/** The class's default first date when it joins a term: today, or the term's start if that is later. */
export function defaultStartsOn(edition: EditionView | undefined, today: string): string {
  return edition ? laterDay(today, edition.startsOn) : today
}

/** A time list in 15-minute steps; an off-grid stored time stays selectable. */
export function timeOptions(extra?: string | null): string[] {
  const out: string[] = []
  for (let m = 0; m < 24 * 60; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  if (extra && /^\d{2}:\d{2}$/.test(extra) && !out.includes(extra)) out.push(extra)
  return out.sort()
}

/** Only the two-letter languages a class can be taught in. */
export const classLanguages = (siteLanguages: readonly string[]): string[] => siteLanguages.filter((l) => /^[a-z]{2}$/.test(l))

export type PlaceRow<T> = { token: string; name: string; items: T[] }

/** Classes grouped by place, in the order of the site's places; classes without a known place last ('' token). */
export function groupByPlace(classes: readonly ClassView[], places: readonly PlaceOption[]): PlaceRow<ClassView>[] {
  const rows: PlaceRow<ClassView>[] = places.map((p) => ({ token: p.token, name: p.name, items: [] }))
  const known = new Map(rows.map((r) => [r.token, r]))
  const unplaced: PlaceRow<ClassView> = { token: '', name: '', items: [] }
  for (const c of classes) (known.get(c.placeToken) ?? unplaced).items.push(c)
  return [...rows.filter((r) => r.items.length), ...(unplaced.items.length ? [unplaced] : [])]
}

/** The weekdays (1..7) that have at least one class. */
export const weekdaysWithClasses = (classes: readonly ClassView[]): number[] => [...new Set(classes.map((c) => c.weekday))].sort((a, b) => a - b)

/** End must come after start on the same day (overnight classes are not supported). */
export const timesOrdered = (start: string, end: string): boolean => !end || end > start
