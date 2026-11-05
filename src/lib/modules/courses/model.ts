// ── Courses module — shared constants (ADR-045, timetable build spec §3) ─────
// Pure and browser-safe: imported by the schema (Studio bundle), the services
// (server) and the dashboard (client).

export const COURSES_MODULE_ID = 'courses'

/**
 * A course's colour: only design-system-safe keys, never a free colour.
 * `none` = no colour. The website maps `accent` / `muted` to design-system tokens.
 */
export const COURSE_COLORS = ['none', 'accent', 'muted'] as const
export type CourseColor = (typeof COURSE_COLORS)[number]
export const DEFAULT_COURSE_COLOR: CourseColor = 'none'

export function isCourseColor(value: unknown): value is CourseColor {
  return typeof value === 'string' && (COURSE_COLORS as readonly string[]).includes(value)
}

/** Permissions (build spec §3). */
export const COURSES_PERMISSIONS = {
  read: 'courses.course.read',
  write: 'courses.course.write',
  delete: 'courses.course.delete',
  /** Classes, exceptions, terms and closures (the Timetable). */
  scheduleWrite: 'courses.schedule.write',
  /** Private online meeting details (Zoom rooms). Support mode never writes it. */
  meetingManage: 'courses.meeting.manage',
} as const
