// The printed week / month as plain data: what the print view shows, in
// reading order. Pure — the print view only lays these blocks out on A4 pages.
//
// Both are built from the REAL dated sessions (never from the weekly pattern),
// so a cancelled or changed class is shown on its own date, where people look:
//   • Print week: one section per day of the week (portrait), a row per class.
//   • Print month: a calendar, one row of seven days per week (landscape), a
//     card per class. Days outside the month show their classes when that month
//     is published, or one "not available yet" note when it is not.
// Then the period's schedule updates (all of them, as a summary), the online
// rooms when their details are allowed, the notes.
//
// Input is the timetable data AFTER the on-screen filters, so the printout
// shows exactly what the visitor chose (and the header says which filters).

import { addMonths, monthOf, monthRange, weekDates, weekStart, type TimetableData, type TimetableOccurrence, type TimetableRoom } from '@/lib/modules/courses/timetable'
import { addDays } from '@/lib/scheduling/recurrence'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { formatDate, languageName, listNames, monthTitle, timeRange } from './format'
import { changeSentence } from './ScheduleUpdates'
import { changeOf, hasChange, placeShort } from './status'
import type { Filters } from './filters'

export type PrintTeacher = { id: string; name: string; volunteer: boolean; href: string | null }

/** One dated session (or workshop), as printed in the week list and the month calendar. */
export type PrintSession = {
  id: string
  kind: 'class' | 'event'
  time: string
  timeChanged: boolean
  course: string
  href: string | null
  tags: ('hybrid' | 'online' | 'workshop')[]
  teachers: PrintTeacher[]
  teacherChanged: boolean
  location: string
  locationChanged: boolean
  /** Language codes ("EN/FR") for the calendar, names ("English, French") for the list. */
  languageCodes: string
  languages: string
  cancelled: boolean
  /** Small lines under the class: "instead of Sabrina M.", "was 18:00", a note. */
  notes: string[]
}

export type PrintDay = {
  date: string
  /** "Monday 9 November" (week list) / weekday short + day number (calendar). */
  name: string
  weekdayShort: string
  dayNumber: string
  /** Month short name when the day is outside the printed month ("Dec"); null inside. */
  otherMonth: string | null
  /** The holiday covering the day ("Holiday"); null = none. */
  holiday: string | null
  sessions: PrintSession[]
  weekend: boolean
}

/** A calendar row: the seven days, or a "not available yet" note over the days of a month with no published classes. */
export type PrintWeekCell = { kind: 'day'; day: PrintDay } | { kind: 'unavailable'; days: PrintDay[]; text: string }

export type PrintUpdateModel = { id: string; date: string; text: string }

export type PrintDoc = {
  kind: 'week' | 'month'
  title: string
  /** "November 2026" / "9 – 15 November 2026". */
  periodLabel: string
  siteHost: string | null
  /** "Filtered: Language: English · Teacher: Anna" — null when nothing is filtered. */
  filters: string | null
  holidays: string | null
  /** Week: the seven days (days without classes are left out). */
  days: PrintDay[]
  /** Month: the calendar rows. */
  weeks: PrintWeekCell[][]
  updates: PrintUpdateModel[]
  rooms: TimetableRoom[]
  hasVolunteers: boolean
  courses: { id: string; title: string; description: string | null }[]
  generatedOn: string
}

export type PrintOptions = {
  kind: 'week' | 'month'
  /** Any date in the week / month to print. */
  anchor: string
  title: string
  locale: string
  msg: TimetableMessages
  /** The active filters, and the unfiltered data (to name them and to know which months are published). */
  filters: Filters
  allData: TimetableData
  siteHost: string | null
  eventsBase: string
  /** When the schedule is generated (shown in the footer, in the site's time zone). */
  now: Date
  teacherHref: (t: { hasPage: boolean; slug: string | null }) => string | null
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name
}

