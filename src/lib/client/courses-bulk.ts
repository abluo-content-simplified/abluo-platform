/**
 * Courses list — which selected courses a bulk action can change (ADR-045).
 * Pure functions with no React and no I/O: the list shows the count of who is
 * affected, and the server (`src/lib/api/course-bulk.ts`) applies the SAME rule
 * before it touches anything, so the two never disagree.
 */

export type CourseBulkOp = 'publish' | 'archive' | 'restore' | 'delete' | 'unpublish' | 'unpublishOn'
export const COURSE_BULK_OPS: readonly CourseBulkOp[] = ['publish', 'archive', 'restore', 'delete', 'unpublish', 'unpublishOn']

/** Why a selected course is left as it was (never an error). */
export type CourseBulkSkipReason = 'archived' | 'scheduled' | 'published' | 'missing_text' | 'not_published' | 'not_archived' | 'has_been_published' | 'unpublished'

export type BulkCourse = {
  state: 'draft' | 'scheduled' | 'published' | 'changes' | 'unpublished' | 'archived'
  isPublished: boolean
  /** Site languages (beyond the main one) that still have no title. */
  missingLanguages: readonly string[]
}

/**
 * null = the action applies; else the reason it is skipped.
 *  publish      drafts, pending changes and unpublished courses ("Publish again") with every language written
 *  archive      published courses (a scheduled one first goes back to draft)
 *  restore      archived courses
 *  delete       a draft that was never published, or an archived course
 *  unpublish    courses on the website (or scheduled to go on it)
 *  unpublishOn  the same courses: they leave the website on the chosen date
 */
export function courseBulkSkip(c: BulkCourse, op: CourseBulkOp): CourseBulkSkipReason | null {
  switch (op) {
    case 'publish':
      if (c.state === 'archived') return 'archived'
      if (c.state === 'scheduled') return 'scheduled'
      if (c.state === 'published') return 'published'
      return c.missingLanguages.length > 0 ? 'missing_text' : null
    case 'archive':
      if (c.state === 'archived') return 'archived'
      if (c.state === 'scheduled') return 'scheduled'
      return c.isPublished ? null : 'not_published'
    case 'restore':
      return c.state === 'archived' ? null : 'not_archived'
    case 'delete':
      if (c.state === 'archived') return null
      return c.isPublished ? 'has_been_published' : null
    case 'unpublish':
    case 'unpublishOn':
      if (c.state === 'archived') return 'archived'
      if (c.state === 'unpublished') return 'unpublished'
      return c.isPublished ? null : 'not_published'
  }
}

/** Who a bulk action will change among the selection, and how many are left as they were. */
export function courseBulkTargets<T extends BulkCourse>(rows: readonly T[], op: CourseBulkOp): { targets: T[]; skipped: number } {
  const targets = rows.filter((r) => courseBulkSkip(r, op) === null)
  return { targets, skipped: rows.length - targets.length }
}

/** The delete a course needs: archived → permanently, a never-published draft → delete draft. */
export const courseDeleteOp = (c: Pick<BulkCourse, 'state'>): 'deletePermanently' | 'deleteDraft' => (c.state === 'archived' ? 'deletePermanently' : 'deleteDraft')
