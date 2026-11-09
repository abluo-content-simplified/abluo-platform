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

import { formatLocationAddress, getLocationMapsLink } from '@/lib/maps/locations'
import { imageUrl } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { addDays, dayNumber, parseClassRule, ruleOccursOn, ruleWeekdays, weekdayOf, type ClassRule } from '@/lib/scheduling/recurrence'
import type { AttendanceMode, ClassOccurrence, ClassSeries, MeetingRoom, ScheduleClosure } from '@/lib/scheduling/types'
import { personDisplayName } from '@/lib/modules/people/model'
import { normalizeCourseColor, type CourseColor } from './palette'
import type { ResolvedImage, SiteLocation } from '@/lib/sanity/types'

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

/** A Media Library image, ready to render: a CDN url (sized for its use), alt text and the focal point as a CSS object-position. */
export type TimetableImage = { src: string; alt: string; position: string }
export type TimetableCourse = {
  id: string
  title: string
  /** Palette key (palette.ts); legacy values are normalised when shaped. */
  color: CourseColor
  /** The course's description (page language), for the class panel and the printed "About the courses" page. */
  description: string | null
  /** The course's optional image (Media Library). */
  image: TimetableImage | null
  /** The course page address in the page language (no fallback); null/absent = no course page in this language. */
  slug?: string | null
}
export type TimetableTeacher = { id: string; name: string; /** Volunteer teacher: shown as "name*" with a footnote. */ volunteer: boolean; hasPage: boolean; slug: string | null; /** A small portrait when People has one (decorative: the name is written beside it). */ photo: TimetableImage | null }
/** `mapsUrl`: an outbound "open in maps" link (never an embed), or null when the place carries nothing to point at. */
export type TimetablePlace = { key: string; name: string; /** Optional short label (Website Settings → Locations → Short name); the UI falls back to `name`. */ short: string | null; lines: string[]; mapsUrl: string | null }
export type TimetableRoom = { id: string; label: string; joinUrl: string | null; meetingId: string | null; passcode: string | null; note: string | null }

/**
 * An event (workshop) of the Events module shown beside the classes — only when the section asks for it
 * (`includeEvents`) and the Events module is installed. Cancelled events are never in the data.
 * `slug` builds the link to the event page (`<site base>/events/<slug>`); null = no link.
 */
export type TimetableEvent = {
  id: string
  eventId: string
  title: string
  slug: string | null
  date: string
  start: string
  end: string | null
  placeName: string | null
}

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
  /** What differs from the class (weekly pattern); null when nothing does. Computed server-side. */
  change: TimetableChange | null
}

/** How one dated session differs from its class. Holidays are not changes (no session exists). */
export type TimetableChange = {
  cancelled: boolean
  /** Effective teachers differ from the class's (a class with no base teachers never counts: rotating classes). */
  substitute: boolean
  /** Date or start/end differ from the originally generated time. */
  timeChanged: boolean
  /** Effective place differs from the class's place. */
  moved: boolean
  originalStart: string | null
  originalEnd: string | null
  originalDate: string | null
  originalTeacherIds: string[]
  originalPlaceKey: string | null
}

/** The weekly pattern of one class (the print grid's cells). */
export type TimetableSeries = {
  id: string
  courseId: string
  /** The first weekday of the class (1 = Monday … 7 = Sunday). */
  weekday: number
  /** Every weekday the class meets (several for "Monday and Wednesday"; the weekday of the first date for monthly-by-date and once). */
  weekdays: number[]
  interval: number
  /** The stored repeat rule (`describeClassRepeat` reads it; ruleOccursOn decides closed dates). */
  rule: string | null
  /** The date of the pattern's first class ('YYYY-MM-DD'): "every N weeks" counts from its week. */
  anchor: string
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
  /** Events (workshops) in the window; empty unless the section includes events. */
  events: TimetableEvent[]
  courses: Record<string, TimetableCourse>
  teachers: Record<string, TimetableTeacher>
  places: Record<string, TimetablePlace>
  /** Place keys in the order of Website Settings → Locations (venues after). */
  placeOrder: string[]
  /** Meeting rooms by id — null when online details are not allowed (never an empty object in that case). */
  rooms: Record<string, TimetableRoom> | null
}

