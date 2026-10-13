/**
 * ADR-032 D9 — which Activity action a change of a document's PUBLISHED
 * state represents. Pure. The one rule every recorder uses — dashboard
 * actions now, the Studio webhook and the reconciliation job in slice 3b — so
 * the same change is always named the same way, whoever made it.
 *
 * Only the published document counts: draft edits never appear in Activity.
 * Creating a draft ("created") and deleting a never-published draft
 * ("deleted") are recorded explicitly by the dashboard; they have no published
 * state to compare.
 */

import { deriveStatus } from './status'
import { instant, type LifecycleFields, type PublishedAtRule } from './visibility'

export const CONTENT_ACTIONS = [
  'created',
  'published',
  'scheduled',
  'schedule_changed',
  'unpublished',
  'archived',
  'restored',
  'deleted',
  'delete_refused',
] as const
export type ContentAction = (typeof CONTENT_ACTIONS)[number]

/** The published document's lifecycle fields; null = no published document. */
export type PublishedSnapshot = { publishedAt: string | null; expiresAt: string | null; archivedAt: string | null } | null

/** Reads the snapshot of a published document (or null when absent). */
export function snapshotOf(doc: LifecycleFields | Record<string, unknown> | null | undefined): PublishedSnapshot {
  if (!doc) return null
  const d = doc as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return { publishedAt: s(d.publishedAt), expiresAt: s(d.expiresAt), archivedAt: s(d.archivedAt) }
}

const sameInstant = (a: string | null, b: string | null) => instant(a) === instant(b)

/**
 * The action a change from `before` to `after` represents, or null when the
 * change is not a lifecycle event (e.g. a content edit of a live item).
 */
export function lifecycleAction(before: PublishedSnapshot, after: PublishedSnapshot, rule: PublishedAtRule, now: Date): ContentAction | null {
  if (!before && !after) return null
  if (before && !after) return 'deleted'
  const sa = deriveStatus({ published: after, rule }, now).status
  if (!before) return sa === 'archived' ? 'archived' : sa === 'scheduled' ? 'scheduled' : sa === 'unpublished' ? 'unpublished' : 'published'
  const sb = deriveStatus({ published: before, rule }, now).status
  if (sa === 'archived' && sb !== 'archived') return 'archived'
  if (sb === 'archived' && sa !== 'archived') return 'restored'
  if (sa !== sb) {
    if (sa === 'published') return 'published'
    if (sa === 'scheduled') return 'scheduled'
    if (sa === 'unpublished') return 'unpublished'
  }
  const datesChanged = !sameInstant(before.publishedAt, after!.publishedAt) || !sameInstant(before.expiresAt, after!.expiresAt)
  return datesChanged ? 'schedule_changed' : null
}
