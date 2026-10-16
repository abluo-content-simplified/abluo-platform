'use server'

/**
 * Client dashboard — a post's Activity (ADR-032 D9). Thin wrapper over
 * `src/lib/api/post-activity.ts`, which holds every check. Identity is
 * re-resolved server-side; the URL's projectSlug only picks one of the
 * caller's own grants. Failures collapse to opaque codes.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostDraftError } from '@/lib/api/post-drafts'
import { getPostActivity, type PostActivity } from '@/lib/api/post-activity'

export type PostActivityResult = ({ ok: true } & PostActivity) | { ok: false; error: 'unauthenticated' | 'forbidden' | 'not_found' | 'failed' }

export async function getPostActivityAction(input: { projectSlug: string; id: string }): Promise<PostActivityResult> {
  const access = await resolveProjectAction(input.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await getPostActivity(ctx, grant.projectId, input.id)) }
  } catch (error) {
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    if (error instanceof PostDraftError && error.code === 'not_found') return { ok: false, error: 'not_found' }
    return { ok: false, error: 'failed' }
  }
}
