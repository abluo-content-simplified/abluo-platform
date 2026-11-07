// ── A timetable session as a calendar event (ADR-045 / ADR-038) ──────────────
//
// Pure and client-safe. Turns one `TimetableOccurrence` (+ its series, + the data it came from) into an
// `IcsEvent` for ics.ts. Used by the .ics route (server) and the Add-to-calendar menu (browser, for the
// Google link) so both say the same thing.
//
// PRIVACY: reads title, place, teacher names and languages only. `data.rooms` (join link, meeting number,
// passcode) is never touched; an online class is just "Online".

import { addDays, formatClassRule, nextRuleDate, parseClassRule, previousRuleDate, ruleOccursOn, type ClassRule } from '@/lib/scheduling/recurrence'
import type { TimetableData, TimetableOccurrence, TimetableSeries } from '@/lib/modules/courses/timetable'
import type { AddToCalendarMessages } from '@/lib/i18n/add-to-calendar-messages'
import type { IcsEvent } from './ics'

/** How far ahead (days) the route reads cancelled sessions of a repeating class (the timetable reader's window limit). */
export const SERIES_LOOKAHEAD_DAYS = 100
const MAX_EXCLUDED_DATES = 400

function languageNames(codes: string[], locale: string): string[] {
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([locale], { type: 'language' })
  } catch {
    names = null
  }
  return codes.map((c) => {
    try {
      return names?.of(c) ?? c
    } catch {
      return c
    }
  })
}

/** LOCATION text: place name + address lines; "Online" for an online class; a hybrid class adds "(also online)". */
export function eventLocation(occ: TimetableOccurrence, data: TimetableData, msg: Pick<AddToCalendarMessages, 'online' | 'alsoOnline'>): string | null {
  if (occ.mode === 'online') return msg.online
  const place = occ.placeKey ? data.places[occ.placeKey] : null
  const parts = place ? [place.name, ...place.lines].filter((p) => p && p.trim()) : []
  if (!parts.length) return occ.mode === 'mixed' ? msg.online : null
  const text = parts.join(', ')
  return occ.mode === 'mixed' ? `${text} (${msg.alsoOnline})` : text
}

export type TimetableEventInput = {
  occurrence: TimetableOccurrence
  series?: TimetableSeries | null
  data: TimetableData
  locale: string
  host: string
  pageUrl?: string | null
  msg: AddToCalendarMessages
}

/** The single-session event. Null when the course is unknown (nothing to name the event). */
export function timetableEvent(input: TimetableEventInput): IcsEvent | null {
  const { occurrence: occ, data, msg } = input
  const course = data.courses[occ.courseId]
  if (!course) return null
  const teachers = occ.teacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id].name] : []))
  const langs = languageNames(occ.languages, input.locale)
  const description = [
    teachers.length ? `${msg.teachers}: ${teachers.join(', ')}` : null,
    langs.length ? `${msg.languages}: ${langs.join(', ')}` : null,
    occ.note?.trim() || null,
    input.pageUrl || null,
  ]
    .filter((l): l is string => !!l)
    .join('\n')
  return {
    uid: occ.id,
    host: input.host,
    title: course.title,
    startLocal: `${occ.date}T${occ.start}`,
    endLocal: occ.end ? `${occ.date}T${occ.end}` : null,
    timeZone: data.timeZone,
    location: eventLocation(occ, data, msg),
    description: description || null,
    url: input.pageUrl || null,
    recurrence: null,
  }
}

/** The repeat preset of a series when it makes a calendar rule (not "once", not unknown); else null. */
export function repeatingRule(series: Pick<TimetableSeries, 'rule'> | null | undefined): ClassRule | null {
  const rule = parseClassRule(series?.rule)
  return rule && rule.kind !== 'once' ? rule : null
}

/** Closure days are expanded this far ahead (days) for an open-ended class. */
export const CLOSURE_HORIZON_DAYS = 730

/**
 * The whole-class event, built from the SERIES (its own time, place, teachers, languages; no per-date note), so a
 * single overridden session (substitute, moved time) does not leak into the repeat. DTSTART is the first rule
 * date on/after the picked date. EXDATE: every holiday day the rule would hit (closures are known in full, up
 * to CLOSURE_HORIZON_DAYS or the class end) and the cancelled sessions the data knows of — those only within
 * the window the caller read (`SERIES_LOOKAHEAD_DAYS` from the picked date). Null when the class does not repeat.
 */
export function timetableSeriesEvent(input: TimetableEventInput): IcsEvent | null {
  const { occurrence: occ, series, data } = input
  const rule = repeatingRule(series)
  if (!rule || !series) return null
  const first = nextRuleDate(rule, occ.date, series.anchor)
  if (!first || (series.endsOn && first > series.endsOn)) return null
  const base = timetableEvent({
    ...input,
    occurrence: { ...occ, date: first, start: series.start, end: series.end, teacherIds: series.teacherIds, languages: series.languages, mode: series.mode, placeKey: series.placeKey, note: null },
  })
  if (!base) return null
  const last = series.endsOn ? previousRuleDate(rule, series.endsOn, series.anchor) : null
  const horizon = [series.endsOn ?? '9999-12-31', addDays(first, CLOSURE_HORIZON_DAYS)].reduce((a, b) => (a < b ? a : b))
  const excluded = new Set<string>()
  for (const o of data.occurrences) {
    if (o.seriesId === series.id && o.status === 'cancelled' && o.date >= first && o.date <= horizon) excluded.add(o.date)
  }
  for (const c of data.closures) {
    const stop = c.endsOn < horizon ? c.endsOn : horizon
    for (let d = c.startsOn > first ? c.startsOn : first; d <= stop && excluded.size < MAX_EXCLUDED_DATES; d = addDays(d, 1)) {
      if (ruleOccursOn(rule, d, series.anchor)) excluded.add(d)
    }
  }
  return {
    ...base,
    uid: `${series.id}-from-${first}`,
    recurrence: {
      rule: formatClassRule(rule),
      lastStartLocal: last ? `${last >= first ? last : first}T${series.start}` : null,
      excludeDates: [...excluded].sort(),
    },
  }
}

/** File name for the download: `<course>-<date>.ics`, ASCII-safe. */
export function icsFileName(courseTitle: string, date: string): string {
  const slug = courseTitle
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'class'}-${date}.ics`
}
