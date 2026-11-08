/**
 * Dashboard search (ADR-047) — the contract between the server (search engine +
 * server action) and the client (SearchPalette / ClientSearch).
 *
 * The server returns CONTENT results only. "Go to" and "Create" are built on the
 * client from data the layout already has (buildClientNavItems / buildCreateMenu),
 * so they cost no request and inherit the same permission filtering.
 */

/** One content kind that can appear in results. Module ids, plus the platform Media Library. */
export type SearchKind = 'blog' | 'events' | 'courses' | 'catalogue' | 'people' | 'media' | 'forms'

export type SearchHit = {
  /** Bare document / row id (never `drafts.`-prefixed). */
  id: string
  kind: SearchKind
  /** Display title, already resolved to the viewer's language (fallback: site default, then any). */
  title: string
  /** Optional second line (e.g. excerpt, role, sender email, date) — plain text, already resolved. */
  subtitle?: string
  /**
   * Why it matched, when the match is NOT in the title: a short window of the
   * matching text (~120 chars), split so the client can emphasise the match.
   * `before`/`after` carry their own "…" when cut. Plain text only.
   */
  snippet?: { before: string; match: string; after: string }
  /** Small square thumbnail URL, when the item has an image. */
  thumbUrl?: string
  /** Locale-agnostic dashboard href: `/{projectSlug}/…` (the client prefixes the locale like every other link). */
  href: string
  /** Last edited (ISO date-time) — the client shows it as "2d", "1w". */
  updatedAt?: string
  /**
   * Public website URL of the item, only when it is published and visible on
   * the site (absolute, on the project's own domain). Drives "View on website".
   */
  siteUrl?: string
  /** The item only exists as an unpublished draft. */
  draft?: boolean
  /** The item is archived (only returned when `includeArchived`). */
  archived?: boolean
}

export type SearchGroup = {
  kind: SearchKind
  /** At most SEARCH_GROUP_LIMIT hits, best first. */
  hits: SearchHit[]
  /** True when more matches exist than were returned → the client shows "See all in {Module}". */
  more: boolean
  /** Locale-agnostic list href for "See all", with `?q=` already appended (`/{projectSlug}/posts?q=…`). */
  seeAllHref: string
}

export type SearchRequest = {
  projectSlug: string
  q: string
  includeArchived?: boolean
}

export type SearchResponse =
  | { ok: true; q: string; groups: SearchGroup[] }
  | { ok: false; q: string; error: 'too_short' | 'unauthorized' | 'failed' }

export const SEARCH_MIN_CHARS = 2
export const SEARCH_GROUP_LIMIT = 5
export const SEARCH_MAX_QUERY_LENGTH = 100
/** Display order of the content groups. */
export const SEARCH_KIND_ORDER: SearchKind[] = ['blog', 'events', 'courses', 'catalogue', 'people', 'media', 'forms']
