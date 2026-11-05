// ── Courses module — the timetable, as the website shows it (ADR-045, build spec §5) ──
//
// Pure and client-safe: no Next.js, no Supabase, no Sanity client. The server
// reader (src/lib/scheduling/timetable.server.ts) reads the rows and calls
// `shapeTimetable`; the section components (week, month, print) only format
// what comes out. Every value in `TimetableData` is plain JSON.
//
// PRIVACY: meeting rooms (join link, meeting number, passcode) are in the data
// ONLY when `includeOnlineDetails` was true. `onlineDetailsAllowed` is the one
// rule that decides it; callers feed it facts they verified on the server (the
// section's own setting and the page gate) — never anything the browser sent.
//
// Dates are local 'YYYY-MM-DD' and times 'HH:mm' (24-hour) in the class's own
// time zone, exactly as scheduling stores them; no conversion happens here.

import { formatLocationAddress } from '@/lib/maps/locations'
import { addDays, dayNumber, weekdayOf } from '@/lib/scheduling/recurrence'
import type { AttendanceMode, ClassOccurrence, ClassSeries, MeetingRoom, ScheduleClosure } from '@/lib/scheduling/types'
import { personDisplayName } from '@/lib/modules/people/model'
import type { SiteLocation } from '@/lib/sanity/types'

// ── The one privacy rule ─────────────────────────────────────────────────────

/**
 * Online meeting details may be shown only when the section asks for them AND
 * the page is Access-protected AND this visitor's access session passed the
 * gate (`gate.kind === 'granted'`). `pageProtected` must come from the server's
 * own gate decision. Anything else is false.
 */
export function onlineDetailsAllowed(input: { showOnlineDetails: unknown; pageProtected: unknown }): boolean {
  return input.showOnlineDetails === true && input.pageProtected === true
}

// ── Public data shapes ───────────────────────────────────────────────────────

export type TimetableCourse = { id: string; title: string; color: 'none' | 'accent' | 'muted' }
export type TimetableTeacher = { id: string; name: string; hasPage: boolean; slug: string | null }
export type TimetablePlace = { key: string; name: string; lines: string[] }
export type TimetableRoom = { id: string; label: string; joinUrl: string | null; meetingId: string | null; passcode: string | null; note: string | null }

export type TimetableOccurrence = {
  id: string
  seriesId: string
  courseId: string
  date: string
  start: string
  end: string | null
  status: 'scheduled' | 'cancelled'
  teacherIds: string[]
  languages: string[]
  mode: AttendanceMode
  placeKey: string | null
  note: string | null
  /** null unless online details are allowed. */
  meetingRoomId: string | null
}

/** The weekly pattern of one class (the print grid's cells). */
export type TimetableSeries = {
  id: string
  courseId: string
  weekday: number
  interval: number
  start: string
  end: string | null
  startsOn: string | null
  endsOn: string | null
  teacherIds: string[]
  languages: string[]
  mode: AttendanceMode
  placeKey: string | null
  /** null unless online details are allowed. */
  meetingRoomId: string | null
}

export type TimetableClosure = {
  startsOn: string
  endsOn: string
  label: string | null
  /** The last date with a class before the closure ("last class 17/12"), from the weekly patterns. */
  lastClass: string | null
  /** The first date with a class after the closure ("first class 7/1/2027"). */
  firstClass: string | null
}

export type TimetableData = {
  /** The dates this data covers (inclusive). */
  window: { from: string; to: string }
  /** The site time zone (IANA) the dates and times are in, when known. */
  timeZone: string | null
  occurrences: TimetableOccurrence[]
  series: TimetableSeries[]
  closures: TimetableClosure[]
  courses: Record<string, TimetableCourse>
  teachers: Record<string, TimetableTeacher>
  places: Record<string, TimetablePlace>
  /** Place keys in the order of Website Settings → Locations (venues after). */
  placeOrder: string[]
  /** Meeting rooms by id — null when online details are not allowed (never an empty object in that case). */
  rooms: Record<string, TimetableRoom> | null
}