/** The active filters as one line, named from the unfiltered data. */
export function filtersLine(f: Filters, all: TimetableData, locale: string, msg: TimetableMessages): string | null {
  const parts: string[] = []
  if (f.language) parts.push(msg.filterValue(msg.languageFilter, languageName(locale, f.language)))
  if (f.teacher) parts.push(msg.filterValue(msg.teacherFilter, all.teachers[f.teacher]?.name ?? f.teacher))
  if (f.place) parts.push(msg.filterValue(msg.locationFilter, all.places[f.place]?.name ?? f.place))
  if (f.course) parts.push(msg.filterValue(msg.courseFilter, all.courses[f.course]?.title ?? f.course))
  return parts.length > 0 ? msg.filteredBy(parts.join(' · ')) : null
}

/** One sentence for every way a session differs from its class: teacher, time, place, language, attendance, cancellation, note. */
export function updateText(occ: TimetableOccurrence, data: TimetableData, msg: TimetableMessages, locale: string): string | null {
  const series = data.series.find((s) => s.id === occ.seriesId)
  const c = changeOf(occ, series)
  const course = data.courses[occ.courseId]?.title ?? ''
  const extra: string[] = []
  if (!c.cancelled && series) {
    if (occ.languages.length > 0 && !sameSet(occ.languages, series.languages)) extra.push(msg.changeLanguage(listNames(locale, occ.languages.map((l) => languageName(locale, l)))))
    if (occ.mode !== series.mode) extra.push(occ.mode === 'inPerson' ? msg.noHybrid : occ.mode === 'online' ? msg.onlineOnly : msg.hybrid)
  }
  if (occ.note) extra.push(occ.note)
  if (!hasChange(c) && extra.length === 0) return null
  const head = hasChange(c) ? changeSentence(occ, data, msg, locale) : msg.courseAt(course, occ.start)
  return extra.length > 0 ? `${head}${hasChange(c) ? ' · ' : ' — '}${extra.join(' · ')}` : head
}

function sessionOf(occ: TimetableOccurrence, data: TimetableData, o: PrintOptions): PrintSession {
  const { msg, locale } = o
  const series = data.series.find((s) => s.id === occ.seriesId)
  const c = changeOf(occ, series)
  const place = occ.placeKey ? data.places[occ.placeKey] : null
  const room = occ.meetingRoomId && data.rooms ? data.rooms[occ.meetingRoomId] : null
  const online = room ? `${msg.online} (${room.label})` : msg.online
  const location = occ.mode === 'online' ? online : occ.mode === 'mixed' ? `${placeShort(place) || msg.otherPlace} + ${msg.online.toLowerCase()}` : placeShort(place) || ''
  const notes: string[] = []
  if (!c.cancelled) {
    if (c.substitute && c.originalTeacherIds.length > 0) notes.push(msg.insteadOf(listNames(locale, c.originalTeacherIds.flatMap((id) => (data.teachers[id] ? [shortName(data.teachers[id].name)] : [])))))
    if (c.timeChanged && c.originalStart) notes.push(msg.wasTime(timeRange(c.originalStart, c.originalEnd)))
    if (series && occ.languages.length > 0 && !sameSet(occ.languages, series.languages)) notes.push(msg.changeLanguage(listNames(locale, occ.languages.map((l) => languageName(locale, l)))))
    if (series && occ.mode !== series.mode) notes.push(occ.mode === 'inPerson' ? msg.noHybrid : occ.mode === 'online' ? msg.onlineOnly : msg.hybrid)
  }
  if (occ.note) notes.push(occ.note)
  return {
    id: occ.id,
    kind: 'class',
    time: timeRange(occ.start, occ.end),
    timeChanged: c.timeChanged && !c.cancelled,
    course: data.courses[occ.courseId]?.title ?? '',
    href: null,
    tags: occ.mode === 'mixed' ? ['hybrid'] : occ.mode === 'online' ? ['online'] : [],
    teachers: occ.teacherIds.flatMap((id) => {
      const t = data.teachers[id]
      return t ? [{ id, name: t.name, volunteer: !!t.volunteer, href: o.teacherHref(t) }] : []
    }),
    teacherChanged: c.substitute && !c.cancelled,
    location,
    locationChanged: c.moved && !c.cancelled,
    languageCodes: occ.languages.map((l) => l.toUpperCase()).join('/'),
    languages: listNames(locale, occ.languages.map((l) => languageName(locale, l))),
    cancelled: c.cancelled,
    notes,
  }
}

