'use server'

/**
 * Client dashboard — Testimonial editor helpers (ADR-048 D6/D9), next to
 * `actions.ts`: the Translate button and the private details.
 *
 * Translate mirrors the People one (ADR-023): testimonials.write AND the
 * Translate module installed; provider, quota and metering exactly as
 * POST /api/translate; the source text is read from the SAVED testimonial and
 * the result is returned, not written — the editor saves it through
 * `saveTestimonialDraft` with status `machine`.
 *
 * Private details (full name, email, phone, note) live in Supabase and are
 * saved directly, never through the draft; they need testimonials.private.read.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { mapTestimonialActionError, type TestimonialActionFail } from '@/lib/api/testimonial-action-error'
import { getTestimonialPrivate, saveTestimonialPrivate, type TestimonialPrivateRead, type TestimonialPrivateRow } from '@/lib/api/testimonials'
import { translateTestimonialFields, type TestimonialTranslateResult } from '@/lib/api/testimonial-translate'
import type { TestimonialLocalizedField } from '@/lib/modules/testimonials/model'

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

/** Translate button on the testimonial's text fields (ADR-023). */
export async function translateTestimonialFieldsAction(input: {
  projectSlug: string
  id: string
  fields: TestimonialLocalizedField[]
  sourceLocale: string
}): Promise<Result<TestimonialTranslateResult>> {
  return run(input?.projectSlug, (ctx, pid) => translateTestimonialFields(ctx, pid, { id: input.id, fields: input.fields, sourceLocale: input.sourceLocale }))
}

export async function getTestimonialPrivateAction(input: { projectSlug: string; id: string }): Promise<Result<{ private: TestimonialPrivateRead }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ private: await getTestimonialPrivate(ctx, pid, { id: input.id }) }))
}

/** Saved directly (Supabase), a moment after typing; `version` is the one read (null = no row yet). */
export async function saveTestimonialPrivateAction(input: {
  projectSlug: string
  id: string
  version: number | null
  set: { fullName?: string | null; email?: string | null; phone?: string | null; note?: string | null }
}): Promise<Result<{ row: TestimonialPrivateRow }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ row: await saveTestimonialPrivate(ctx, pid, { id: input.id, version: input.version, set: input.set }) }))
}
