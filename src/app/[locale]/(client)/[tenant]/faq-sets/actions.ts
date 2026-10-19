'use server'

/**
 * Client dashboard — FAQ set server actions (ADR-037).
 *
 * Thin wrappers over `src/lib/api/faq-sets.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes
 * (`FaqSetErrorCode`); `detail.usedIn` says where a set is used (in_use).
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostLinkSearchError, type LinkTargetResult } from '@/lib/api/post-link-search'
import {
  createFaqSet,
  discardFaqSetDraft,
  duplicateFaqSet,
  FaqSetError,
  getFaqSet,
  getFaqSetActivity,
  listFaqSets,
  openFaqSetForEdit,
  patchFaqSetDraft,
  publishFaqSetDraft,
  runFaqSetLifecycle,
  searchFaqLinkTargets,
  type FaqSetErrorCode,
  type FaqSetLifecycleOp,
  type FaqSetListItem,
  type FaqSetSnapshot,
  type FaqSetUsage,
  type FaqSite,
} from '@/lib/api/faq-sets'
import type { ActivityItem } from '@/lib/lifecycle/activity'

export type FaqSetActionError = 'unauthenticated' | FaqSetErrorCode
type Fail = { ok: false; error: FaqSetActionError; detail?: { usedIn?: FaqSetUsage[] } }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof FaqSetError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
    if (error instanceof PostLinkSearchError) return { ok: false, error: 'invalid_value' }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function listFaqSetsAction(input: { projectSlug: string }): Promise<Result<{ sets: FaqSetListItem[]; site: FaqSite }>> {
  return run(input?.projectSlug, (ctx, pid) => listFaqSets(ctx, pid))
}

export async function getFaqSetAction(input: { projectSlug: string; id: string }): Promise<Result<{ set: FaqSetSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ set: await getFaqSet(ctx, pid, input.id) }))
}

export async function createFaqSetAction(input: { projectSlug: string; name: string }): Promise<Result<{ id: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createFaqSet(ctx, pid, { name: input.name }))
}

/** Creates drafts.<id> from the published set when missing. Call before the first edit. */
export async function openFaqSetForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openFaqSetForEdit(ctx, pid, { id: input.id }))
}

export async function patchFaqSetDraftAction(input: {
  projectSlug: string
  id: string
  rev: string
  set: Record<string, unknown>
}): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => patchFaqSetDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function publishFaqSetDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishFaqSetDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardFaqSetDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardFaqSetDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

export async function duplicateFaqSetAction(input: { projectSlug: string; id: string; name: string }): Promise<Result<{ id: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => duplicateFaqSet(ctx, pid, { id: input.id, name: input.name }))
}

/** Archive, restore, delete a never-published draft, or delete an archived set for good. `rev` = the draft's new revision, if any. */
export async function faqSetLifecycleAction(input: { projectSlug: string; id: string; op: FaqSetLifecycleOp }): Promise<Result<{ rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => runFaqSetLifecycle(ctx, pid, { id: input.id, op: input.op }))
}

export async function getFaqSetActivityAction(input: { projectSlug: string; id: string }): Promise<Result<{ items: ActivityItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await getFaqSetActivity(ctx, pid, { id: input.id }) }))
}

/** The answer editor's link search: pages, posts, news, events and Catalogue items/collections. */
export async function searchFaqLinkTargetsAction(input: {
  projectSlug: string
  locale: string
  query?: string
  ids?: string[]
}): Promise<Result<{ results: LinkTargetResult[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({
    results: await searchFaqLinkTargets(ctx, pid, { locale: input.locale, query: input.query, ids: input.ids }),
  }))
}
