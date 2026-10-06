'use server'

/**
 * Client dashboard — Submissions status mutation (ADR-018 slice 6).
 *
 * A single Server Action the Submissions table calls to move a lead through its
 * workflow (new → processed → archived). It re-resolves the authorization
 * context server-side (never trusting the client for identity), re-validates the
 * URL projectSlug against the caller's grants, then delegates to
 * `updateSubmissionStatus`, whose `assertModuleAction(forms.submission.update)`
 * gate + RLS-scoped UPDATE are the real enforcement. Returns a small result the
 * client uses to confirm or roll back its optimistic update.
 */

import { revalidatePath } from 'next/cache'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  deleteSubmissions,
  SUBMISSION_BATCH_MAX,
  updateSubmissionsStatusBatch,
  updateSubmissionStatus,
  type SubmissionStatus,
} from '@/lib/api/client-dashboard'

const ALLOWED: readonly SubmissionStatus[] = ['new', 'processed', 'archived']

export interface SetStatusInput {
  projectSlug: string
  submissionId: string
  status: SubmissionStatus
  /** Current locale — used only to revalidate the correct dashboard path. */
  locale: string
}

export interface SetStatusResult {
  ok: boolean
  error?: 'invalid_status' | 'unauthenticated' | 'forbidden' | 'update_failed'
}

export async function setSubmissionStatusAction(input: SetStatusInput): Promise<SetStatusResult> {
  const { projectSlug, submissionId, status, locale } = input

  if (!ALLOWED.includes(status)) return { ok: false, error: 'invalid_status' }

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }

  try {
    await updateSubmissionStatus(ctx, grant.projectId, submissionId, status)
  } catch {
    // Permission/RLS failures and DB errors collapse to a single opaque result —
    // the client never learns which check fired.
    return { ok: false, error: 'update_failed' }
  }

  revalidatePath(`/${locale}/${projectSlug}/submissions`)
  return { ok: true }
}

export interface BatchInput {
  projectSlug: string
  submissionIds: string[]
  locale: string
}

export interface BatchResult {
  ok: boolean
  /** Rows actually changed / removed inside this project. */
  count?: number
  error?: 'invalid_input' | 'unauthenticated' | 'forbidden' | 'failed'
}

async function resolveBatch(input: BatchInput) {
  const ids = Array.isArray(input.submissionIds) ? input.submissionIds : []
  if (ids.length === 0 || ids.length > SUBMISSION_BATCH_MAX || !ids.every((i) => typeof i === 'string')) {
    return { error: 'invalid_input' as const }
  }
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { error: 'unauthenticated' as const }
  const grant = resolveProjectGrant(ctx.projects, input.projectSlug)
  if (!grant) return { error: 'forbidden' as const }
  return { ctx, projectId: grant.projectId, ids }
}

/** Batch status change (max 100); the project comes from the caller's grant. */
export async function setSubmissionsStatusBatchAction(
  input: BatchInput & { status: SubmissionStatus },
): Promise<BatchResult> {
  if (!ALLOWED.includes(input.status)) return { ok: false, error: 'invalid_input' }
  const r = await resolveBatch(input)
  if ('error' in r) return { ok: false, error: r.error }
  try {
    const count = await updateSubmissionsStatusBatch(r.ctx, r.projectId, r.ids, input.status)
    revalidatePath(`/${input.locale}/${input.projectSlug}/submissions`)
    return { ok: true, count }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Batch permanent delete (max 100); gated by forms.submission.delete. */
export async function deleteSubmissionsAction(input: BatchInput): Promise<BatchResult> {
  const r = await resolveBatch(input)
  if ('error' in r) return { ok: false, error: r.error }
  try {
    const count = await deleteSubmissions(r.ctx, r.projectId, r.ids)
    revalidatePath(`/${input.locale}/${input.projectSlug}/submissions`)
    return { ok: true, count }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