export function emptyTimetable(window: { from: string; to: string }, timeZone: string | null = null): TimetableData {
  return { window, timeZone, occurrences: [], series: [], closures: [], events: [], courses: {}, teachers: {}, places: {}, placeOrder: [], rooms: null }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

/** The fields of a person the shaping reads (PERSON_PUBLIC_FIELDS subset). */
export type TimetableImageInput = Partial<ResolvedImage> | null
export type TimetablePersonInput = { publicId: string; displayName?: string | null; firstName?: string | null; lastName?: string | null; hasPage?: boolean | null; slug?: { current?: string | null } | null; photo?: TimetableImageInput; /** People module: volunteer teacher. Absent until the field exists = false. */ volunteer?: boolean | null }
export type TimetableCourseInput = { publicId: string; title?: string | null; color?: string | null; shortDescription?: string | null; image?: TimetableImageInput; /** Course page slug in the page language (COURSE_PUBLIC_FIELDS). */ slug?: string | null }
export type TimetableVenueInput = { publicId: string; name?: string | null; address?: SiteLocation['address'] | null }
export type TimetableSiteLocation = Pick<SiteLocation, 'key' | 'name' | 'address' | 'accessNote'> & Partial<Pick<SiteLocation, 'mapsUrl' | 'pin' | 'shortName'>>

/** Image widths: the panel's course image is shown at most ~34rem wide; a teacher's portrait is a 48px circle. */
const COURSE_IMAGE_WIDTH = 960
const TEACHER_PHOTO_WIDTH = 96

function imageOf(input: TimetableImageInput | undefined, width: number): TimetableImage | null {
  if (!input?.asset) return null
  const src = imageUrl(input as ResolvedImage, width)
  if (!src) return null
  return { src, alt: typeof input.alt === 'string' ? input.alt.trim() : '', position: focalObjectPosition(input) }
}

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
  /** Events already shaped by shapeTimetableEvents (timetable-events.ts); omitted = none. */
  events?: TimetableEvent[] | null
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

/** Current keys, and the legacy 'accent' / 'muted' read as c1 / c6 (no data migration). */
function courseColor(v: unknown): TimetableCourse['color'] {
  return normalizeCourseColor(v)
}

export function shapeTimetable(input: ShapeInput): TimetableData {
  const { window, locale, defaultLocale } = input
  const online = input.includeOnlineDetails === true

  const courses: Record<string, TimetableCourse> = {}
  for (const c of input.courses) {
    if (!c?.publicId || !c.title?.trim()) continue
    courses[c.publicId] = {
      id: c.publicId,
      title: c.title.trim(),
      color: courseColor(c.color),
      description: c.shortDescription?.trim() || null,
      image: imageOf(c.image, COURSE_IMAGE_WIDTH),
      slug: typeof c.slug === 'string' && c.slug.trim() ? c.slug.trim() : null,
    }
  }

  const teachers: Record<string, TimetableTeacher> = {}
  for (const p of input.people) {
    if (!p?.publicId) continue
    const name = personDisplayName(p)
    if (!name) continue
    const slug = p.slug?.current || null
    const photo = imageOf(p.photo, TEACHER_PHOTO_WIDTH)
    teachers[p.publicId] = { id: p.publicId, name, volunteer: p.volunteer === true, hasPage: p.hasPage === true && !!slug, slug, photo: photo ? { ...photo, alt: '' } : null }
  }

  // Places: the site's locations (in their order), then venues.
  const places: Record<string, TimetablePlace> = {}
  const placeOrder: string[] = []
  for (const l of input.siteLocations ?? []) {
    if (!l?.key) continue
    places[l.key] = {
      key: l.key,
      name: l.name?.trim() || l.key,
      short: l.shortName?.trim() || null,
      lines: [...formatLocationAddress(l.address), ...(l.accessNote?.trim() ? [l.accessNote.trim()] : [])],
      mapsUrl: getLocationMapsLink({ mapsUrl: l.mapsUrl, pin: l.pin, address: l.address }),
    }
    placeOrder.push(l.key)
  }
  for (const v of input.venues ?? []) {
    if (!v?.publicId) continue
    const key = `venue:${v.publicId}`
    places[key] = { key, name: v.name?.trim() || '', short: null, lines: formatLocationAddress(v.address ?? undefined), mapsUrl: getLocationMapsLink({ address: v.address ?? undefined }) }
    placeOrder.push(key)
  }
  const knownPlace = (key: string | null) => (key && places[key] ? key : null)

  const teacherIdsOf = (ids: readonly string[]) => ids.filter((id) => teachers[id])

  const series: TimetableSeries[] = input.series
    .filter((s) => courses[s.ownerPublicId] && s.status === 'active' && classRuleOf(s) !== null)
    .map((s) => ({
      id: s.id,
      courseId: s.ownerPublicId,
      weekday: weekdaysOf(s)[0],
      weekdays: weekdaysOf(s),
      interval: s.interval,
      rule: s.rule,
      anchor: s.startLocal.slice(0, 10),
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

  const seriesById = new Map(input.series.map((s) => [s.id, s]))
  const changeOfOccurrence = (o: ClassOccurrence, effectiveTeachers: string[], effectivePlace: string | null): TimetableChange | null => {
    const s = seriesById.get(o.seriesId)
    const cancelled = o.status === 'cancelled'
    const baseTeachers = s ? teacherIdsOf(s.instructorPublicIds) : []
    const substitute = !cancelled && baseTeachers.length > 0 && !sameSet(effectiveTeachers, baseTeachers)
    const origin = o.originalStartLocal
    const originalEnd = s?.endLocal ? s.endLocal.slice(11, 16) : null
    const date = o.startLocal.slice(0, 10)
    const start = o.startLocal.slice(11, 16)
    const end = o.endLocal ? o.endLocal.slice(11, 16) : null
    const originalDate = origin ? origin.slice(0, 10) : null
    const originalStart = origin ? origin.slice(11, 16) : null
    // The original end: the class's end time on the original date (a time-only pattern).
    const timeChanged = !!origin && (originalDate !== date || originalStart !== start || (originalEnd !== null && end !== null && originalEnd !== end))
    const basePlace = s ? knownPlace(placeKeyOf(s.place)) : null
    const moved = !cancelled && !!effectivePlace && !!basePlace && effectivePlace !== basePlace
    if (!cancelled && !substitute && !timeChanged && !moved) return null
    return {
      cancelled,
      substitute,
      timeChanged,
      moved,
      originalStart: timeChanged ? originalStart : null,
      originalEnd: timeChanged ? originalEnd : null,
      originalDate: timeChanged && originalDate !== date ? originalDate : null,
      originalTeacherIds: substitute ? baseTeachers : [],
      originalPlaceKey: moved ? basePlace : null,
    }
  }

  const occurrences: TimetableOccurrence[] = input.occurrences
    .filter((o) => courses[o.ownerPublicId])
    .map((o) => {
      const teacherIds = teacherIdsOf(o.instructorPublicIds)
      const placeKey = knownPlace(placeKeyOf(o.place))
      return {
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
      change: changeOfOccurrence(o, teacherIds, placeKey),
    }})
    .filter((o) => o.date >= window.from && o.date <= window.to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId))

  // Closures overlapping the window, with the class dates around them.
  const activeSeries = input.series.filter((s) => courses[s.ownerPublicId] && s.status === 'active' && classRuleOf(s) !== null)
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
    events: (input.events ?? []).filter((e) => e.date >= window.from && e.date <= window.to).sort(compareEvents),
    courses: prune(courses, usedCourses),
    teachers: prune(teachers, usedTeachers),
    places: prune(places, usedPlaces),
    placeOrder: placeOrder.filter((k) => usedPlaces.has(k)),
    rooms,
  }
}

export const compareEvents = (a: TimetableEvent, b: TimetableEvent) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title)

// ── Class dates from the weekly patterns (closure "last / first class") ──────

const SEARCH_DAYS = 400

type PatternLike = Pick<ClassSeries, 'weekday' | 'interval' | 'startLocal' | 'startsOn' | 'endsOn'> & { rule?: string | null; weekdays?: number[] }

/** The class's repeat: its stored rule, else (hand-built rows without one) weekly on its weekday. Null when it has neither. */
function classRuleOf(s: Pick<PatternLike, 'rule' | 'weekday' | 'interval'>): ClassRule | null {
  const parsed = parseClassRule(s.rule)
  if (parsed) return parsed
  return s.weekday !== null && s.weekday >= 1 && s.weekday <= 7 ? { kind: 'weekly', weekdays: [s.weekday], interval: Math.max(1, s.interval) } : null
}

function weekdaysOf(s: PatternLike): number[] {
  const rule = classRuleOf(s)
  return rule ? ruleWeekdays(rule, s.startLocal.slice(0, 10)) : s.weekdays?.length ? s.weekdays : [s.weekday ?? 1]
}

function inClosure(date: string, closures: readonly Pick<ScheduleClosure, 'startsOn' | 'endsOn'>[]): boolean {
  return closures.some((c) => date >= c.startsOn && date <= c.endsOn)
}

/** Does the class take place on this date by its repeat (ignoring closures and single-date edits)? */
export function patternOccursOn(s: PatternLike, date: string): boolean {
  const rule = classRuleOf(s)
  if (!rule) return false
  const anchor = s.startLocal.slice(0, 10)
  if (date < anchor) return false
  if (s.startsOn && date < s.startsOn) return false
  if (s.endsOn && date > s.endsOn) return false
  return ruleOccursOn(rule, date, anchor)
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
    events: [...new Map(parts.flatMap((p) => p.events ?? []).map((e) => [e.id, e])).values()].sort(compareEvents),
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
  /** The weekly class would fall on this date but the site is closed (holiday): no session exists. */
  | { kind: 'closed'; date: string }
  | { kind: 'substitute'; date: string; teacherIds: string[] }
  | { kind: 'time'; date: string; start: string; end: string | null }
  | { kind: 'mode'; date: string; mode: AttendanceMode }
  | { kind: 'note'; date: string; note: string }

export type PrintClass = {
  /** For a class that is not plainly weekly (monthly, once): its date(s) in THIS month, printed beside the time so it does not read as weekly. null = weekly. */
  dates: string[] | null
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
  /** A place key, or 'unplaced'. (Online-only classes are not rows: they sit in PrintMonth.online.) */
  key: string
  kind: 'place' | 'unplaced'
  /** weekday (1–7) → that weekday's classes in time order. */
  cells: Record<number, PrintClass[]>
}

export type PrintMonth = {
  month: string
  closures: TimetableClosure[]
  /** Always the seven weekdays, Monday to Sunday (the sheet never hides a day). */
  weekdays: number[]
  rows: PrintRow[]
  /** The "Online" block: online-only AND hybrid classes by weekday (hybrid ones also stay in their place's row). null = none this month. */
  online: Record<number, PrintClass[]> | null
  /** The month's holidays as date ranges clipped to the month ("2 November"), with the closure's label. */
  holidays: { startsOn: string; endsOn: string; label: string | null }[]
  /** Events (workshops) of the month, in time order. */
  events: TimetableEvent[]
  /** True when a teacher shown on the sheet is a volunteer — the sheet adds the footnote. */
  hasVolunteers: boolean
  /** Meeting rooms of the shown month's online / hybrid classes — null unless online details are allowed. */
  rooms: TimetableRoom[] | null
  /** The courses shown on the sheet (each once), by title — for the optional "About the courses" page. */
  courseIds: string[]
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

/** Dates of the month where the weekly pattern would meet but a closure (holiday) removed the session. */
function closedDatesOf(s: TimetableSeries, sessions: readonly TimetableOccurrence[], closures: readonly TimetableClosure[], range: { from: string; to: string }): PrintException[] {
  const out: PrintException[] = []
  const have = new Set(sessions.map((o) => o.date))
  const pattern = { rule: s.rule, weekday: s.weekday, interval: s.interval, startLocal: `${s.anchor}T00:00`, startsOn: s.startsOn, endsOn: s.endsOn }
  for (const c of closures) {
    const from = c.startsOn > range.from ? c.startsOn : range.from
    const to = c.endsOn < range.to ? c.endsOn : range.to
    for (let d = from; d <= to; d = addDays(d, 1)) if (!have.has(d) && patternOccursOn(pattern, d)) out.push({ kind: 'closed', date: d })
  }
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
    s.placeKey ? { key: s.placeKey, kind: 'place' } : { key: 'unplaced', kind: 'unplaced' }

  const rows = new Map<string, PrintRow>()
  const onlineCells: Record<number, PrintClass[]> = {}
  for (const s of data.series) {
    const sessions = bySeries.get(s.id) ?? []
    if (sessions.length === 0) continue // not running this month
    const { key, kind } = rowOf(s)
    // Online-only classes have no building row; hybrid ones are in their row AND in the online block.
    const row = s.mode === 'online' ? null : (rows.get(key) ?? { key, kind, cells: {} })
    if (row) rows.set(key, row)
    const put = (wd: number, c: PrintClass) => {
      if (row) (row.cells[wd] ??= []).push(c)
      if (s.mode !== 'inPerson') (onlineCells[wd] ??= []).push(c)
    }
    const all = [...sessions.flatMap((o) => exceptionsOf(o, s)), ...closedDatesOf(s, sessions, data.closures, range)].sort((a, b) => a.date.localeCompare(b.date))
    const cell = (dates: string[] | null, exceptions: PrintException[]): PrintClass => ({
      dates,
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
    const ruleKind = parseClassRule(s.rule)?.kind
    if (ruleKind === 'monthlyWeekday' || ruleKind === 'monthlyDay' || ruleKind === 'once') {
      // Not plainly weekly: the column is the weekday the session(s) actually fall on this month, and the date is printed.
      const byWeekday = new Map<number, string[]>()
      for (const o of sessions) byWeekday.set(weekdayOf(o.date), [...(byWeekday.get(weekdayOf(o.date)) ?? []), o.date])
      for (const [wd, dates] of byWeekday) {
        put(wd, cell([...new Set(dates)].sort(), all.filter((e) => weekdayOf(e.date) === wd)))
      }
      continue
    }
    // Weekly (one or several days): a column per weekday, with only that weekday's exceptions and holiday dates.
    for (const wd of s.weekdays) {
      // (A session moved to a day the class never meets on stays with the first column, so it is not lost.)
      const mine = (e: PrintException) => weekdayOf(e.date) === wd || (!s.weekdays.includes(weekdayOf(e.date)) && wd === s.weekdays[0])
      put(wd, cell(null, all.filter(mine)))
    }
  }
  const byTime = (a: PrintClass, b: PrintClass) => a.start.localeCompare(b.start) || a.courseId.localeCompare(b.courseId)
  for (const row of rows.values()) for (const list of Object.values(row.cells)) list.sort(byTime)
  for (const list of Object.values(onlineCells)) list.sort(byTime)
  const hasOnline = Object.keys(onlineCells).length > 0

  const order = (r: PrintRow) => (r.kind === 'place' ? data.placeOrder.indexOf(r.key) : 9998)
  const sortedRows = [...rows.values()].sort((a, b) => order(a) - order(b))

  let rooms: TimetableRoom[] | null = null
  if (data.rooms) {
    const ids = new Set<string>()
    for (const list of Object.values(onlineCells)) for (const c of list) if (c.meetingRoomId) ids.add(c.meetingRoomId)
    rooms = [...ids].map((id) => data.rooms![id]).filter((r): r is TimetableRoom => !!r)
  }

  const shown = new Set<string>()
  const shownTeachers = new Set<string>()
  const lists = [...sortedRows.flatMap((r) => Object.values(r.cells)), ...Object.values(onlineCells)]
  for (const list of lists) for (const c of list) (shown.add(c.courseId), c.teacherIds.forEach((t) => shownTeachers.add(t)))
  const monthEvents = (data.events ?? []).filter((e) => e.date >= range.from && e.date <= range.to)
  for (const o of monthOccurrences) if (o.status !== 'cancelled' && o.teacherIds.length && shown.has(o.courseId)) o.teacherIds.forEach((t) => shownTeachers.add(t))
  const holidays = data.closures
    .filter((c) => c.endsOn >= range.from && c.startsOn <= range.to)
    .map((c) => ({ startsOn: c.startsOn < range.from ? range.from : c.startsOn, endsOn: c.endsOn > range.to ? range.to : c.endsOn, label: c.label }))
  const courseIds = [...shown].filter((id) => data.courses[id]).sort((a, b) => data.courses[a].title.localeCompare(data.courses[b].title))

  return {
    month,
    closures: data.closures.filter((c) => c.endsOn >= range.from && c.startsOn <= range.to),
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    rows: sortedRows,
    online: hasOnline ? onlineCells : null,
    holidays,
    events: monthEvents,
    hasVolunteers: [...shownTeachers].some((id) => data.teachers[id]?.volunteer === true),
    rooms,
    courseIds,
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

// ── Language filter, weekends, volunteers (website views and print) ──────────

/** A session's lesson languages: its own when it carries any, else its class's (series) languages. One rule for the grid, the filter list and the filter. */
export function occurrenceLanguages(o: Pick<TimetableOccurrence, 'languages' | 'seriesId'>, series: ReadonlyMap<string, Pick<TimetableSeries, 'languages'>> | readonly Pick<TimetableSeries, 'id' | 'languages'>[]): string[] {
  if (o.languages.length > 0) return o.languages
  const map = series instanceof Map ? series : new Map((series as readonly Pick<TimetableSeries, 'id' | 'languages'>[]).map((x) => [x.id, x]))
  return map.get(o.seriesId)?.languages ?? []
}

/** The lesson languages present in the given sessions (and, when `includeSeries`, the classes), ascending; fewer than two = no filter is offered. */
export function languagesIn(data: Pick<TimetableData, 'occurrences' | 'series'>, occurrences: readonly TimetableOccurrence[] = data.occurrences, includeSeries = true): string[] {
  const set = new Set<string>()
  for (const o of occurrences) for (const l of occurrenceLanguages(o, data.series)) if (l) set.add(l)
  if (includeSeries) for (const x of data.series) for (const l of x.languages) if (l) set.add(l)
  return [...set].sort()
}

/**
 * The data narrowed to the classes taught in one language (a class listing several languages stays under each of
 * them; a class with no language set is hidden while a language is chosen). Events are not language-bound and stay.
 * `null` = no filter. Pure and client-side. The website filter is for the screen only: print never uses it.
 */
export function filterByLanguage(data: TimetableData, language: string | null): TimetableData {
  if (!language) return data
  return {
    ...data,
    occurrences: data.occurrences.filter((o) => occurrenceLanguages(o, data.series).includes(language)),
    series: data.series.filter((x) => x.languages.includes(language)),
  }
}

/** Saturday or Sunday (the views shade them). */
export const isWeekend = (date: string) => weekdayOf(date) >= 6

/** Does any teacher of these sessions have the volunteer mark? */
export function anyVolunteer(data: Pick<TimetableData, 'teachers'>, occurrences: readonly Pick<TimetableOccurrence, 'teacherIds' | 'status'>[]): boolean {
  return occurrences.some((o) => o.status !== 'cancelled' && o.teacherIds.some((id) => data.teachers[id]?.volunteer === true))
}
