'use server'

/**
 * Client dashboard — Courses server actions (ADR-045).
 *
 * Thin wrappers over `src/lib/api/course-drafts.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes
 * (`CourseErrorCode`); `detail.usedIn` says what still uses a course (in_use).
 *
 * The Classes panel and the Timetable page have their own actions in
 * `schedule-actions.ts`. Here the schedule only matters to the list (classes,
 * teachers, next class) and to delete (refused while a course has classes).
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  createCourse,
  discardCourseDraft,
  getCourseActivity,
  getCourseForEdit,
  listCourses,
  openCourseForEdit,
  publishCourseDraft,
  runCourseLifecycle,
  saveCourseDraft,
  setCoursePublishDate,
  setCourseUnpublishDate,
  unscheduleCourse,
  CourseError,
  type CourseErrorCode,
  type CourseLifecycleOp,
  type CourseListItem,
  type CourseListOverview,
  type CourseSite,
  type CourseSnapshot,
  type CourseUsage,
} from '@/lib/api/course-drafts'
import { courseScheduleDeps } from '@/lib/api/course-schedule'
import { bulkUpdateCourses, setClassesLastDate, type ClassLastDateResult, type CourseBulkResult } from '@/lib/api/course-bulk'
import type { CourseBulkOp } from '@/lib/client/courses-bulk'
import type { ActivityItem } from '@/lib/lifecycle/activity'

export type CourseActionError = 'unauthenticated' | CourseErrorCode
type Fail = { ok: false; error: CourseActionError; detail?: { usedIn?: CourseUsage[] } }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof CourseError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

/** The course store behind the list's schedule summary and delete's "has classes" check (slug from the grant). */
function scheduleDeps(ctx: TenantAuthorizationContext, projectId: string) {
  const slug = ctx.projects.find((p) => p.projectId === projectId)?.projectSlug ?? ''
  return courseScheduleDeps(slug)
}

export async function listCoursesAction(input: { projectSlug: string }): Promise<Result<{ courses: CourseListItem[]; site: CourseSite; overview: CourseListOverview }>> {
  return run(input?.projectSlug, (ctx, pid) => listCourses(ctx, pid, scheduleDeps(ctx, pid)))
}

export async function getCourseAction(input: { projectSlug: string; id: string }): Promise<Result<{ course: CourseSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ course: await getCourseForEdit(ctx, pid, input.id) }))
}

/** New course: its title in the site's default language. */
export async function createCourseAction(input: { projectSlug: string; title: string }): Promise<Result<{ id: string; publicId: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createCourse(ctx, pid, { title: input.title }))
}

/** Creates drafts.<id> from the published course when missing. Call before the first edit. */
export async function openCourseForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openCourseForEdit(ctx, pid, { id: input.id }))
}

export async function saveCourseDraftAction(input: { projectSlug: string; id: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => saveCourseDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

/** Publish now, "Publish on…" (schedule + publishAt) or update (keep). `no_timetable_page`: nothing on the website would show the course. */
export async function publishCourseDraftAction(input: { projectSlug: string; id: string; rev: string; mode?: 'now' | 'schedule' | 'keep'; publishAt?: string }): Promise<Result<{ rev: string; publishedAt: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => publishCourseDraft(ctx, pid, { id: input.id, rev: input.rev, mode: input.mode, publishAt: input.publishAt }))
}

/** A scheduled course: new go-live date, or `now`. */
export async function setCoursePublishDateAction(input: { projectSlug: string; id: string; mode: 'now' | 'schedule'; publishAt?: string }): Promise<Result<{ publishedAt: string }>> {
  return run(input?.projectSlug, (ctx, pid) => setCoursePublishDate(ctx, pid, { id: input.id, mode: input.mode, publishAt: input.publishAt }))
}

/** A scheduled course goes back to draft. */
export async function unscheduleCourseAction(input: { projectSlug: string; id: string }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => unscheduleCourse(ctx, pid, { id: input.id }))
}

export async function discardCourseDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardCourseDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

/**
 * Archive / restore / unpublish / publish again (write), delete a never-published draft or an archived
 * course for good (owner; refused while the course is used or has classes).
 */
export async function courseLifecycleAction(input: { projectSlug: string; id: string; op: CourseLifecycleOp }): Promise<Result<{ rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => runCourseLifecycle(ctx, pid, { id: input.id, op: input.op }, scheduleDeps(ctx, pid)))
}

/** "Unpublish on…" (an ISO moment in the future) or null to remove the date. The course is never archived by it. */
export async function setCourseUnpublishDateAction(input: { projectSlug: string; id: string; unpublishAt: string | null }): Promise<Result<{ unpublishOn: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => setCourseUnpublishDate(ctx, pid, { id: input.id, unpublishAt: input.unpublishAt }))
}

/**
 * Publish / archive / restore / unpublish / unpublish on… / delete several courses (the list's selection bar).
 * Applied one by one with the single-course rules and permissions; the result says
 * per course what changed, what was left as it was and what failed. Deleting also
 * ends the courses' classes (the list asks first, naming them).
 */
export async function bulkUpdateCoursesAction(input: { projectSlug: string; ids: string[]; op: CourseBulkOp; at?: string | null }): Promise<Result<CourseBulkResult>> {
  return run(input?.projectSlug, (ctx, pid) => bulkUpdateCourses(ctx, pid, { ids: input.ids, op: input.op, at: input.at }, scheduleDeps(ctx, pid)))
}

/** "Change last date of classes": every active repeating class of the chosen courses ends on the last class day on or before `endsOn` (YYYY-MM-DD). */
export async function setClassesLastDateAction(input: { projectSlug: string; ids: string[]; endsOn: string }): Promise<Result<ClassLastDateResult>> {
  return run(input?.projectSlug, (ctx, pid) => setClassesLastDate(ctx, pid, { ids: input.ids, endsOn: input.endsOn }, scheduleDeps(ctx, pid)))
}

export async function getCourseActivityAction(input: { projectSlug: string; id: string }): Promise<Result<{ items: ActivityItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await getCourseActivity(ctx, pid, { id: input.id }) }))
}
