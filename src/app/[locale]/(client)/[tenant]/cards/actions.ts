'use server'

/**
 * Client dashboard — Digital Cards server actions (ADR-049).
 *
 * Thin wrappers over `src/lib/api/digital-cards.ts` and
 * `digital-card-translate.ts`, which hold every check (permission, the
 * project from the GRANT, ids, revision guards). Identity is re-resolved
 * server-side on each call; the URL's projectSlug only picks one of the
 * caller's own grants. Failures collapse to opaque codes
 * (`mapDigitalCardActionError`); `publish_blocked` lists what is missing.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { mapDigitalCardActionError, type DigitalCardActionFail } from '@/lib/api/digital-card-action-error'
import {
  checkDigitalCardUrlName,
  createPersonCard,
  createSiteCard,
  discardDigitalCardDraft,
  getDigitalCard,
  getDigitalCardStats,
  getDigitalCardsOverview,
  openDigitalCardForEdit,
  publishDigitalCardDraft,
  runDigitalCardLifecycle,
  saveDigitalCardDraft,
  type DigitalCardLifecycleOp,
  type DigitalCardSnapshot,
  type DigitalCardsOverview,
} from '@/lib/api/digital-cards'
import { getDigitalCardPreview, type DigitalCardPreviewBase } from '@/lib/api/digital-card-preview'
import { translateDigitalCard, type DigitalCardTranslateResult } from '@/lib/api/digital-card-translate'
import type { DigitalCardStatsRead } from '@/lib/api/digital-card-stats'

type Result<T> = ({ ok: true } & T) | DigitalCardActionFail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    return mapDigitalCardActionError(error)
  }
}

export async function getDigitalCardAction(input: { projectSlug: string; id: string }): Promise<Result<{ card: DigitalCardSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ card: await getDigitalCard(ctx, pid, input.id) }))
}

/** "New Site Card": the one site card (refused as `site_exists` when there is one). */
export async function createSiteCardAction(input: { projectSlug: string }): Promise<Result<{ id: string; publicId: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createSiteCard(ctx, pid))
}

/** "New Person Card": a card for a People person without one. */
export async function createPersonCardAction(input: { projectSlug: string; personId: string }): Promise<Result<{ id: string; publicId: string; rev: string; urlName: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createPersonCard(ctx, pid, { personId: input.personId }))
}

/** Creates drafts.<id> from the published card when missing. Call before the first edit. */
export async function openDigitalCardForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openDigitalCardForEdit(ctx, pid, { id: input.id }))
}

export async function saveDigitalCardDraftAction(input: { projectSlug: string; id: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => saveDigitalCardDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function publishDigitalCardDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishDigitalCardDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardDigitalCardDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardDigitalCardDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

/** Unpublish · Back online · Archive · Restore · Delete a draft · Delete permanently (Owner). */
export async function digitalCardLifecycleAction(input: { projectSlug: string; id: string; op: DigitalCardLifecycleOp }): Promise<Result<{ rev: string | null }>> {
  return run(input?.projectSlug, (ctx, pid) => runDigitalCardLifecycle(ctx, pid, { id: input.id, op: input.op }))
}

/** Live URL-name check while typing (D5). */
export async function checkDigitalCardUrlNameAction(input: { projectSlug: string; id: string; urlName: string }): Promise<Result<{ valid: boolean; available: boolean; suggestion: string }>> {
  return run(input?.projectSlug, (ctx, pid) => checkDigitalCardUrlName(ctx, pid, { id: input.id, urlName: input.urlName }))
}

/** Statistics for one card (digital-cards.stats.read). */
export async function getDigitalCardStatsAction(input: { projectSlug: string; id: string; days: number }): Promise<Result<{ stats: DigitalCardStatsRead }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ stats: await getDigitalCardStats(ctx, pid, { id: input.id, days: input.days }) }))
}

/** Translate button: fills the EMPTY languages of the description and the link labels (returned, not saved). */
export async function translateDigitalCardAction(input: { projectSlug: string; id: string; sourceLocale: string }): Promise<Result<DigitalCardTranslateResult>> {
  return run(input?.projectSlug, (ctx, pid) => translateDigitalCard(ctx, pid, { id: input.id, sourceLocale: input.sourceLocale }))
}

/** The editor's live preview: site / person data, pages, files, background and design system in one language (digital-cards.read). */
export async function getDigitalCardPreviewAction(input: {
  projectSlug: string
  id: string
  locale: string
  backgroundId: string | null
  fileIds: string[]
  /** Page links' references (Amendment B: catalogue targets are read for these). */
  targetIds?: string[]
}): Promise<Result<{ preview: DigitalCardPreviewBase }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({
    preview: await getDigitalCardPreview(ctx, pid, { id: input.id, locale: input.locale, backgroundId: input.backgroundId, fileIds: input.fileIds, targetIds: input.targetIds }),
  }))
}

/** Analytics page: all cards together over 7 / 30 / 90 / 365 days (digital-cards.stats.read). */
export async function getDigitalCardsOverviewAction(input: { projectSlug: string; days: number }): Promise<Result<{ overview: DigitalCardsOverview }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ overview: await getDigitalCardsOverview(ctx, pid, { days: input.days }) }))
}
