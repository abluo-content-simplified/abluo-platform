'use server'

/**
 * Client dashboard — editing live posts and post lifecycle (ADR-025 · wave 2).
 *
 * Thin wrappers over `src/lib/api/post-lifecycle.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostDraftError, type PostDraftErrorCode, type PostLiveState } from '@/lib/api/post-drafts'
import {
  deletePostDraft,
  deletePublishedPost,
  discardPostChanges,
  openPostForEdit,
  putPostBackOnline,
  takePostOffline,
} from '@/lib/api/post-lifecycle'

export type LifecycleActionError = 'unauthenticated' | PostDraftErrorCode

type Fail = { ok: false; error: LifecycleActionError }
export type OpenForEditResult = { ok: true; id: string } | Fail
export type LiveResult = { ok: true; live: PostLiveState } | Fail
export type DoneResult = { ok: true } | Fail

type Input = { projectSlug: string; id: string; rev: string }

async function run<T>(projectSlug: string, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getTenantAuthorizationContext>>>, projectId: string) => Promise<T>): Promise<
  { ok: true; value: T } | Fail
> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    return { ok: true, value: await fn(ctx, grant.projectId) }
  } catch (error) {
    if (error instanceof PostDraftError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function openPostForEditAction(input: { projectSlug: string; id: string }): Promise<OpenForEditResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => openPostForEdit(ctx, projectId, input.id))
  return r.ok ? { ok: true, id: r.value.id } : r
}

export async function takePostOfflineAction(input: Input): Promise<LiveResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => takePostOffline(ctx, projectId, { id: input.id, rev: input.rev }))
  return r.ok ? { ok: true, live: r.value } : r
}

export async function putPostBackOnlineAction(input: Input): Promise<LiveResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => putPostBackOnline(ctx, projectId, { id: input.id, rev: input.rev }))
  return r.ok ? { ok: true, live: r.value } : r
}

export async function discardPostChangesAction(input: Input): Promise<DoneResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => discardPostChanges(ctx, projectId, { id: input.id, rev: input.rev }))
  return r.ok ? { ok: true } : r
}

export async function deletePostDraftAction(input: Input): Promise<DoneResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => deletePostDraft(ctx, projectId, { id: input.id, rev: input.rev }))
  return r.ok ? { ok: true } : r
}

export async function deletePublishedPostAction(input: Input): Promise<DoneResult> {
  const r = await run(input?.projectSlug, (ctx, projectId) => deletePublishedPost(ctx, projectId, { id: input.id, rev: input.rev }))
  return r.ok ? { ok: true } : r
}
