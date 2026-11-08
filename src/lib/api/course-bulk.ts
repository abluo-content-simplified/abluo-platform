/**
 * Courses list — bulk actions (ADR-045). Applied ONE BY ONE with the same
 * single-course services the row menu uses (`publishCourseDraft`,
 * `runCourseLifecycle`), so every rule and every permission check is the one a
 * single action has; this file only chooses who is eligible (the shared rule in
 * `@/lib/client/courses-bulk`) and reports a result per course.
 *
 *   publish / archive / restore   courses.course.write
 *   delete                        courses.course.delete (Owner). Deleting a
 *                                 course ends its classes too; that part also
 *                                 needs courses.schedule.write, else the course
 *                                 is left as it was.
 *   setClassesLastDate            courses.schedule.write — gives every active
 *                                 repeating class of the chosen courses a new last
 *                                 date, moved back to the last class day on or
 *                                 before the chosen day (the store's own rule).
 *
 * Gates (permission, input shape, unknown ids) run before anything is written;
 * a refusal of one course never stops the others.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CourseError, COURSE_DELETE_PERMISSION, COURSE_WRITE_PERMISSION, isCourseId, UUID_RE, type CourseErrorCode, type CourseUsage } from '@/lib/api/course-lifecycle'
import { listCourses, publishCourseDraft, runCourseLifecycle, type CourseDeps, type CourseListItem } from '@/lib/api/course-drafts'
import { SCHEDULE_WRITE_PERMISSION } from '@/lib/api/course-schedule'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { COURSE_BULK_OPS, courseBulkSkip, courseDeleteOp, type CourseBulkOp, type CourseBulkSkipReason } from '@/lib/client/courses-bulk'
import { createCourseScheduleStore, type CourseScheduleStore } from '@/lib/scheduling/course-store'
import { endClassGuarded, saveClassGuarded } from '@/lib/scheduling/course-guarded.server'
import { dayNumber, parseClassRule, previousRuleDate } from '@/lib/scheduling/recurrence'
import { ScheduleError } from '@/lib/scheduling/types'

/** One call changes at most this many courses. */
export const COURSE_BULK_MAX = 50

export interface CourseBulkResult {
  /** Ids that were changed. */
  changed: string[]
  /** Ids left as they were, with why (never an error). */
  skipped: Array<{ id: string; reason: CourseBulkSkipReason }>
  /** Ids that should have changed but could not (opaque code, as the single-course calls). */
  failed: Array<{ id: string; code: CourseErrorCode; usedIn?: CourseUsage[] }>
  /** Delete: how many classes went with the deleted courses. */
  classesEnded: number
  /** Delete: classes that could not be ended after their course was deleted (they need attention). */
  classesLeft: number
}

export type ClassLastDateSkip = 'archived' | 'no_classes' | 'once' | 'unchanged' | 'before_first'
export interface ClassLastDateResult {
  changed: Array<{ courseId: string; classId: string; from: string | null; to: string }>
  skipped: Array<{ courseId: string; classId: string; reason: ClassLastDateSkip }>
  failed: Array<{ courseId: string; classId: string; code: CourseErrorCode }>
}

type SaveClassFn = typeof saveClassGuarded
export type CourseBulkDeps = CourseDeps & {
  store?: CourseScheduleStore
  /** Test seams: the single-course services. */
  impl?: {
    list?: typeof listCourses
    publish?: typeof publishCourseDraft
    lifecycle?: typeof runCourseLifecycle
    draftRev?: (id: string) => Promise<string | null>
    saveClass?: SaveClassFn
  }
}

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function checkIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > COURSE_BULK_MAX) throw new CourseError('invalid_value', 'Nothing selected.')
  if (ids.some((x) => !isCourseId(x)) || new Set(ids).size !== ids.length) throw new CourseError('invalid_value', 'Unknown course.')
  return ids as string[]
}

async function listFor(ctx: TenantAuthorizationContext, projectId: string, ids: string[], deps: CourseBulkDeps): Promise<Map<string, CourseListItem>> {
  const { courses } = await (deps.impl?.list ?? listCourses)(ctx, projectId, { ...deps, scheduleSummary: undefined })
  const byId = new Map(courses.map((c) => [c.id, c]))
  // One unknown id (or another website's) refuses the whole call before anything is written.
  if (!ids.every((id) => byId.has(id))) throw new CourseError('not_found', 'Unknown course.')
  return byId
}

const codeOf = (error: unknown): CourseErrorCode => {
  if (error instanceof CourseError) return error.code
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  if (error instanceof ScheduleError) return error.code === 'conflict' ? 'conflict' : error.code === 'not_found' ? 'not_found' : error.code === 'outside_term' ? 'outside_term' : error.code === 'invalid' ? 'invalid_value' : 'failed'
  return 'failed'
}

