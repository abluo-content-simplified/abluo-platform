// ── Catalogue lists — pure helpers (sorting, columns, public link, batch) ─────
//
// Browser-safe, no imports beyond lifecycle types and the visibility/slug
// rules. The list screen (CatalogueBrowser) and the list loader (listCatalogue)
// share these so the decisions are tested once:
//   · the image frame shape (portrait for book covers, landscape otherwise),
//   · the sort of every column (empty values always last),
//   · whether a "View on website" link exists (never a link that would 404),
//   · which per-item action a batch operation maps to, and its result summary.

import type { LifecycleState, LifecycleStatus } from '@/lib/lifecycle/status'
import { admits } from './visibility'
import { normalise } from './slugs'
import { PROFILES, isItemProfile } from './profiles'

// ── Thumbnails ────────────────────────────────────────────────────────────────

/** Sanity CDN thumbnail that is never cropped: fits inside size × size, natural aspect ratio. */
export function containThumbUrl(url: unknown, size = 720): string | null {
  if (typeof url !== 'string' || !url.startsWith('https://cdn.sanity.io/')) return null
  const params = new URLSearchParams({ w: String(size), h: String(size), fit: 'max', auto: 'format' })
  return `${url}?${params.toString()}`
}

// ── Image frame shape ─────────────────────────────────────────────────────────

export type ImageShape = 'portrait' | 'landscape'

/** Starter presets whose items are photographed upright (book covers). */
const PORTRAIT_PRESETS: ReadonlySet<string> = new Set(['bookshop'])

/**
 * The frame shape of an item's list image (ADR-033 Amendment I-2, slice 4d).
 * An item with a profile follows the registry (book → portrait 2:3, the rest
 * landscape). Only an item WITHOUT a profile (created in Studio, never typed)
 * falls back to the catalogue's starter preset (`appliedPreset.id`): Bookshop
 * → portrait. Collections and option lists pass neither and stay landscape.
 */
export function catalogueImageShape(input: { presetId?: string | null; itemProfile?: string | null }): ImageShape {
  if (isItemProfile(input.itemProfile)) return PROFILES[input.itemProfile].list.imageShape
  return input.presetId && PORTRAIT_PRESETS.has(input.presetId) ? 'portrait' : 'landscape'
}

/**
 * Amendment K — "Publisher · 1979" under a book's author line (item page and
 * dashboard preview). Only when a publisher is set; the year rides along.
 * null otherwise (the year alone is not shown here).
 */
export function bookPublisherLine(input: { publisher?: string | null; year?: number | string | null }): string | null {
  const publisher = (input.publisher ?? '').trim()
  if (!publisher) return null
  const year = input.year == null ? '' : String(input.year).trim()
  return [publisher, year].filter(Boolean).join(' · ')
}

/**
 * The line under an item's name in the list. Book: "author · year" (the author
 * falls back to the byline); every other profile: the byline. Inputs are
 * already in the viewer's language; empty parts are left out.
 */
export function itemSecondaryLine(input: { itemProfile?: string | null; byline?: string | null; author?: string | null; year?: number | null }): string {
  const byline = (input.byline ?? '').trim()
  if (!isItemProfile(input.itemProfile) || PROFILES[input.itemProfile].list.secondary !== 'author') return byline
  const year = typeof input.year === 'number' && Number.isInteger(input.year) ? String(input.year) : ''
  return [(input.author ?? '').trim() || byline, year].filter(Boolean).join(' · ')
}

// ── Sorting ───────────────────────────────────────────────────────────────────

export const LIST_SORT_KEYS = ['name', 'status', 'changes', 'publishOn', 'unpublishOn', 'price', 'updated'] as const
export type ListSortKey = (typeof LIST_SORT_KEYS)[number]
export type ListSort = { key: ListSortKey; dir: 'asc' | 'desc' }
export const DEFAULT_LIST_SORT: ListSort = { key: 'name', dir: 'asc' }

/** "updated:desc" → sort; anything else → the default. */
export function parseListSort(value: string | null | undefined): ListSort {
  const [key, dir] = (value ?? '').split(':')
  if (!(LIST_SORT_KEYS as readonly string[]).includes(key)) return DEFAULT_LIST_SORT
  return { key: key as ListSortKey, dir: dir === 'desc' ? 'desc' : 'asc' }
}

export const formatListSort = (s: ListSort): string => `${s.key}:${s.dir}`

/** Clicking a header: the same column flips, a new one starts newest/highest first for dates and ascending otherwise. */
export function nextListSort(current: ListSort, key: ListSortKey): ListSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'updated' || key === 'publishOn' || key === 'unpublishOn' ? 'desc' : 'asc' }
}

export type SortableRow = {
  name: string
  status: LifecycleState
  /** Effective "publish on" (ISO) or null. */
  publishOn: string | null
  /** Effective "unpublish on" (ISO) or null. */
  unpublishOn: string | null
  price: number | null
  updatedAt: string
}

