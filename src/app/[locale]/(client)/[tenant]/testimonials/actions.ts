'use server'

/**
 * Client dashboard — Testimonials server actions (ADR-048 D8/D9).
 *
 * Thin wrappers over `src/lib/api/testimonials.ts`, `testimonials-private.ts`
 * and `testimonial-submissions.ts`, which hold every check (permission, the
 * project from the GRANT, ids, revision guards). Identity is re-resolved
 * server-side on each call; the URL's projectSlug only picks one of the
 * caller's own grants. Failures collapse to opaque codes
 * (`mapTestimonialActionError`); `permission_required` names the field to tick.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { mapTestimonialActionError, type TestimonialActionFail } from '@/lib/api/testimonial-action-error'
import {
  createTestimonial,
  discardTestimonialDraft,
  getTestimonial,
  getTestimonialActivity,
  listTestimonials,
  openTestimonialForEdit,
  publishTestimonialDraft,
  runTestimonialLifecycle,
  saveTestimonialDraft,
  type TestimonialLifecycleOp,
  type TestimonialListItem,
  type TestimonialSite,
  type TestimonialSnapshot,
} from '@/lib/api/testimonials'
import {
  createTestimonialFromSubmission,
  listTestimonialSubmissions,
  rejectTestimonialSubmission,
  type CreatedFromSubmission,
  type TestimonialSubmission,
} from '@/lib/api/testimonial-submissions'
import type { ActivityItem } from '@/lib/lifecycle/activity'

type Result<T> = ({ ok: true } & T) | TestimonialActionFail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    return mapTestimonialActionError(error)
  }
}

export async function listTestimonialsAction(input: { projectSlug: string }): Promise<Result<{ testimonials: TestimonialListItem[]; site: TestimonialSite }>> {
  return run(input?.projectSlug, (ctx, pid) => listTestimonials(ctx, pid))
}

export async function getTestimonialAction(input: { projectSlug: string; id: string }): Promise<Result<{ testimonial: TestimonialSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ testimonial: await getTestimonial(ctx, pid, input.id) }))
}

/** "New Testimonial": an empty draft, opened straight in the editor (no wizard). */
export async function createTestimonialAction(input: { projectSlug: string }): Promise<Result<{ id: string; publicId: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createTestimonial(ctx, pid, {}))
}

/** Creates drafts.<id> from the published testimonial when missing. Call before the first edit. */
export async function openTestimonialForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openTestimonialForEdit(ctx, pid, { id: input.id }))
}

export async function saveTestimonialDraftAction(input: { projectSlug: string; id: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => saveTestimonialDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function publishTestimonialDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishTestimonialDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardTestimonialDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardTestimonialDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

/** Unpublish · Back online · Archive · Restore · Delete a draft · Delete permanently (Owner). */
export async function testimonialLifecycleAction(input: { projectSlug: string; id: string; op: TestimonialLifecycleOp }): Promise<Result<{ rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => runTestimonialLifecycle(ctx, pid, { id: input.id, op: input.op }))
}

export async function getTestimonialActivityAction(input: { projectSlug: string; id: string }): Promise<Result<{ items: ActivityItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await getTestimonialActivity(ctx, pid, { id: input.id }) }))
}

// ── Submissions (Phase 2, ADR-048 D4) ─────────────────────────────────────────

export async function listTestimonialSubmissionsAction(input: { projectSlug: string }): Promise<Result<{ submissions: TestimonialSubmission[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ submissions: await listTestimonialSubmissions(ctx, pid) }))
}

/** "Create testimonial": a DRAFT from the submission (permission to publish is on only when the visitor ticked the consent box). */
export async function createTestimonialFromSubmissionAction(input: { projectSlug: string; submissionId: string }): Promise<Result<CreatedFromSubmission>> {
  return run(input?.projectSlug, (ctx, pid) => createTestimonialFromSubmission(ctx, pid, input.submissionId))
}

/** "Reject": the submission is marked archived; nothing else changes. */
export async function rejectTestimonialSubmissionAction(input: { projectSlug: string; submissionId: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await rejectTestimonialSubmission(ctx, pid, input.submissionId)
    return {}
  })
}