export function emptyTimetable(window: { from: string; to: string }, timeZone: string | null = null): TimetableData {
  return { window, timeZone, occurrences: [], series: [], closures: [], courses: {}, teachers: {}, places: {}, placeOrder: [], rooms: null }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

/** The fields of a person the shaping reads (PERSON_PUBLIC_FIELDS subset). */
export type TimetablePersonInput = { publicId: string; displayName?: string | null; firstName?: string | null; lastName?: string | null; hasPage?: boolean | null; slug?: { current?: string | null } | null }
export type TimetableCourseInput = { publicId: string; title?: string | null; color?: string | null }
export type TimetableVenueInput = { publicId: string; name?: string | null; address?: SiteLocation['address'] | null }
export type TimetableSiteLocation = Pick<SiteLocation, 'key' | 'name' | 'address' | 'accessNote'>

export type ShapeInput = {
  window: { from: string; to: string }
  locale: string
  defaultLocale: string
  timeZone?: string | null
  courses: TimetableCourseInput[]
  occurrences: ClassOccurrence[]
  series: ClassSeries[]
  closures: ScheduleClosure[]
  people: TimetablePersonInput[]
  siteLocations?: TimetableSiteLocation[] | null
  venues?: TimetableVenueInput[] | null
  /** Honoured ONLY when includeOnlineDetails is true. */
  rooms?: MeetingRoom[] | null
  includeOnlineDetails: boolean
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && dayNumber(v) !== null

/** A localized map → one string: the page language, the site's default, then English, then anything. */
export function pickLocalized(value: Record<string, string> | null | undefined, locale: string, defaultLocale: string): string | null {
  if (!value) return null
  const hit = [value[locale], value[defaultLocale], value.en].find((v) => typeof v === 'string' && v.trim())
  if (hit) return hit.trim()
  const any = Object.values(value).find((v) => typeof v === 'string' && v.trim())
  return any ? any.trim() : null
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

export function placeKeyOf(place: ClassOccurrence['place']): string | null {
  if (!place) return null
  return place.kind === 'location' ? place.key : `venue:${place.venuePublicId}`
}

function courseColor(v: unknown): TimetableCourse['color'] {
  return v === 'accent' || v === 'muted' ? v : 'none'
}

export function shapeTimetable(input: ShapeInput): TimetableData {
  const { window, locale, defaultLocale } = input
  const online = input.includeOnlineDetails === true

  const courses: Record<string, TimetableCourse> = {}
  for (const c of input.courses) {
    if (!c?.publicId || !c.title?.trim()) continue
    courses[c.publicId] = { id: c.publicId, title: c.title.trim(), color: courseColor(c.color) }
  }

  const teachers: Record<string, TimetableTeacher> = {}
  for (const p of input.people) {
    if (!p?.publicId) continue
    const name = personDisplayName(p)
    if (!name) continue
    const slug = p.slug?.current || null
    teachers[p.publicId] = { id: p.publicId, name, hasPage: p.hasPage === true && !!slug, slug }
  }

  // Places: the site's locations (in their order), then venues.
  const places: Record<string, TimetablePlace> = {}
  const placeOrder: string[] = []
  for (const l of input.siteLocations ?? []) {
    if (!l?.key) continue
    places[l.key] = {
      key: l.key,
      name: l.name?.trim() || l.key,
      lines: [...formatLocationAddress(l.address), ...(l.accessNote?.trim() ? [l.accessNote.trim()] : [])],
    }
    placeOrder.push(l.key)
  }
  for (const v of input.venues ?? []) {
    if (!v?.publicId) continue
    const key = `venue:${v.publicId}`
    places[key] = { key, name: v.name?.trim() || '', lines: formatLocationAddress(v.address ?? undefined) }
    placeOrder.push(key)
  }
  const knownPlace = (key: string | null) => (key && places[key] ? key : null)

  const teacherIdsOf = (ids: readonly string[]) => ids.filter((id) => teachers[id])

  const series: TimetableSeries[] = input.series
    .filter((s) => courses[s.ownerPublicId] && s.status === 'active' && s.weekday !== null)
    .map((s) => ({
      id: s.id,
      courseId: s.ownerPublicId,
      weekday: s.weekday as number,
      interval: s.interval,
      start: s.startLocal.slice(11, 16),
      end: s.endLocal ? s.endLocal.slice(11, 16) : null,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      teacherIds: teacherIdsOf(s.instructorPublicIds),
      languages: s.languages,
      mode: s.attendanceMode,
      placeKey: knownPlace(placeKeyOf(s.place)),
      meetingRoomId: online ? s.meetingRoomId : null,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId))

  const occurrences: TimetableOccurrence[] = input.occurrences
    .filter((o) => courses[o.ownerPublicId])
    .map((o) => ({
      id: o.id,
      seriesId: o.seriesId,
      courseId: o.ownerPublicId,
      date: o.startLocal.slice(0, 10),
      start: o.startLocal.slice(11, 16),
      end: o.endLocal ? o.endLocal.slice(11, 16) : null,
      status: o.status,
      teacherIds: teacherIdsOf(o.instructorPublicIds),
      languages: o.languages,
      mode: o.attendanceMode,
      placeKey: knownPlace(placeKeyOf(o.place)),
      note: pickLocalized(o.note, locale, defaultLocale),
      meetingRoomId: online ? o.meetingRoomId : null,
    }))
    .filter((o) => o.date >= window.from && o.date <= window.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId))

  // Closures overlapping the window, with the class dates around them.
  const activeSeries = input.series.filter((s) => courses[s.ownerPublicId] && s.status === 'active' && s.weekday !== null)
  const closures: TimetableClosure[] = input.closures
    .filter((c) => c.endsOn >= window.from && c.startsOn <= window.to)
    .map((c) => ({
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      label: pickLocalized(c.label, locale, defaultLocale),
      lastClass: classDateBefore(activeSeries, c.startsOn, input.closures),
      firstClass: classDateAfter(activeSeries, c.endsOn, input.closures),
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))

  let rooms: Record<string, TimetableRoom> | null = null
  if (online) {
    rooms = {}
    const used = new Set<string>()
    for (const s of series) if (s.meetingRoomId) used.add(s.meetingRoomId)
    for (const o of occurrences) if (o.meetingRoomId) used.add(o.meetingRoomId)
    for (const r of input.rooms ?? []) {
      if (!used.has(r.id)) continue
      rooms[r.id] = {
        id: r.id,
        label: r.label,
        joinUrl: r.joinUrl,
        meetingId: r.meetingId,
        passcode: r.passcode,
        note: pickLocalized(r.note, locale, defaultLocale),
      }
    }
  }

  // Only teachers/places that something on the page uses.
  const usedTeachers = new Set([...series, ...occurrences].flatMap((x) => x.teacherIds))
  const usedPlaces = new Set([...series, ...occurrences].map((x) => x.placeKey).filter((k): k is string => !!k))
  const usedCourses = new Set([...series, ...occurrences].map((x) => x.courseId))
  const prune = <T,>(rec: Record<string, T>, keep: Set<string>) => Object.fromEntries(Object.entries(rec).filter(([k]) => keep.has(k)))

  return {
    window,
    timeZone: input.timeZone ?? null,
    occurrences,
    series,
    closures,
    courses: prune(courses, usedCourses),
    teachers: prune(teachers, usedTeachers),
    places: prune(places, usedPlaces),
    placeOrder: placeOrder.filter((k) => usedPlaces.has(k)),
    rooms,
  }
}

// ── Class dates from the weekly patterns (closure "last / first class") ──────

const SEARCH_DAYS = 400

type PatternLike = Pick<ClassSeries, 'weekday' | 'interval' | 'startLocal' | 'startsOn' | 'endsOn'>

function inClosure(date: string, closures: readonly Pick<ScheduleClosure, 'startsOn' | 'endsOn'>[]): boolean {
  return closures.some((c) => date >= c.startsOn && date <= c.endsOn)
}

/** Does the weekly class take place on this date (ignoring closures and single-date edits)? */
export function patternOccursOn(s: PatternLike, date: string): boolean {
  if (s.weekday === null || weekdayOf(date) !== s.weekday) return false
  const anchor = s.startLocal.slice(0, 10)
  if (date < anchor) return false
  if (s.startsOn && date < s.startsOn) return false
  if (s.endsOn && date > s.endsOn) return false
  const a = dayNumber(anchor)
  const d = dayNumber(date)
  if (a === null || d === null) return false
  // "Every N weeks" counts from the Monday–Sunday week of the anchor.
  const weeks = Math.floor((d - (a - (weekdayOf(anchor) - 1))) / 7)
  return weeks % Math.max(1, s.interval) === 0
}

function classDateBefore(series: readonly PatternLike[], date: string, closures: readonly Pick<ScheduleClosure, 'startsOn' | 'endsOn'>[]): string | null {
  for (let i = 1; i <= SEARCH_DAYS; i++) {
    const d = addDays(date, -i)
    if (!inClosure(d, closures) && series.some((s) => patternOccursOn(s, d))) return d
  }
  return null
}

function classDateAfter(series: readonly PatternLike[], date: string, closures: readonly Pick<ScheduleClosure, 'startsOn' | 'endsOn'>[]): string | null {
  for (let i = 1; i <= SEARCH_DAYS; i++) {
    const d = addDays(date, i)
    if (!inClosure(d, closures) && series.some((s) => patternOccursOn(s, d))) return d
  }
  return null
}

// ── Calendar arithmetic for the views ────────────────────────────────────────

/** 'YYYY-MM' of a date. */
export const monthOf = (date: string) => date.slice(0, 7)
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { from, to: addDays(next, -1) }
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Monday of the week containing the date. */
export const weekStart = (date: string) => addDays(date, -(weekdayOf(date) - 1))

/** The 7 dates Monday–Sunday of the week that starts on `monday`. */
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

/** Calendar-grid weeks of a month: arrays of 7 dates, Monday first, covering the whole month. */
export function monthWeeks(month: string): string[][] {
  const { from, to } = monthRange(month)
  const weeks: string[][] = []
  for (let monday = weekStart(from); monday <= to; monday = addDays(monday, 7)) weeks.push(weekDates(monday))
  return weeks
}

/** Today's date in a zone ('YYYY-MM-DD'); UTC when the zone is unknown. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** Is `date` closed (inside a holiday)? */
export function closureOn(closures: readonly TimetableClosure[], date: string): TimetableClosure | null {
  return closures.find((c) => date >= c.startsOn && date <= c.endsOn) ?? null
}

/** Occurrences on one date (already sorted by time). */
export const occurrencesOn = (data: TimetableData, date: string) => data.occurrences.filter((o) => o.date === date)

/** Combine month-sized pieces of data into one (later pieces win on duplicate ids). */
export function mergeTimetables(parts: readonly TimetableData[]): TimetableData {
  if (parts.length === 0) return emptyTimetable({ from: '', to: '' })
  const seen = new Set<string>()
  const occurrences: TimetableOccurrence[] = []
  for (const p of [...parts].reverse()) for (const o of p.occurrences) if (!seen.has(o.id)) (seen.add(o.id), occurrences.push(o))
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId))
  const last = parts[parts.length - 1]
  const rooms = parts.some((p) => p.rooms) ? Object.assign({}, ...parts.map((p) => p.rooms ?? {})) : null
  const closureKey = (c: TimetableClosure) => `${c.startsOn}|${c.endsOn}`
  const closures = new Map<string, TimetableClosure>()
  for (const p of parts) for (const c of p.closures) closures.set(closureKey(c), c)
  return {
    window: { from: parts.map((p) => p.window.from).sort()[0], to: parts.map((p) => p.window.to).sort().slice(-1)[0] },
    timeZone: last.timeZone,
    occurrences,
    series: last.series,
    closures: [...closures.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
    courses: Object.assign({}, ...parts.map((p) => p.courses)),
    teachers: Object.assign({}, ...parts.map((p) => p.teachers)),
    places: Object.assign({}, ...parts.map((p) => p.places)),
    placeOrder: [...new Set(parts.flatMap((p) => p.placeOrder))],
    rooms,
  }
}

// ── The printed month (CYCE sheet style) ─────────────────────────────────────

export type PrintException =
  | { kind: 'cancelled'; date: string; note: string | null }
  | { kind: 'substitute'; date: string; teacherIds: string[] }
  | { kind: 'time'; date: string; start: string; end: string | null }
  | { kind: 'mode'; date: string; mode: AttendanceMode }
  | { kind: 'note'; date: string; note: string }

export type PrintClass = {
  seriesId: string
  courseId: string
  start: string
  end: string | null
  teacherIds: string[]
  languages: string[]
  mode: AttendanceMode
  meetingRoomId: string | null
  exceptions: PrintException[]
}

export type PrintRow = {
  /** A place key, or 'online' (online-only classes) or 'unplaced'. */
  key: string
  kind: 'place' | 'online' | 'unplaced'
  /** weekday (1–7) → that weekday's classes in time order. */
  cells: Record<number, PrintClass[]>
}

export type PrintMonth = {
  month: string
  closures: TimetableClosure[]
  /** Weekdays (1–7) that have at least one class, ascending. */
  weekdays: number[]
  rows: PrintRow[]
  /** Meeting rooms of the shown month's online / hybrid classes — null unless online details are allowed. */
  rooms: TimetableRoom[] | null
}

/** Exceptions of one dated session against its weekly pattern. */
export function exceptionsOf(o: TimetableOccurrence, s: TimetableSeries): PrintException[] {
  const out: PrintException[] = []
  if (o.status === 'cancelled') return [{ kind: 'cancelled', date: o.date, note: o.note }]
  if (!sameSet(o.teacherIds, s.teacherIds) && o.teacherIds.length > 0) out.push({ kind: 'substitute', date: o.date, teacherIds: o.teacherIds })
  if (o.start !== s.start || (o.end ?? null) !== (s.end ?? null)) out.push({ kind: 'time', date: o.date, start: o.start, end: o.end })
  if (o.mode !== s.mode) out.push({ kind: 'mode', date: o.date, mode: o.mode })
  if (o.note) out.push({ kind: 'note', date: o.date, note: o.note })
  return out
}

/**
 * The print sheet of a month: rows = places, columns = weekdays that have
 * classes, cells = the weekly classes with that month's exceptions. `data` must
 * cover the month (its occurrences are what decides which classes ran).
 */
export function buildPrintMonth(data: TimetableData, month: string): PrintMonth {
  const range = monthRange(month)
  const monthOccurrences = data.occurrences.filter((o) => o.date >= range.from && o.date <= range.to)
  const bySeries = new Map<string, TimetableOccurrence[]>()
  for (const o of monthOccurrences) (bySeries.get(o.seriesId) ?? bySeries.set(o.seriesId, []).get(o.seriesId)!).push(o)

  const rowOf = (s: TimetableSeries): { key: string; kind: PrintRow['kind'] } =>
    s.mode === 'online' ? { key: 'online', kind: 'online' } : s.placeKey ? { key: s.placeKey, kind: 'place' } : { key: 'unplaced', kind: 'unplaced' }

  const rows = new Map<string, PrintRow>()
  const weekdays = new Set<number>()
  for (const s of data.series) {
    const sessions = bySeries.get(s.id) ?? []
    if (sessions.length === 0) continue // not running this month
    const { key, kind } = rowOf(s)
    const row = rows.get(key) ?? { key, kind, cells: {} }
    rows.set(key, row)
    const exceptions = sessions.flatMap((o) => exceptionsOf(o, s)).sort((a, b) => a.date.localeCompare(b.date))
    ;(row.cells[s.weekday] ??= []).push({
      seriesId: s.id,
      courseId: s.courseId,
      start: s.start,
      end: s.end,
      teacherIds: s.teacherIds,
      languages: s.languages,
      mode: s.mode,
      meetingRoomId: s.meetingRoomId,
      exceptions,
    })
    weekdays.add(s.weekday)
  }
  for (const row of rows.values()) for (const list of Object.values(row.cells)) list.sort((a, b) => a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId))

  const order = (r: PrintRow) => (r.kind === 'place' ? data.placeOrder.indexOf(r.key) : r.kind === 'unplaced' ? 9998 : 9999)
  const sortedRows = [...rows.values()].sort((a, b) => order(a) - order(b))

  let rooms: TimetableRoom[] | null = null
  if (data.rooms) {
    const ids = new Set<string>()
    for (const row of sortedRows) for (const list of Object.values(row.cells)) for (const c of list) if (c.meetingRoomId && c.mode !== 'inPerson') ids.add(c.meetingRoomId)
    rooms = [...ids].map((id) => data.rooms![id]).filter((r): r is TimetableRoom => !!r)
  }

  return {
    month,
    closures: data.closures.filter((c) => c.endsOn >= range.from && c.startsOn <= range.to),
    weekdays: [...weekdays].sort((a, b) => a - b),
    rows: sortedRows,
    rooms,
  }
}

/** The months (YYYY-MM) a list of dates touches, ascending. */
export function monthsOfDates(dates: readonly string[]): string[] {
  return [...new Set(dates.map(monthOf))].sort()
}

/** Months whose every day lies inside the window (the data for them is complete). */
export function coveredMonths(window: { from: string; to: string }): string[] {
  if (!isDate(window.from) || !isDate(window.to) || window.to < window.from) return []
  const out: string[] = []
  for (let m = monthOf(window.from); m <= monthOf(window.to); m = addMonths(m, 1)) {
    const r = monthRange(m)
    if (r.from >= window.from && r.to <= window.to) out.push(m)
  }
  return out
}
