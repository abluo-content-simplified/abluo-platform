// ── Courses module — shared constants (ADR-045, timetable build spec §3) ─────
// Pure and browser-safe: imported by the schema (Studio bundle), the services
// (server) and the dashboard (client).

export const COURSES_MODULE_ID = 'courses'

/**
 * A course's colour: a stable, meaning-free palette key ('c1' … 'c6') or 'none'.
 * The colours themselves are derived from the site's design system
 * (`palette.ts`); legacy 'accent' / 'muted' are read as c1 / c6.
 */
export { COURSE_COLORS, DEFAULT_COURSE_COLOR, isCourseColor, normalizeCourseColor, type CourseColor } from './palette'

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