function dayOf(date: string, data: TimetableData, o: PrintOptions, month: string | null): PrintDay {
  const { locale, msg } = o
  const closure = data.closures.find((c) => c.startsOn <= date && date <= c.endsOn)
  const sessions = data.occurrences
    .filter((x) => x.date === date)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map((x) => sessionOf(x, data, o))
  for (const e of data.events.filter((x) => x.date === date))
    sessions.push({
      id: e.id,
      kind: 'event',
      time: timeRange(e.start, e.end),
      timeChanged: false,
      course: e.title,
      href: e.slug && o.eventsBase ? `${o.eventsBase}/${e.slug}` : null,
      tags: ['workshop'],
      teachers: [],
      teacherChanged: false,
      location: e.placeName ?? '',
      locationChanged: false,
      languageCodes: '',
      languages: '',
      cancelled: false,
      notes: [],
    })
  sessions.sort((a, b) => a.time.localeCompare(b.time))
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay()
  return {
    date,
    name: formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' }),
    weekdayShort: formatDate(locale, date, { weekday: 'short' }),
    dayNumber: formatDate(locale, date, { day: 'numeric' }),
    otherMonth: month && monthOf(date) !== month ? formatDate(locale, date, { month: 'short' }) : null,
    holiday: closure ? (closure.label ?? msg.closed) : null,
    sessions,
    weekend: wd === 0 || wd === 6,
  }
}

