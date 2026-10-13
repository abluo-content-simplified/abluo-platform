// ── Boundary-aware incremental sync for the partner API (ADR-032 D11) ────────
//
// What a partner receives on every poll, and why it is safe to repeat.
//
// SWEEP. A sweep is one pass from the partner's position (`after`) up to a
// window end `w` that is FIXED when the sweep starts (now − SETTLE_MS) and
// carried, unchanged, in every next_cursor of that sweep. The last page's
// next_cursor starts the following sweep at (w, end-of-instant).
//
// EFFECTIVE CHANGE TIME. An item is in the sweep when its effective change
// time e falls in (after, w]:
//     e = the latest of _updatedAt, publishedAt, expiresAt, archivedAt that is ≤ w
// so an item scheduled to go live, or to go offline, reaches partners when that
// stored date passes — no edit needed, and a late poll loses nothing (the date
// is still there). Items are paged by (e, stable public id): integer
// milliseconds, compared exactly, in Sanity and in this file alike.
//
// STATE. The lifecycle state (public, or removed with a reason) is evaluated
// AT w; the content is the stored content when the page is read.
//
// GUARANTEE (what we promise — at-least-once, latest state wins):
//   1. Every change whose effective time is ≤ w is delivered in the sweep that
//      covers it, or — if the item was edited, deleted or republished while
//      the sweep was running — in the next sweep (its new _updatedAt or
//      removal time is after w).
//   2. An item may be delivered more than once (in later pages of the same
//      sweep after a concurrent edit, or again in the next sweep). Each row is
//      a complete statement of the item's state: consumers upsert by `id`
//      (full row) or delete by `id` (row with `deleted: true`), in the order
//      received. Repeating a row, or a removal for an unknown id, is harmless.
//   3. Within one response there is at most one row per id.
//   4. A tombstone is never reported for an item whose published document
//      exists when the page is read (a republished item is never reported
//      removed); that item's own row reports its current state.
//   5. Initial sync (no cursor, no updated_since): removal rows are omitted for
//      the whole first sweep — the consumer holds nothing that could need
//      removing, and never-public items (e.g. scheduled) are not disclosed.
//   Not promised: exactly-once delivery, or delivery of intermediate states
//   that began and ended inside one window (e.g. published and expired between
//   two polls arrives as one removal).

import { deriveStatus } from '@/lib/lifecycle/status'
import type { PublishedAtRule } from '@/lib/lifecycle/visibility'

/** The stored dates whose passing is a change partners must hear about. */
export const BOUNDARY_FIELDS = ['_updatedAt', 'publishedAt', 'expiresAt', 'archivedAt'] as const

const ms = (field: string) => `round((dateTime(${field}) - dateTime("1970-01-01T00:00:00Z")) * 1000)`

/** GROQ: the effective change time (integer ms) of the current document, with `$upToMs` the window end. */
export const EFFECTIVE_CHANGE_MS_GROQ = `math::max([${BOUNDARY_FIELDS.map(ms).join(', ')}][defined(@) && @ <= $upToMs])`

/** GROQ filter on a projection carrying `_eff` and `publicId`: strictly after the cursor. */
export const AFTER_CURSOR_GROQ = `[_eff > $afterMs || (_eff == $afterMs && publicId > $afterId)]`

type Dated = Partial<Record<(typeof BOUNDARY_FIELDS)[number], unknown>>

const toMs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** The JS twin of EFFECTIVE_CHANGE_MS_GROQ (tests check they agree). null = nothing ≤ w yet. */
export function effectiveChangeMs(doc: Dated, upToMs: number): number | null {
  let best: number | null = null
  for (const f of BOUNDARY_FIELDS) {
    const t = toMs(doc[f])
    if (t !== null && t <= upToMs && (best === null || t > best)) best = t
  }
  return best
}

export type LifecycleRemovalReason = 'archived' | 'unpublished'

/**
 * Why a stored document is not public at `w`, from its lifecycle dates only
 * (archived dominates; expired, not yet public or an empty window are
 * "unpublished"). Module-specific reasons (unlisted, websiteOnly) come after.
 */
export function lifecycleRemovalAt(doc: Dated, rule: PublishedAtRule, w: Date): LifecycleRemovalReason | null {
  const status = deriveStatus({ published: doc as never, rule }, w).status
  if (status === 'archived') return 'archived'
  if (status === 'unpublished' || status === 'scheduled') return 'unpublished'
  return null
}

// ── Merging one page ────────────────────────────────────────────────────────

export type Candidate<T> = { t: number; id: string; kind: 'live' | 'tombstone'; removal: boolean; out: T }

const cmp = (a: { t: number; id: string }, b: { t: number; id: string }) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Builds one page from two ordered candidate streams (live documents and
 * tombstones, each already limited to `limit + 1` after the cursor).
 *
 * Paging is decided on CANDIDATES (so the cursor advances past everything
 * considered); rows are then filtered — suppressed tombstones, initial-sync
 * removals, and all but the latest row per id. A page can therefore hold
 * fewer than `limit` rows while has_more is true.
 */
export function buildPage<T>(
  streams: Candidate<T>[][],
  opts: { limit: number; existingIds: ReadonlySet<string>; initial: boolean }
): { rows: T[]; last: { t: number; id: string } | null; hasMore: boolean } {
  const all = streams.flat().sort(cmp)
  const hasMore = all.length > opts.limit
  const considered = all.slice(0, opts.limit)
  const last = considered.at(-1) ?? null
  const kept = new Map<string, Candidate<T>>()
  for (const c of considered) {
    if (c.kind === 'tombstone' && opts.existingIds.has(c.id)) continue // republished: its own row speaks
    if (opts.initial && c.removal) continue
    const prev = kept.get(c.id)
    if (!prev || cmp(prev, c) < 0) kept.set(c.id, c)
  }
  const rows = [...kept.values()].sort(cmp).map((c) => c.out)
  return { rows, last: last ? { t: last.t, id: last.id } : null, hasMore }
}
