/**
 * Content lifecycle — the user-facing status (ADR-032 D4).
 *
 * Nothing about status is stored: it is derived from the published document
 * (publication window + archive marker) and whether a draft exists. Every
 * dashboard list, filter and badge uses this one function.
 *
 *   draft        — never published (only `drafts.<id>` exists)
 *   scheduled    — published document, goes public at a future publishedAt
 *   published    — public now (may carry a future unpublish date: `unpublishOn`)
 *   unpublished  — exists, not public, and nothing will make it public by itself
 *                  (expired, empty window, or — posts — no publish date)
 *   archived     — archivedAt is set; dominates everything else
 */

import { instant, type LifecycleFields, type PublishedAtRule } from './visibility'

export const LIFECYCLE_STATUSES = ['draft', 'scheduled', 'published', 'unpublished', 'archived'] as const
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

export type LifecycleState = {
  status: LifecycleStatus
  /** A draft exists next to a published document (unpublished changes). */
  hasChanges: boolean
  /** Future publish moment (ISO) — only when status is 'scheduled'. */
  publishOn: string | null
  /** Future unpublish moment (ISO) — only when status is 'scheduled' or 'published'. */
  unpublishOn: string | null
}

export function deriveStatus(
  input: { published: LifecycleFields | null | undefined; draft?: unknown; rule: PublishedAtRule },
  now: Date
): LifecycleState {
  const { published, rule } = input
  const hasDraft = input.draft != null
  if (!published) return { status: 'draft', hasChanges: false, publishOn: null, unpublishOn: null }

  const base = { hasChanges: hasDraft, publishOn: null, unpublishOn: null }
  if (published.archivedAt != null) return { ...base, status: 'archived' }

  const t = now.getTime()
  const publishedAt = instant(published.publishedAt)
  const expiresAt = instant(published.expiresAt)

  if (expiresAt !== null && expiresAt <= t) return { ...base, status: 'unpublished' }
  if (rule === 'required' && publishedAt === null) return { ...base, status: 'unpublished' }
  // An empty window (unpublish not after publish) can never go public.
  if (publishedAt !== null && expiresAt !== null && expiresAt <= publishedAt) return { ...base, status: 'unpublished' }

  const unpublishOn = expiresAt !== null ? (published.expiresAt as string) : null
  if (publishedAt !== null && publishedAt > t) {
    return { ...base, status: 'scheduled', publishOn: published.publishedAt as string, unpublishOn }
  }
  return { ...base, status: 'published', unpublishOn }
}
