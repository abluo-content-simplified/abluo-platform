/**
 * ADR-032 slice 6 — the list shows a lifecycle change at once.
 *
 * After Unpublish / Publish again / Archive / Restore / an unpublish date, the
 * server returns the post's new live state and the revision it replaced. The
 * refreshed list can be a moment behind (it may still carry the old revision),
 * so the row shows the returned state for as long as the list still holds the
 * replaced revision — and drops it as soon as the list has caught up (or the
 * post changed again elsewhere).
 */
import { publishedStatus } from '@/lib/lifecycle/status'
import type { PostStatus } from './posts-filter'

export type LiveOverlay = {
  previousRev: string
  live: { rev: string; publishedAt: string | null; expiresAt: string | null; archivedAt: string | null }
}

type Row = { _id: string; liveRev?: string | null; status: PostStatus; publishedAt: string | null; expiresAt: string | null; archivedAt?: string | null; hasLive?: boolean }

export function applyLiveOverlays<T extends Row>(rows: T[], overlays: ReadonlyMap<string, LiveOverlay>, now = new Date()): T[] {
  if (!overlays.size) return rows
  return rows.map((row) => {
    const o = overlays.get(row._id)
    if (!o || !row.hasLive || (row.liveRev ?? '') !== o.previousRev) return row
    return {
      ...row,
      liveRev: o.live.rev,
      publishedAt: o.live.publishedAt,
      expiresAt: o.live.expiresAt,
      archivedAt: o.live.archivedAt,
      status: publishedStatus(o.live, 'required', now),
    }
  })
}

/** Overlays the list no longer needs (it caught up, or the post moved on). */
export function staleOverlays(rows: { _id: string; liveRev?: string | null }[], overlays: ReadonlyMap<string, LiveOverlay>): string[] {
  const byId = new Map(rows.map((r) => [r._id, r.liveRev ?? '']))
  return [...overlays.entries()].filter(([id, o]) => byId.get(id) !== o.previousRev).map(([id]) => id)
}