export function buildPrintDoc(data: TimetableData, o: PrintOptions): PrintDoc {
  const { locale, msg } = o
  const month = monthOf(o.anchor)
  const monday = weekStart(o.anchor)
  const range = o.kind === 'month' ? monthRange(month) : { from: monday, to: addDays(monday, 6) }

  let days: PrintDay[] = []
  const weeks: PrintWeekCell[][] = []
  if (o.kind === 'week') {
    days = weekDates(monday)
      .map((d) => dayOf(d, data, o, null))
      .filter((d) => d.sessions.length > 0 || d.holiday)
  } else {
    // A month is published when the unfiltered data has any class in it.
    const published = (m: string) => m === month || o.allData.occurrences.some((x) => monthOf(x.date) === m)
    for (let mon = weekStart(range.from); mon <= range.to; mon = addDays(mon, 7)) {
      const week = weekDates(mon).map((d) => dayOf(d, data, o, month))
      // A week whose days in the month have nothing on them (e.g. a lone Sunday the 1st) is left out.
      if (!week.some((d) => !d.otherMonth && (d.sessions.length > 0 || d.holiday))) continue
      const cells: PrintWeekCell[] = []
      for (const day of week) {
        const m = monthOf(day.date)
        const last = cells[cells.length - 1]
        if (day.otherMonth && !published(m)) {
          if (last?.kind === 'unavailable' && monthOf(last.days[0].date) === m) last.days.push(day)
          else cells.push({ kind: 'unavailable', days: [day], text: msg.notAvailableYet(formatDate(locale, `${m}-01`, { month: 'long' })) })
        } else cells.push({ kind: 'day', day })
      }
      weeks.push(cells)
    }
  }

  const periodOcc = data.occurrences.filter((x) => x.date >= range.from && x.date <= range.to)
  const updates: PrintUpdateModel[] = []
  for (const occ of [...periodOcc].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id))) {
    const text = updateText(occ, data, msg, locale)
    if (text) updates.push({ id: occ.id, date: formatDate(locale, occ.date, { weekday: 'short', day: 'numeric', month: 'short' }), text })
  }

  const longDate = (date: string) => formatDate(locale, date, { day: 'numeric', month: 'long' })
  const holidays = data.closures
    .filter((c) => c.startsOn <= range.to && c.endsOn >= range.from)
    .map((c) => {
      const from = c.startsOn < range.from ? range.from : c.startsOn
      const to = c.endsOn > range.to ? range.to : c.endsOn
      const r = from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`
      return c.label ? `${r} (${c.label})` : r
    })
    .join(', ')

  const shownSeries = new Set(periodOcc.map((x) => x.seriesId))
  const roomIds = new Set(periodOcc.flatMap((x) => (x.meetingRoomId && x.mode !== 'inPerson' ? [x.meetingRoomId] : [])))
  const courseIds = [...new Set(periodOcc.map((x) => x.courseId))].sort((a, b) => (data.courses[a]?.title ?? '').localeCompare(data.courses[b]?.title ?? ''))
  const teacherIds = new Set(periodOcc.flatMap((x) => x.teacherIds))

  const periodLabel =
    o.kind === 'month'
      ? monthTitle(locale, month)
      : `${formatDate(locale, monday, { day: 'numeric', month: 'long' })} – ${formatDate(locale, addDays(monday, 6), { day: 'numeric', month: 'long', year: 'numeric' })}`

  const tz = data.timeZone ?? undefined
  const fmtNow = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(o.now)
    } catch {
      return new Intl.DateTimeFormat(locale, opts).format(o.now)
    }
  }

  return {
    kind: o.kind,
    title: o.title,
    periodLabel,
    siteHost: o.siteHost,
    filters: filtersLine(o.filters, o.allData, locale, msg),
    holidays: holidays ? msg.holidays(holidays) : null,
    days,
    weeks,
    updates,
    rooms: data.rooms ? [...roomIds].flatMap((id) => (data.rooms![id] ? [data.rooms![id]] : [])) : [],
    hasVolunteers: shownSeries.size > 0 && [...teacherIds].some((id) => data.teachers[id]?.volunteer),
    courses: courseIds.flatMap((id) => (data.courses[id] ? [{ id, title: data.courses[id].title, description: data.courses[id].description ?? null }] : [])),
    generatedOn: msg.generatedOn(fmtNow({ day: 'numeric', month: 'long', year: 'numeric' }), fmtNow({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })),
  }
}

/** The months a print needs loaded: the week's, or the month's plus the neighbours its calendar rows reach into. */
export function monthsForPrint(kind: 'week' | 'month', anchor: string): string[] {
  if (kind === 'week') return [...new Set(weekDates(weekStart(anchor)).map(monthOf))]
  const m = monthOf(anchor)
  const r = monthRange(m)
  const out = [m]
  if (weekStart(r.from) < r.from) out.unshift(addMonths(m, -1))
  if (addDays(weekStart(r.to), 6) > r.to) out.push(addMonths(m, 1))
  return out
}

// ── Pages ────────────────────────────────────────────────────────────────────

/** One unit of the printed document; never split across pages. */
export type PrintBlock = {
  key: string
  /** Rows of the same day / list share a group; a group's heading is repeated ("continued") on a new page. */
  group?: string
  /** A heading: never left alone at the bottom of a page. */
  heading?: boolean
  /** Starts a new page (the "About the courses" page). */
  pageBreak?: boolean
}

export type PlacedBlock = { index: number; continued: boolean }

/**
 * Packs measured blocks into pages. `heights[i]` is block i's height; `capacity(page)` the
 * room on that page (the first page has no running header). A group's heading is
 * repeated, marked continued, when the group goes on over a page break. A block
 * taller than a page gets a page of its own.
 */
export function paginate(blocks: readonly PrintBlock[], heights: readonly number[], capacity: (page: number) => number): PlacedBlock[][] {
  const headingOf = new Map<string, number>()
  blocks.forEach((b, i) => {
    if (b.heading && b.group && !headingOf.has(b.group)) headingOf.set(b.group, i)
  })
  const pages: PlacedBlock[][] = [[]]
  let used = 0
  const newPage = () => {
    pages.push([])
    used = 0
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const page = () => pages[pages.length - 1]
    if (b.pageBreak && page().length > 0) newPage()
    // A heading travels with the first block after it.
    const need = heights[i] + (b.heading && i + 1 < blocks.length && !blocks[i + 1].pageBreak ? heights[i + 1] : 0)
    if (used > 0 && used + need > capacity(pages.length - 1)) newPage()
    if (used === 0 && !b.heading && b.group && headingOf.has(b.group) && headingOf.get(b.group)! < i) {
      const h = headingOf.get(b.group)!
      page().push({ index: h, continued: true })
      used += heights[h]
    }
    page().push({ index: i, continued: false })
    used += heights[i]
  }
  return pages.filter((p) => p.length > 0)
}
