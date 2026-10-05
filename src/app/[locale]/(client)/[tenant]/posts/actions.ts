'use server'

/**
 * Client dashboard — blog post draft server actions (ADR-025 · S2b).
 *
 * Thin wrappers over `src/lib/api/post-drafts.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug is
 * only used to pick one of the caller's own grants. Failures collapse to a
 * small set of opaque codes the autosave UI understands.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { createPostDraft, patchPostDraft, PostDraftError, type PostDraftErrorCode } from '@/lib/api/post-drafts'

export type DraftActionError = 'unauthenticated' | PostDraftErrorCode

export type CreateDraftResult = { ok: true; id: string; rev: string } | { ok: false; error: DraftActionError }
export type PatchDraftResult = { ok: true; rev: string } | { ok: false; error: DraftActionError }

async function resolve(projectSlug: string) {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { error: 'unauthenticated' as const }
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return { error: 'forbidden' as const }
  return { ctx, grant }
}

function toError(error: unknown): DraftActionError {
  if (error instanceof PostDraftError) return error.code
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  return 'failed'
}

export async function createPostDraftAction(input: { projectSlug: string }): Promise<CreateDraftResult> {
  const r = await resolve(input?.projectSlug)
  if ('error' in r) return { ok: false, error: r.error! }
  try {
    const { id, rev } = await createPostDraft(r.ctx, r.grant.projectId)
    return { ok: true, id, rev }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

export async function patchPostDraftAction(input: {
  projectSlug: string
  id: string
  rev: string
  set: Record<string, unknown>
}): Promise<PatchDraftResult> {
  const r = await resolve(input?.projectSlug)
  if ('error' in r) return { ok: false, error: r.error! }
  try {
    const { rev } = await patchPostDraft(r.ctx, r.grant.projectId, {
      id: input.id,
      rev: input.rev,
      set: input.set,
    })
    return { ok: true, rev }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}
