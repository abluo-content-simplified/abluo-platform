// ── Catalogue visibility by delivery context (ADR-033 C5, C10, C11) ──────────
//
// `visibility` never decides alone: the CONTEXT does, from this one table.
// Every catalogue delivery path asks here — GROQ via `visibilityFilter()`,
// TypeScript via `admits()`. Never hand-write `visibility != "unlisted"`.
//
// The lifecycle (ADR-032 D3 `publicFilterFor`) is applied FIRST and separately,
// in every context: drafts, scheduled, unpublished, expired and archived
// content never reaches any row of this table.

import type { CatalogueVisibility } from './dto'

export const CATALOGUE_VISIBILITIES = ['public', 'websiteOnly', 'unlisted'] as const satisfies readonly CatalogueVisibility[]

export type CatalogueDeliveryContext =
  /** Anything the platform assembles without an editor choosing the item. */
  | 'automaticListing'
  /** An editor explicitly placed the item in a collection section. */
  | 'explicitReference'
  /** Partner / Connections output (ADR-031). */
  | 'partner'
  /** Sitemap entries. */
  | 'sitemap'
  /** Anything a search engine or assistant indexes: JSON-LD, llms.txt (C10). */
  | 'structuredData'

export const VISIBILITY_BY_CONTEXT: Readonly<Record<CatalogueDeliveryContext, readonly CatalogueVisibility[]>> = Object.freeze({
  automaticListing: ['public', 'websiteOnly'],
  explicitReference: ['public', 'websiteOnly', 'unlisted'],
  partner: ['public'],
  sitemap: ['public', 'websiteOnly'],
  structuredData: ['public', 'websiteOnly'],
})

/** A missing visibility is `public` — the schema default, as on events. */
export function visibilityOf(value: unknown): CatalogueVisibility {
  return (CATALOGUE_VISIBILITIES as readonly unknown[]).includes(value) ? (value as CatalogueVisibility) : 'public'
}

export function admits(context: CatalogueDeliveryContext, visibility: unknown): boolean {
  return VISIBILITY_BY_CONTEXT[context].includes(visibilityOf(visibility))
}

/**
 * GROQ boolean for `context`. `path` as in publicFilterFor — '' for the
 * document itself, `'@->'` inside an array filter, `'ref->'` for a field.
 * An undefined visibility counts as `public`.
 */
export function visibilityFilter(context: CatalogueDeliveryContext, path = ''): string {
  const field = `${path}visibility`
  const allowed = VISIBILITY_BY_CONTEXT[context]
  if (allowed.length === CATALOGUE_VISIBILITIES.length) return 'true'
  const list = allowed.map((v) => `"${v}"`).join(', ')
  return allowed.includes('public') ? `(!defined(${field}) || ${field} in [${list}])` : `(${field} in [${list}])`
}

/** An item's or collection's OWN page: `unlisted` pages resolve by link and are `noindex` (C5, C10). */
export function isIndexable(visibility: unknown): boolean {
  return visibilityOf(visibility) !== 'unlisted'
}
