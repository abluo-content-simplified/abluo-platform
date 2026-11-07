// ── Courses module — schema.org Course for a course page (ADR-045 D5) ─────────
//
// Pure, tested (__tests__/course-structured.test.ts). Same posture as
// events/structured.ts: nothing is asserted that is not authored — no image
// without one, no location without a place, no instructor without a teacher.
// The weekly classes become `hasCourseInstance` (CourseInstance + Schedule).
// Meeting details are never part of the input.

import { canonicalUrl } from '@/lib/seo/canonical'
import { parseClassRule } from '@/lib/scheduling/recurrence'
import type { AttendanceMode } from '@/lib/scheduling/types'

const SCHEMA_DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (d ? `https://schema.org/${d}` : ''))

/** schema.org CourseInstance.courseMode for a class's attendance mode. */
export const COURSE_MODE: Record<AttendanceMode, 'onsite' | 'online' | 'blended'> = {
  inPerson: 'onsite',
  online: 'online',
  mixed: 'blended',
}

export interface CourseSchemaClass {
  rule: string | null
  /** First date of the pattern ('YYYY-MM-DD'). */
  anchor: string
  start: string
  end: string | null
  startsOn: string | null
  endsOn: string | null
  mode: AttendanceMode
  place: { name: string; lines: string[] } | null
  /** `url` is absolute (the teacher's People page), or null. */
  teachers: { name: string; url: string | null }[]
  languages: string[]
}

export interface CourseSchemaInput {
  /** `https://<customDomain>`; null → nothing is emitted (no canonical address). */
  origin: string | null
  locale: string
  /** Public path segments below the locale: [courseSegment, slug]. */
  pathSegments: string[]
  title: string | null | undefined
  description?: string | null
  imageUrl?: string | null
  /** The site's IANA time zone, when known (Schedule.scheduleTimezone). */
  timeZone?: string | null
  classes: readonly CourseSchemaClass[]
}

/** schema.org Schedule for one class, or null when its rule cannot be read. */
export function courseScheduleOf(c: CourseSchemaClass, timeZone?: string | null): Record<string, unknown> | null {
  const rule = parseClassRule(c.rule)
  if (!rule) return null
  const base: Record<string, unknown> = {
    '@type': 'Schedule',
    startTime: c.start,
    ...(c.end && { endTime: c.end }),
    ...(timeZone && { scheduleTimezone: timeZone }),
  }
  switch (rule.kind) {
    case 'once':
      return { ...base, startDate: c.anchor, endDate: c.anchor, repeatCount: 1 }
    case 'weekly':
      return {
        ...base,
        repeatFrequency: `P${rule.interval}W`,
        byDay: rule.weekdays.map((d) => SCHEMA_DAY[d]).filter(Boolean),
        startDate: c.startsOn ?? c.anchor,
        ...(c.endsOn && { endDate: c.endsOn }),
      }
    case 'monthlyWeekday':
      // "Last Sunday of the month": schema.org has no ordinal weekday — the day and the monthly rhythm.
      return { ...base, repeatFrequency: 'P1M', byDay: [SCHEMA_DAY[rule.weekday]], startDate: c.startsOn ?? c.anchor, ...(c.endsOn && { endDate: c.endsOn }) }
    case 'monthlyDay':
      return { ...base, repeatFrequency: 'P1M', byMonthDay: rule.day, startDate: c.startsOn ?? c.anchor, ...(c.endsOn && { endDate: c.endsOn }) }
  }
}

/** One CourseInstance per class. */
export function courseInstanceOf(c: CourseSchemaClass, url: string, timeZone?: string | null): Record<string, unknown> {
  const physical = c.mode !== 'online' && c.place?.name
    ? {
        '@type': 'Place',
        name: c.place.name,
        ...(c.place.lines.length > 0 && { address: c.place.lines.join(', ') }),
      }
    : undefined
  const virtual = c.mode !== 'inPerson' ? { '@type': 'VirtualLocation', url } : undefined
  const location = physical && virtual ? [physical, virtual] : (physical ?? virtual)
  const instructors = c.teachers.filter((t) => t.name).map((t) => ({ '@type': 'Person', name: t.name, ...(t.url && { url: t.url }) }))
  const schedule = courseScheduleOf(c, timeZone)
  return {
    '@type': 'CourseInstance',
    courseMode: COURSE_MODE[c.mode] ?? 'onsite',
    ...(location && { location }),
    ...(instructors.length > 0 && { instructor: instructors.length === 1 ? instructors[0] : instructors }),
    ...(c.languages.length > 0 && { inLanguage: c.languages.length === 1 ? c.languages[0] : c.languages }),
    ...(schedule && { courseSchedule: schedule }),
  }
}

/**
 * schema.org `Course` for one course page. Returns null without a title or a
 * canonical address (a page that cannot be named or linked is not described).
 * `provider` points at the organisation emitted by JsonLd by `@id`.
 */
export function buildCourseSchema(input: CourseSchemaInput): Record<string, unknown> | null {
  const { origin, locale, pathSegments } = input
  const name = input.title?.trim()
  const url = canonicalUrl(origin, locale, ...pathSegments)
  if (!name || !origin || !url) return null
  const instances = input.classes.map((c) => courseInstanceOf(c, url, input.timeZone))
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': `${url}#course`,
    url,
    mainEntityOfPage: url,
    name,
    inLanguage: locale,
    ...(input.description?.trim() && { description: input.description.trim() }),
    ...(input.imageUrl && { image: input.imageUrl }),
    provider: { '@id': `${origin}#organization` },
    ...(instances.length > 0 && { hasCourseInstance: instances }),
  }
}
