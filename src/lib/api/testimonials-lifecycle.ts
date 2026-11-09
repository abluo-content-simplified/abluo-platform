/**
 * Testimonials — permissions, error class and the ADR-032 lifecycle descriptor
 * (ADR-048 D8).
 *
 *   PUBLISH   refused unless `permissionToPublish` is ticked (D1) — see
 *             testimonials.ts (`permission_required`, naming the field).
 *   ARCHIVE   always allowed: a testimonial is shown by value, not by reference
 *             (a hand-picked section only lists its id), so nothing blocks it.
 *   DELETE    a never-published draft is the WRITE permission; PERMANENT delete
 *             (archived testimonials) additionally needs testimonials.delete
 *             (owner only) and also removes the private row (testimonials.ts).
 *             Nothing blocks a permanent delete on references: a section that
 *             still lists the id simply shows one testimonial less (weak
 *             reference, skipped by the website projection) — a deletion
 *             request from the person must always be possible.
 *
 * The error class lives here (not in testimonials.ts) so the descriptor and the
 * private store can build it without a circular import.
 */
import type { LifecycleDescriptor, LifecycleErrorCode } from '@/lib/lifecycle/service'
import { TESTIMONIAL_PERMISSIONS, TESTIMONIAL_TYPE } from '@/lib/modules/testimonials/model'

export const TESTIMONIAL_READ_PERMISSION = TESTIMONIAL_PERMISSIONS.read
export const TESTIMONIAL_WRITE_PERMISSION = TESTIMONIAL_PERMISSIONS.write
export const TESTIMONIAL_PRIVATE_READ_PERMISSION = TESTIMONIAL_PERMISSIONS.privateRead
export const TESTIMONIAL_DELETE_PERMISSION = TESTIMONIAL_PERMISSIONS.delete

export type TestimonialErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'in_use'
  | 'archive_first'
  | 'archived'
  /** Publishing (or going back online) without `permissionToPublish`. `detail.field` names it. */
  | 'permission_required'
  /** The submission is gone, not this project's, or not a testimonial submission. */
  | 'submission_not_found'
  /** Migration 067 is not applied: the private section cannot be stored yet. */
  | 'private_unavailable'
  | 'failed'

export class TestimonialError extends Error {
  constructor(
    readonly code: TestimonialErrorCode,
    message: string,
    /** permission_required → the field that must be ticked. */
    readonly detail?: { field?: string }
  ) {
    super(message)
    this.name = 'TestimonialError'
  }
}

/** The field a publish is refused for. */
export const PERMISSION_FIELD = 'permissionToPublish'

const TESTIMONIAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isTestimonialId(id: unknown): id is string {
  return typeof id === 'string' && TESTIMONIAL_ID.test(id)
}

const CODE: Record<LifecycleErrorCode, TestimonialErrorCode> = {
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

const fail = (code: LifecycleErrorCode, message: string) => new TestimonialError(CODE[code], message)

export const TESTIMONIAL_LIFECYCLE: LifecycleDescriptor = {
  type: TESTIMONIAL_TYPE,
  rule: 'optional',
  permissions: {
    write: TESTIMONIAL_WRITE_PERMISSION,
    delete: TESTIMONIAL_WRITE_PERMISSION,
    deletePublished: TESTIMONIAL_DELETE_PERMISSION,
  },
  isId: isTestimonialId,
  fail,
  label: (doc) => (typeof doc.displayName === 'string' && doc.displayName.trim() ? doc.displayName.trim() : 'Testimonial'),
}