const STATUS_ORDER: Record<LifecycleStatus, number> = { draft: 0, scheduled: 1, published: 2, unpublished: 3, archived: 4 }
const time = (iso: string | null) => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Stable sort; rows without a value for the column always come last, whatever the direction. */
export function sortListRows<T extends SortableRow>(rows: readonly T[], sort: ListSort, locale: string): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const value = (r: T): number | string | null => {
    switch (sort.key) {
      case 'name':
        return r.name
      case 'status':
        return STATUS_ORDER[r.status.status]
      case 'changes':
        return r.status.hasChanges ? 1 : 0
      case 'publishOn':
        return time(r.publishOn)
      case 'unpublishOn':
        return time(r.unpublishOn)
      case 'price':
        return r.price
      case 'updated':
        return time(r.updatedAt)
    }
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v === b.v) return a.index - b.index
        return a.v === null ? 1 : -1
      }
      const c = typeof a.v === 'string' && typeof b.v === 'string' ? collator.compare(a.v, b.v) : (a.v as number) - (b.v as number)
      if (c !== 0) return c * sign
      return collator.compare(a.row.name, b.row.name) || a.index - b.index
    })
    .map((x) => x.row)
}

// ── Public link ───────────────────────────────────────────────────────────────

/**
 * Absolute public URL of an item's or collection's OWN page in the site's
 * default language, or null. A link is offered only when it resolves today:
 * the document is live now (status `published` — scheduled, unpublished,
 * expired, archived and never-published all 404), it has a page, a slug in
 * THAT language (no fallback to another language's slug — C6/D-7), the module
 * has a public segment, the site has a domain, and its visibility admits an
 * explicitly addressed page (`unlisted` pages resolve by link, C5). On a
 * path-served platform host the link stays on that host (`pathBase`).
 */
export function publicPageUrl(input: {
  status: LifecycleStatus
  hasPage: boolean
  visibility: unknown
  /** Slug in the site's default language (from the PUBLISHED version). */
  slug: string | null | undefined
  segment: string | null | undefined
  domain: string | null | undefined
  defaultLocale: string
  /**
   * Path-served platform hosts (dev.abluo.app, preview.abluo.app), e.g.
   * `https://dev.abluo.app/tmz`: the project segment is part of the URL and
   * the proxy adds the default language. Wins over `domain`.
   */
  pathBase?: string | null
}): string | null {
  if (input.status !== 'published' || !input.hasPage) return null
  if (!admits('explicitReference', input.visibility)) return null
  const slug = normalise(input.slug ?? '')
  const segment = normalise(input.segment ?? '')
  const domain = (input.domain ?? '').trim()
  const pathBase = (input.pathBase ?? '').trim().replace(/\/+$/, '')
  if (!slug || !segment) return null
  if (pathBase) return `${pathBase}/${segment}/${slug}`
  if (!domain || !input.defaultLocale) return null
  return `https://${domain}/${input.defaultLocale}/${segment}/${slug}`
}

// ── Menu / batch ──────────────────────────────────────────────────────────────

/** "Publish changes" in the row menu: a live or paused document with a newer draft. */
export function canPublishChanges(status: LifecycleState): boolean {
  return status.hasChanges && (status.status === 'published' || status.status === 'scheduled' || status.status === 'unpublished')
}

export const BATCH_OPS = ['publish', 'unpublish', 'archive', 'restore'] as const
export type BatchOp = (typeof BATCH_OPS)[number]

/** The existing per-item server action a batch operation runs for one row. */
export type BatchStep =
  | { via: 'publish'; mode: 'now' | 'keep' }
  | { via: 'lifecycle'; op: 'unpublish' | 'publishAgain' | 'archive' | 'restore' }

/**
 * What `op` means for this row, or null when it does not apply (the row is
 * skipped, never failed). Mirrors lifecycleMenu: archive/unpublish only on
 * documents that exist live; a never-published draft is published with
 * "now"; a paused one comes back; one with pending changes publishes them.
 */
export function batchStep(status: LifecycleState, op: BatchOp, canWrite: boolean): BatchStep | null {
  if (!canWrite) return null
  const s = status.status
  switch (op) {
    case 'publish':
      if (s === 'draft') return { via: 'publish', mode: 'now' }
      if (s === 'unpublished') return { via: 'lifecycle', op: 'publishAgain' }
      if ((s === 'published' || s === 'scheduled') && status.hasChanges) return { via: 'publish', mode: 'keep' }
      return null
    case 'unpublish':
      return s === 'published' || s === 'scheduled' ? { via: 'lifecycle', op: 'unpublish' } : null
    case 'archive':
      return s === 'published' || s === 'scheduled' || s === 'unpublished' ? { via: 'lifecycle', op: 'archive' } : null
    case 'restore':
      return s === 'archived' ? { via: 'lifecycle', op: 'restore' } : null
  }
}

/** Which batch operations apply to at least one of the selected rows. */
export function availableBatchOps(statuses: readonly LifecycleState[], canWrite: boolean): BatchOp[] {
  return BATCH_OPS.filter((op) => statuses.some((s) => batchStep(s, op, canWrite) !== null))
}

export type BatchOutcome = { id: string; name: string; ok: boolean; reason?: string }

/** Counts for the result line: how many worked, and the ones that need attention (named, with the reason). */
export function summarizeBatch(outcomes: readonly BatchOutcome[]): { done: number; failed: Array<{ id: string; name: string; reason: string }> } {
  return {
    done: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, name: o.name, reason: o.reason ?? '' })),
  }
}
