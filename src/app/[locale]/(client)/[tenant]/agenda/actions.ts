'use server'

/**
 * Client dashboard — event server actions (Events module).
 *
 * Thin wrappers over `src/lib/api/event-drafts.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  createEvent,
  discardEventDraft,
  EventError,
  getEvent,
  openEventForEdit,
  patchEventDraft,
  publishEventDraft,
  setEventCover,
  type EventCover,
  type EventErrorCode,
  type EventSnapshot,
} from '@/lib/api/event-drafts'

export type EventActionError = 'unauthenticated' | EventErrorCode
type Result<T> = ({ ok: true } & T) | { ok: false; error: EventActionError }

async function run<T>(projectSlug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getTenantAuthorizationContext>>>, projectId: string) => Promise<T>): Promise<Result<T>> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = typeof projectSlug === 'string' ? resolveProjectGrant(ctx.projects, projectSlug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof EventError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function getEventAction(input: { projectSlug: string; id: string }): Promise<Result<{ event: EventSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ event: await getEvent(ctx, pid, input.id) }))
}

/** Creates drafts.<id> from the published event when missing. Call before the first change. */
export async function openEventForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openEventForEdit(ctx, pid, input.id))
}

export async function createEventAction(input: { projectSlug: string; title: string; startDate: string }): Promise<Result<{ id: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createEvent(ctx, pid, { title: input.title, startDate: input.startDate }))
}

export async function patchEventDraftAction(input: { projectSlug: string; id: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => patchEventDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function setEventCoverAction(input: { projectSlug: string; id: string; rev: string; assetId?: string; remove?: true }): Promise<Result<{ rev: string; cover: EventCover | null }>> {
  return run(input?.projectSlug, (ctx, pid) => setEventCover(ctx, pid, { id: input.id, rev: input.rev, assetId: input.assetId, remove: input.remove }))
}

export async function publishEventDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ id: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishEventDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardEventDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ deleted: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => discardEventDraft(ctx, pid, { id: input.id, rev: input.rev }))
}
