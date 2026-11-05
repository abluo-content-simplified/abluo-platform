/**
 * Courses — permissions, error class and the ADR-032 lifecycle descriptor
 * (ADR-045, timetable build spec §3–4). Mirrors persons-lifecycle.ts.
 *
 *   ARCHIVE   Archive / restore need the course WRITE permission (publishing
 *             and archiving sit under the edit permission, ADR-032).
 *   DELETE    Deleting a never-published draft, or an archived course for good,
 *             needs courses.course.delete (owner) and is refused while
 *               · any document of the project references the course, or
 *               · the course still has classes (schedule series).
 *             The schedule check is the `hasSchedule` dependency: it defaults
 *             to "no schedule" until the scheduling store is wired in.
 *
 * The error class lives here (not in course-drafts.ts) so the descriptor and
 * the service can both build it without a circular import.
 */
import type { LifecycleClient, LifecycleDescriptor, LifecycleErrorCode, Referrer } from '@/lib/lifecycle/service'
import { COURSES_PERMISSIONS } from '@/lib/modules/courses/model'

export const COURSE_READ_PERMISSION = COURSES_PERMISSIONS.read
export const COURSE_WRITE_PERMISSION = COURSES_PERMISSIONS.write
export const COURSE_DELETE_PERMISSION = COURSES_PERMISSIONS.delete

export type CourseErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'in_use'
  | 'archive_first'
  | 'archived'
  | 'missing_title'
  | 'failed'

/** Where a course is still used: other documents, or its classes. */
export interface CourseUsage {
  kind: 'page' | 'post' | 'event' | 'classes'
  /** Sanity document id (base id); '' for `classes`. */
  id: string
  title: string
}

export class CourseError extends Error {
  constructor(
    readonly code: CourseErrorCode,
    message: string,
    /** in_use → what still uses the course. */
    readonly detail?: { usedIn?: CourseUsage[] }
  ) {
    super(message)
    this.name = 'CourseError'
  }
}

const COURSE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** A safe Sanity document id for a course (never with a drafts. prefix). */
export function isCourseId(id: unknown): id is string {
  return typeof id === 'string' && COURSE_ID.test(id)
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CODE: Record<LifecycleErrorCode, CourseErrorCode> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_value: 'invalid_value',
  archived: 'archived',
  archive_first: 'archive_first',
  in_use: 'in_use',
  unpublished_dependencies: 'failed',
  failed: 'failed',
}

const RAW = { perspective: 'raw' } as const

/**
 * EVERY document of the project that references the course in any version
 * (weak references too — a timetable section that names it), except its own
 * versions.
 */
export const COURSE_DELETE_REFERRERS = /* groq */ `*[projectSlug == $projectSlug && references($id) && !(_id in [$id, $draftId]) && !(_id in path("versions.**"))]{ _id, _type, "label": coalesce(title, internalName, name) }`

/**
 * Does the course have classes (live schedule series)? TODO(scheduling wave):
 * the default says "no" until the scheduling store (`course-store.ts`) provides
 * the real check; `deleteCourse` flows pass it in via `CourseDeps.hasSchedule`.
 * Throwing means "could not check" and makes the delete refuse.
 */
export type HasScheduleFn = (publicId: string, projectId: string) => Promise<boolean>
export const noSchedule: HasScheduleFn = async () => false

type Row = { _id: string; _type?: string; label?: unknown }

const FALLBACK: Record<string, string> = { page: 'Page', homePage: 'Home page', post: 'Post', event: 'Event' }

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  const pick = v.en ?? Object.entries(v).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x)?.[1]
  return typeof pick === 'string' ? pick : ''
}

function named(rows: readonly Row[] | null | undefined): Referrer[] {
  const seen = new Map<string, Referrer>()
  for (const r of rows ?? []) {
    const id = r._id.replace(/^drafts\./, '')
    const type = typeof r._type === 'string' ? r._type : 'unknown'
    if (!seen.has(id)) seen.set(id, { id, type, label: textOf(r.label) || FALLBACK[type] || 'Untitled' })
  }
  return [...seen.values()]
}

/** The descriptor for one course: deletes also check the classes (Supabase), which the generic service cannot know. */
export function courseLifecycle(scope: { projectId: string; publicId: string | null; hasSchedule: HasScheduleFn }): LifecycleDescriptor {
  const allReferrers = async (client: LifecycleClient, id: string, projectSlug: string): Promise<Referrer[]> => {
    const rows = await client.fetch<Row[] | null>(COURSE_DELETE_REFERRERS, { id, draftId: `drafts.${id}`, projectSlug }, RAW)
    const refs = named(rows)
    if (scope.publicId) {
      let has: boolean
      try {
        has = await scope.hasSchedule(scope.publicId, scope.projectId)
      } catch {
        throw new CourseError('failed', 'Could not check the classes.')
      }
      if (has) refs.push({ id: '', type: 'classes', label: 'classes' })
    }
    return refs
  }
  return {
    type: 'course',
    rule: 'optional',
    permissions: {
      // This descriptor runs only archive / restore / delete: "write" is the edit permission.
      write: COURSE_WRITE_PERMISSION,
      delete: COURSE_DELETE_PERMISSION,
      deletePublished: COURSE_DELETE_PERMISSION,
    },
    isId: isCourseId,
    fail: (code, message) => new CourseError(CODE[code], message),
    refuseArchiveWhileReferenced: false,
    deleteReferrers: allReferrers,
    label: (doc) => textOf(doc.title) || 'Course',
  }
}
