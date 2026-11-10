'use server'

/**
 * Client dashboard — event server actions (Events module).
 *
 * Thin wrappers over `src/lib/api/event-drafts.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  createEvent,
  discardEventDraft,
  EventError,
  getEvent,
  getEventActivity,
  openEventForEdit,
  patchEventDraft,
  publishEventDraft,
  runEventLifecycle,
  setEventCover,
  setEventCoverFocal,
  setEventDates,
  type EventCover,
  type EventErrorCode,
  type EventLifecycleOp,
  type EventPublishMode,
  type EventSnapshot,
  type EventUsage,
} from '@/lib/api/event-drafts'
import type { ActivityItem } from '@/lib/lifecycle/activity'

export type EventActionError = 'unauthenticated' | EventErrorCode
type Result<T> = ({ ok: true } & T) | { ok: false; error: EventActionError; detail?: { usedIn?: EventUsage[] } }

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof EventError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
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

/** Moves the cover's focal point, on this event only (never the Media Library photo). */
export async function setEventCoverFocalAction(input: { projectSlug: string; id: string; rev: string; focal: { x: number; y: number } }): Promise<Result<{ rev: string; cover: EventCover | null }>> {
  return run(input?.projectSlug, (ctx, pid) => setEventCoverFocal(ctx, pid, { id: input.id, rev: input.rev, focal: input.focal }))
}

/**
 * Publish (ADR-032): `mode` 'now' · 'schedule' ("Publish on…" + publishAt) · 'keep' (an update keeps its dates).
 * `unpublishAt` ("Unpublish on…"): an ISO moment in the future, null to remove it, left out to keep what is set.
 */
export async function publishEventDraftAction(input: {
  projectSlug: string
  id: string
  rev: string
  mode?: EventPublishMode
  publishAt?: string
  unpublishAt?: string | null
}): Promise<Result<{ id: string; publishedAt: string | null; unpublishOn: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    publishEventDraft(ctx, pid, { id: input.id, rev: input.rev, mode: input.mode, publishAt: input.publishAt, unpublishAt: input.unpublishAt })
  )
}

/**
 * Unpublish · Publish again · Archive · Restore (write) and Delete permanently (events.event.delete; archived
 * events only, refused while something names the event). Past events are never archived automatically.
 */
export async function eventLifecycleAction(input: { projectSlug: string; id: string; op: EventLifecycleOp }): Promise<Result<{ rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => runEventLifecycle(ctx, pid, { id: input.id, op: input.op }))
}

/** "Publish on…" (a scheduled event) and "Unpublish on…" of a published event. Never archives. */
export async function setEventDatesAction(input: {
  projectSlug: string
  id: string
  publishAt?: string
  unpublishAt?: string | null
}): Promise<Result<{ publishedAt: string | null; unpublishOn: string | null; rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => setEventDates(ctx, pid, { id: input.id, publishAt: input.publishAt, unpublishAt: input.unpublishAt }))
}

export async function getEventActivityAction(input: { projectSlug: string; id: string }): Promise<Result<{ items: ActivityItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await getEventActivity(ctx, pid, { id: input.id }) }))
}

export async function discardEventDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ deleted: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => discardEventDraft(ctx, pid, { id: input.id, rev: input.rev }))
}
