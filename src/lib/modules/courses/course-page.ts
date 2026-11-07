// ── Courses module — what a course page shows (ADR-045 D5) ────────────────────
//
// Pure and browser-safe. The course page route reads the course's timetable
// data with the same reader the timetable section uses (timetableForSection,
// never meeting details) and turns it here into the page's "When" list: one
// entry per weekly class that still runs, with its teachers (linked to their
// People page when they have one), place, languages and next date.
//
// PRIVACY: nothing here reads meeting rooms; the page asks the reader with
// `includeOnlineDetails: false`, so `meetingRoomId` is always null anyway.

import type { AttendanceMode } from '@/lib/scheduling/types'
import { pagesShowingCourse, normalizePlacementPages } from './placement'
import type { TimetableData, TimetableImage, TimetablePlace, TimetableSeries } from './timetable'

/** How far ahead the course page reads dates (the next class of each weekly class). Within MAX_TIMETABLE_DAYS. */
export const COURSE_PAGE_WINDOW_DAYS = 70

export type CourseClassTeacher = {
  id: string
  name: string
  /** The person's own page (People module), or null. */
  href: string | null
  photo: TimetableImage | null
}

/** One weekly class of the course, as the page shows it. */
export type CourseClassView = {
  id: string
  /** The stored repeat rule (describeClassRepeat reads it). */
  rule: string | null
  /** First date of the pattern ('YYYY-MM-DD'): the date of a "once" class. */
  anchor: string
  weekdays: number[]
  interval: number
  start: string
  end: string | null
  /** Starts later than today ('YYYY-MM-DD'), else null. */
  startsOn: string | null
  /** Last date, when the class ends ('YYYY-MM-DD'), else null. */
  endsOn: string | null
  mode: AttendanceMode
  place: TimetablePlace | null
  teachers: CourseClassTeacher[]
  languages: string[]
  /** The next scheduled (not cancelled) date of this class within the window, or null. */
  nextDate: string | null
}

/**
 * The weekly classes of one course that still run on or after `today`, in the
 * timetable's order (weekday, then start time). A class whose last date has
 * passed is left out; a "once" class only while its date is ahead.
 */
export function courseClasses(
  data: Pick<TimetableData, 'series' | 'occurrences' | 'teachers' | 'places'>,
  coursePublicId: string,
  today: string,
  teacherHref: (t: { hasPage: boolean; slug: string | null }) => string | null,
): CourseClassView[] {
  const nextBySeries = new Map<string, string>()
  for (const o of data.occurrences) {
    if (o.courseId !== coursePublicId || o.status !== 'scheduled' || o.date < today) continue
    const prev = nextBySeries.get(o.seriesId)
    if (!prev || o.date < prev) nextBySeries.set(o.seriesId, o.date)
  }
  const runs = (s: TimetableSeries) => {
    if (s.endsOn && s.endsOn < today) return false
    // A one-off class: shown while its date is ahead.
    if (s.rule && /COUNT=1\b/.test(s.rule) && s.anchor < today) return false
    return true
  }
  return data.series
    .filter((s) => s.courseId === coursePublicId && runs(s))
    .map((s) => ({
      id: s.id,
      rule: s.rule,
      anchor: s.anchor,
      weekdays: s.weekdays,
      interval: s.interval,
      start: s.start,
      end: s.end,
      startsOn: s.startsOn && s.startsOn > today ? s.startsOn : null,
      endsOn: s.endsOn,
      mode: s.mode,
      place: s.mode !== 'online' && s.placeKey ? (data.places[s.placeKey] ?? null) : null,
      teachers: s.teacherIds.flatMap((id) => {
        const t = data.teachers[id]
        return t ? [{ id: t.id, name: t.name, href: teacherHref(t), photo: t.photo }] : []
      }),
      languages: s.languages,
      nextDate: nextBySeries.get(s.id) ?? null,
    }))
}

/**
 * The timetable page to link from a course page, in this language: the first
 * OPEN (not Access-protected) published page whose timetable shows the course
 * and that exists in this language (or is the home page). null = none.
 */
export function timetablePageHref(rawPages: unknown, courseDocId: string, locale: string, siteBase: string): string | null {
  for (const page of pagesShowingCourse(normalizePlacementPages(rawPages), courseDocId)) {
    if (!page.open) continue
    if (page.pageType === 'home') return siteBase || '/'
    const slug = page.slugs[locale]
    if (slug) return `${siteBase}/${slug}`
  }
  return null
}