/** Publish / archive / restore / delete the chosen courses, one by one. */
export async function bulkUpdateCourses(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { ids: string[]; op: CourseBulkOp },
  deps: CourseBulkDeps = {}
): Promise<CourseBulkResult> {
  const op = input?.op
  if (!(COURSE_BULK_OPS as readonly unknown[]).includes(op)) throw new CourseError('invalid_value', 'Unknown action.')
  const grant = grantFor(ctx, projectId, op === 'delete' ? COURSE_DELETE_PERMISSION : COURSE_WRITE_PERMISSION)
  const ids = checkIds(input.ids)
  const byId = await listFor(ctx, projectId, ids, deps)
  const canEndClasses = grant.permissions.includes(SCHEDULE_WRITE_PERMISSION)
  const store = () => deps.store ?? createCourseScheduleStore()
  const result: CourseBulkResult = { changed: [], skipped: [], failed: [], classesEnded: 0, classesLeft: 0 }

  for (const id of ids) {
    const course = byId.get(id)!
    const reason = courseBulkSkip(course, op)
    if (reason) {
      result.skipped.push({ id, reason })
      continue
    }
    try {
      if (op === 'publish') {
        const rev = await (deps.impl?.draftRev ?? ((x: string) => draftRevOf(deps, x)))(id)
        if (!rev) throw new CourseError('not_found', 'No draft to publish.')
        await (deps.impl?.publish ?? publishCourseDraft)(ctx, projectId, { id, rev, mode: 'keep' }, deps)
      } else if (op === 'archive' || op === 'restore') {
        await (deps.impl?.lifecycle ?? runCourseLifecycle)(ctx, projectId, { id, op }, deps)
      } else {
        // Deleting ends the course's classes too. The delete itself still refuses when anything else uses the course.
        const classes = course.publicId && UUID_RE.test(course.publicId) ? await store().listSeries(projectId, { ownerPublicIds: [course.publicId.toLowerCase()] }) : []
        if (classes.length > 0 && !canEndClasses) throw new CourseError('forbidden', 'Ending classes needs schedule permission.')
        await (deps.impl?.lifecycle ?? runCourseLifecycle)(ctx, projectId, { id, op: courseDeleteOp(course) }, { ...deps, hasSchedule: async () => false })
        for (const s of classes) {
          try {
            await endClassGuarded(projectId, s.id, s.version, { store: store() })
            result.classesEnded += 1
          } catch {
            result.classesLeft += 1
          }
        }
      }
      result.changed.push(id)
    } catch (error) {
      result.failed.push({ id, code: codeOf(error), ...(error instanceof CourseError && error.detail?.usedIn && { usedIn: error.detail.usedIn }) })
    }
  }
  return result
}

async function draftRevOf(deps: CourseBulkDeps, id: string): Promise<string | null> {
  const client = deps.client ?? sanityWriteClient
  const draft = (await client.getDocument(`drafts.${id}`)) as { _rev?: string } | undefined
  return draft?._rev ?? null
}

const dayOk = (v: unknown): v is string => typeof v === 'string' && dayNumber(v) !== null

/**
 * "Change last date of classes": one last date for every active class of the
 * chosen courses. Repeating classes end on the last class day on or before it
 * (the same snapping the class form applies); a "once" class has no last date;
 * a day before a class's first date is refused for that class only.
 */
export async function setClassesLastDate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { ids: string[]; endsOn: string },
  deps: CourseBulkDeps = {}
): Promise<ClassLastDateResult> {
  const grant = grantFor(ctx, projectId, SCHEDULE_WRITE_PERMISSION)
  const ids = checkIds(input?.ids)
  if (!dayOk(input.endsOn)) throw new CourseError('invalid_value', 'Pick a valid date.')
  const byId = await listFor(ctx, projectId, ids, deps)
  const store = deps.store ?? createCourseScheduleStore()
  const save: SaveClassFn = deps.impl?.saveClass ?? saveClassGuarded
  const result: ClassLastDateResult = { changed: [], skipped: [], failed: [] }

  for (const courseId of ids) {
    const course = byId.get(courseId)!
    if (course.state === 'archived') {
      result.skipped.push({ courseId, classId: '', reason: 'archived' })
      continue
    }
    let classes
    try {
      classes = course.publicId && UUID_RE.test(course.publicId) ? await store.listSeries(projectId, { ownerPublicIds: [course.publicId.toLowerCase()] }) : []
    } catch (error) {
      result.failed.push({ courseId, classId: '', code: codeOf(error) })
      continue
    }
    if (classes.length === 0) {
      result.skipped.push({ courseId, classId: '', reason: 'no_classes' })
      continue
    }
    for (const s of classes) {
      const classId = s.id
      try {
        const rule = parseClassRule(s.rule)
        if (!rule || !s.startsOn) throw new CourseError('invalid_value', 'The repeat is not valid.')
        if (rule.kind === 'once') {
          result.skipped.push({ courseId, classId, reason: 'once' })
          continue
        }
        const to = previousRuleDate(rule, input.endsOn, s.startsOn)
        if (!to || to < s.startsOn) {
          result.skipped.push({ courseId, classId, reason: 'before_first' })
          continue
        }
        if (to === s.endsOn) {
          result.skipped.push({ courseId, classId, reason: 'unchanged' })
          continue
        }
        await save(
          grant.projectSlug,
          {
            projectId,
            seriesId: s.id,
            ownerType: 'course',
            ownerPublicId: s.ownerPublicId,
            editionId: s.editionId,
            timeZone: s.timeZone,
            repeat: rule,
            interval: s.interval,
            startTime: s.startLocal.slice(11, 16),
            endTime: s.endLocal ? s.endLocal.slice(11, 16) : null,
            startsOn: s.startsOn,
            endsOn: to,
            place: s.place,
            attendanceMode: s.attendanceMode,
            instructorPublicIds: s.instructorPublicIds,
            languages: s.languages,
            meetingRoomId: s.meetingRoomId,
            expectedVersion: s.version,
            actorId: ctx.userId,
          },
          { store }
        )
        result.changed.push({ courseId, classId, from: s.endsOn, to })
      } catch (error) {
        result.failed.push({ courseId, classId, code: codeOf(error) })
      }
    }
  }
  return result
}
