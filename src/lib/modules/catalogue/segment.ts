// ── Catalogue — the public base-path segment ──────────────────────────────────
//
// Authority: ADR-033 D11 (one configurable segment per project), Amendment C1
// (required at install, no default) and C2 (dispatch inside the tenant's
// `[...slug]` catch-all).
//
// Pure. This file is the contract the config surface, the Studio validator and
// the route all share; the low-level normalisation, history and redirect
// primitives live in ./slugs.ts and are reused, not restated.

import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'
import {
  applySegmentChange as applySegmentState,
  normalise,
  reservedSegments,
} from './slugs'

/** Lowercase, url-safe, ONE path segment: `menu`, `wine-list`, `books2`. */
export const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SEGMENT_MAX_LENGTH = 64

/** The regex string used by the manifest's `publicSegment` field validation. */
export const SEGMENT_REGEX_SOURCE = SEGMENT_PATTERN.source

/**
 * ADR-033 D11's named list. Always reserved, independent of what the router
 * happens to contain today.
 */
export const ADR_RESERVED_SEGMENTS: readonly string[] = [
  'events',
  'posts',
  'collections',
  'catalogue',
  'admin',
  'api',
]

/**
 * Everything a catalogue segment may never take: the ADR list plus
 * RESERVED_SLUGS, which is itself guarded against `src/app` by
 * `platform/__tests__/reserved-slugs.test.ts` (so a new static route folder
 * such as blog, category, news, live or preview cannot go unlisted) and is
 * additionally cross-checked against the website tenant folders in this
 * module's own test.
 */
export const CATALOGUE_RESERVED_SEGMENTS: readonly string[] = Array.from(
  new Set([...ADR_RESERVED_SEGMENTS, ...RESERVED_SLUGS].map(normalise)),
)

export type SegmentClash =
  | { kind: 'empty' }
  | { kind: 'tooLong'; max: number }
  /** Not a single lowercase url-safe segment (slashes, spaces, capitals, accents…). */
  | { kind: 'invalidSyntax'; value: string }
  /** Platform route (ADR D11 list or an existing static route folder). */
  | { kind: 'reserved'; value: string }
  /** First segment of an existing page slug: `menu` vs a page `menu/lunch`. */
  | { kind: 'pageSlug'; value: string }

export type SegmentValidation =
  | { ok: true; segment: string; /** Setting back to a historic value retires its redirect. */ revert: boolean }
  | { ok: false; clash: SegmentClash }

export type SegmentContext = {
  reserved?: readonly string[]
  /** First path segment of every page slug in the project, all locales. */
  pageFirstSegments?: readonly string[]
  /** Every segment this project has used before. */
  history?: readonly string[]
}

export function validateSegment(segment: string, ctx: SegmentContext = {}): SegmentValidation {
  const raw = typeof segment === 'string' ? segment.trim() : ''
  if (!raw) return { ok: false, clash: { kind: 'empty' } }
  if (raw.length > SEGMENT_MAX_LENGTH) {
    return { ok: false, clash: { kind: 'tooLong', max: SEGMENT_MAX_LENGTH } }
  }
  if (!SEGMENT_PATTERN.test(raw)) return { ok: false, clash: { kind: 'invalidSyntax', value: raw } }

  const reserved = (ctx.reserved ?? CATALOGUE_RESERVED_SEGMENTS).map(normalise)
  if (reserved.includes(raw)) return { ok: false, clash: { kind: 'reserved', value: raw } }

  if ((ctx.pageFirstSegments ?? []).map(normalise).includes(raw)) {
    return { ok: false, clash: { kind: 'pageSlug', value: raw } }
  }

  // A historic value is a revert, not a clash (spec §6.1 / §11).
  const revert = (ctx.history ?? []).map(normalise).includes(raw)
  return { ok: true, segment: raw, revert }
}

/**
 * The page-side mirror of the rule: may a page take this slug without
 * shadowing the live segment or a segment that still redirects? Returns the
 * clashing segment, or null.
 */
export function pageSlugShadowsSegment(
  pageSlug: string,
  state: { segment: string; history: readonly string[] },
): string | null {
  const first = normalise(pageSlug).split('/')[0]
  if (!first) return null
  return reservedSegments({ current: state.segment, history: state.history }).includes(first) ? first : null
}

/**
 * Change the segment, maintaining the append-only history. Reverting to a
 * historic value removes it from the history (spec §6.1, AC 15a).
 */
export function applySegmentChange(
  current: string,
  history: readonly string[],
  next: string,
): { segment: string; history: string[] } {
  const r = applySegmentState({ current, history }, next)
  return { segment: r.current, history: [...r.history] }
}

export type CatalogueDispatch =
  | { kind: 'landing' }
  | { kind: 'entry'; slug: string }
  | { kind: 'redirect'; to: string[] }

/**
 * ADR-033 C2 dispatch table, evaluated before the page lookup:
 *
 *   [seg]          seg == current          → landing
 *   [seg, slug]    seg == current          → entry (item/collection resolved by the route)
 *   [seg, ...]     seg ∈ history           → redirect to the same path under current
 *   anything else                           → null (fall through to the page lookup)
 *
 * An unconfigured segment (module not installed) dispatches nothing.
 */
export function dispatchCatalogue(
  segments: readonly string[],
  segment: string | null | undefined,
  history: readonly string[] = [],
): CatalogueDispatch | null {
  const current = normalise(segment)
  if (!current || segments.length === 0) return null
  const first = normalise(segments[0])
  if (!first) return null

  if (first === current) {
    if (segments.length === 1) return { kind: 'landing' }
    if (segments.length === 2 && segments[1]) return { kind: 'entry', slug: segments[1] }
    return null
  }

  if (history.map(normalise).includes(first)) {
    return { kind: 'redirect', to: [current, ...segments.slice(1)] }
  }
  return null
}
