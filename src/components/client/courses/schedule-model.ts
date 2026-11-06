// Pure helpers for the course schedule screens (Classes panel, Timetable). No React, no I/O.
import type { ClassView, EditionView, PlaceOption } from '@/lib/api/course-schedule'
import { MAX_WEEK_INTERVAL, nextStartDate, previousRuleDate, ruleOccursOn, ruleWeekdays, type ClassRule, type Ordinal } from '@/lib/scheduling/recurrence'

/** Today's date ('YYYY-MM-DD') in a time zone. */
export function todayIn(zone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
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
  const rows: PlaceRow<ClassView>[] = places.map((p) => ({
    token: p.token,
    name: p.name,
    items: [],
  }))
  const known = new Map(rows.map((r) => [r.token, r]))
  const unplaced: PlaceRow<ClassView> = { token: '', name: '', items: [] }
  for (const c of classes) (known.get(c.placeToken) ?? unplaced).items.push(c)
  return [...rows.filter((r) => r.items.length), ...(unplaced.items.length ? [unplaced] : [])]
}

/** The weekdays (1..7) that have at least one class. */
export const weekdaysWithClasses = (classes: readonly ClassView[]): number[] => [...new Set(classes.flatMap((c) => c.weekdays))].sort((a, b) => a - b)

/** End must come after start on the same day (overnight classes are not supported). */
export const timesOrdered = (start: string, end: string): boolean => !end || end > start

// ── The repeat of a class, as the sheet edits it ─────────────────────────────

/** What the "Repeats" select offers: 'once', 'weekly:<n>' (every n weeks), 'monthlyWeekday', 'monthlyDay'. */
export type RepeatKey = string

/** The repeat as a form holds it: every part stays while another kind is shown, so switching back loses nothing. */
export type RepeatDraft = {
  kind: ClassRule['kind']
  /** Weekly: the days (1 = Monday … 7 = Sunday). */
  weekdays: number[]
  /** Weekly: every n weeks. */
  interval: number
  /** Monthly on a weekday: which one, and the weekday. */
  ordinal: Ordinal
  monthWeekday: number
  /** Monthly on a date. */
  monthDay: number
}

export const STANDARD_INTERVALS = [1, 2, 3, 4]
export const ORDINAL_OPTIONS: readonly Ordinal[] = [1, 2, 3, 4, -1]

/** The form values for a stored rule (null = an unknown stored rule: shown as weekly on the first date's weekday). `firstDate` seeds parts the rule does not have. */
export function repeatDraftOf(rule: ClassRule | null, firstDate: string): RepeatDraft {
  const weekday = ruleWeekdays({ kind: 'once' }, firstDate)[0]
  const day = Number(firstDate.slice(8, 10)) || 1
  const base: RepeatDraft = {
    kind: 'weekly',
    weekdays: [weekday],
    interval: 1,
    ordinal: Math.min(4, Math.ceil(day / 7)) as Ordinal,
    monthWeekday: weekday,
    monthDay: day,
  }
  if (!rule) return base
  switch (rule.kind) {
    case 'once':
      return { ...base, kind: 'once' }
    case 'weekly':
      return {
        ...base,
        kind: 'weekly',
        weekdays: [...rule.weekdays],
        interval: rule.interval,
      }
    case 'monthlyWeekday':
      return {
        ...base,
        kind: 'monthlyWeekday',
        ordinal: rule.ordinal,
        monthWeekday: rule.weekday,
      }
    case 'monthlyDay':
      return { ...base, kind: 'monthlyDay', monthDay: rule.day }
  }
}

/** The rule the form describes; null while it is incomplete (a weekly class with no day). */
export function ruleOfDraft(d: RepeatDraft): ClassRule | null {
  switch (d.kind) {
    case 'once':
      return { kind: 'once' }
    case 'weekly':
      return d.weekdays.length
        ? {
            kind: 'weekly',
            weekdays: [...d.weekdays].sort((a, b) => a - b),
            interval: d.interval,
          }
        : null
    case 'monthlyWeekday':
      return {
        kind: 'monthlyWeekday',
        ordinal: d.ordinal,
        weekday: d.monthWeekday,
      }
    case 'monthlyDay':
      return { kind: 'monthlyDay', day: d.monthDay }
  }
}

export const repeatKeyOf = (d: RepeatDraft): RepeatKey => (d.kind === 'weekly' ? `weekly:${d.interval}` : d.kind)

/** The draft after choosing a value in the "Repeats" select. */
export function applyRepeatKey(d: RepeatDraft, key: RepeatKey): RepeatDraft {
  if (key.startsWith('weekly:')) {
    const interval = Number(key.slice(7))
    return {
      ...d,
      kind: 'weekly',
      interval: Number.isInteger(interval) && interval >= 1 && interval <= MAX_WEEK_INTERVAL ? interval : 1,
    }
  }
  return key === 'once' || key === 'monthlyWeekday' || key === 'monthlyDay' ? { ...d, kind: key } : d
}

/** The select's values: once, every 1–4 weeks (plus a stored odd interval), the two monthly presets. */
export function repeatKeys(d: RepeatDraft): RepeatKey[] {
  const intervals = d.kind === 'weekly' && !STANDARD_INTERVALS.includes(d.interval) ? [...STANDARD_INTERVALS, d.interval] : STANDARD_INTERVALS
  return ['once', ...intervals.map((n) => `weekly:${n}`), 'monthlyWeekday', 'monthlyDay']
}

/** Can the class START on this day (for the first-date picker)? */
export const canStartOn = (rule: ClassRule, day: string): boolean => ruleOccursOn(rule, day, day)

/** Can the class END on this day (for the last-date picker), given its first day? */
export const canEndOn = (rule: ClassRule, day: string, startsOn: string): boolean => day >= startsOn && ruleOccursOn(rule, day, startsOn)

export type DateSnap = {
  startsOn: string
  endsOn: string
  /** True when a date had to move (or the last date had to go). */ adjusted: boolean
}

/**
 * Brings the two dates in line with the days of the rule: a first date that is not a class day moves to the next
 * one; a last date that is not a class day moves back to the previous one, or is cleared when that is before the
 * first. "Once" has no last date. With `keepStart` the first date is trusted (the person just picked it).
 */
export function snapDates(rule: ClassRule, startsOn: string, endsOn: string, keepStart = false): DateSnap {
  let start = startsOn
  let adjusted = false
  if (start && !keepStart && !canStartOn(rule, start)) {
    const next = nextStartDate(rule, start)
    if (next) {
      start = next
      adjusted = true
    }
  }
  let end = endsOn
  if (rule.kind === 'once') {
    if (end) adjusted = true
    end = ''
  } else if (end && start && !canEndOn(rule, end, start)) {
    const prev = end >= start ? previousRuleDate(rule, end, start) : null
    end = prev && prev >= start ? prev : ''
    adjusted = true
  }
  return { startsOn: start, endsOn: end, adjusted }
}
