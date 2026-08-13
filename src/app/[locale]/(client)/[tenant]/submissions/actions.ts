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
import { updateSubmissionStatus, type SubmissionStatus } from '@/lib/api/client-dashboard'

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
