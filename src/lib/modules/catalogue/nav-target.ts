// ── Catalogue — navigation link targets (ADR-033 Amendment G) ─────────────────
//
// Pure, browser-safe, no imports beyond slugs.ts. A navigation link
// (`navigationLink.pageRef`) may point at the catalogue landing page, a
// collection or an item. The website query projects the target as
// `catalogueTarget` (NAV_LINK_FIELDS in src/lib/sanity/queries.ts) — already
// scoped to the project and filtered by the lifecycle rule — and this decides
// its site-relative path, or that it has none:
//
//   cataloguePage        → {segment}
//   catalogueCollection  → {segment}/{slug in the request locale}   (hasPage only)
//   catalogueItem        → {segment}/{slug in the request locale}   (hasPage only)
//
// No segment (module not installed / switched off), no page, or no slug in the
// request locale → null, and the link is omitted. Never another locale's slug
// (C6, D-7): the primary lookup has no slug fallback, so it would 404.

import { normalise } from './slugs'

/** The projected target (null when missing, not public or in another project). */
export type CatalogueNavTarget = {
  type?: string | null
  hasPage?: boolean | null
  /** Slug in the REQUEST locale only. */
  slug?: string | null
  /** The enabled installation's public segment; null when not installed/enabled. */
  segment?: string | null
}

export const CATALOGUE_NAV_TARGET_TYPES = ['cataloguePage', 'catalogueCollection', 'catalogueItem'] as const

/** Site-relative path (no leading slash) of a catalogue nav target, or null. */
export function catalogueNavPath(target: CatalogueNavTarget | null | undefined): string | null {
  if (!target) return null
  const segment = normalise(target.segment ?? '')
  if (!segment) return null
  switch (target.type) {
    case 'cataloguePage':
      return segment
    case 'catalogueCollection':
    case 'catalogueItem': {
      if (target.hasPage !== true) return null
      const slug = typeof target.slug === 'string' ? target.slug.trim() : ''
      return slug ? `${segment}/${slug}` : null
    }
    default:
      return null
  }
}
