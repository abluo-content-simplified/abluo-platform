// ── Catalogue — slugs and the public base-path segment ────────────────────────
//
// Authority: ADR-033 D4 (opt-in public pages) and D11 (one configurable
// base-path segment, shared across locales, with every historic segment
// retained and reserved).
//
// Pure. Existing pages, catalogue entities and the reserved-route list are all
// passed in — nothing here fetches anything, which is what lets the whole of
// D11's three interacting rules be tested as a matrix rather than reasoned about.

export type SlugOwner = {
  /** Sanity `_id`, so a conflict can name the document rather than the slug. */
  id: string
  type: 'item' | 'collection'
  /** Only documents with hasPage participate in the namespace. */
  hasPage: boolean
  /** Resolved slug per locale: { it: 'pizza-margherita', en: 'margherita' }. */
  slugs: Readonly<Record<string, string | null | undefined>>
}

/**
 * Routes the platform owns, which a tenant segment may never shadow.
 *
 * Passed in rather than hardcoded here: the list belongs to the router, and a
 * copy in this file would be the one that goes stale when a route is added.
 */
export const DEFAULT_RESERVED_SEGMENTS: readonly string[] = [
  'admin',
  'api',
  'catalogue',
  'collections',
  'events',
  'posts',
  'studio',
]

/**
 * Normalisation for comparison only — never for storage.
 *
 * Trim, strip leading and trailing slashes, lowercase, and normalise Unicode to
 * NFC so that "caffè" typed with a combining accent and "caffè" typed with a
 * precomposed one are recognised as the same slug. Without NFC two visually
 * identical slugs coexist happily and one of them 404s depending on the keyboard
 * that produced the link.
 */
export function normalise(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^\/+|\/+$/g, '').normalize('NFC').toLowerCase()
}

export type SlugConflict = {
  locale: string
  slug: string
  /** The document already using it. */
  owner: { id: string; type: 'item' | 'collection' }
}

/**
 * Does this slug collide with another catalogue document?
 *
 * ITEMS AND COLLECTIONS SHARE ONE NAMESPACE (D11). Both live directly under the
 * base segment, so `/menu/wine-list` can be an item or a collection but not
 * both. Uniqueness is per locale and nothing more: `/it/.../pizza` and
 * `/en/.../pizza` are different URLs, so the same slug in two locales is not a
 * collision — and the check must not invent one.
 */
export function slugConflicts(
  candidate: { id: string; slugs: Readonly<Record<string, string | null | undefined>> },
  existing: readonly SlugOwner[],
): SlugConflict[] {
  const out: SlugConflict[] = []
  for (const [locale, raw] of Object.entries(candidate.slugs)) {
    const slug = normalise(raw)
    if (!slug) continue
    for (const other of existing) {
      if (other.id === candidate.id || !other.hasPage) continue
      if (normalise(other.slugs[locale]) === slug) {
        out.push({ locale, slug, owner: { id: other.id, type: other.type } })
      }
    }
  }
  return out
}

export type SegmentState = {
  /** The segment in use now. */
  current: string
  /** Every segment this project has used before, each still redirecting. */
  history: readonly string[]
}

export type SegmentIssue =
  | { kind: 'empty' }
  | { kind: 'invalidCharacters'; value: string }
  | { kind: 'reservedRoute'; value: string }
  | { kind: 'pageSlugCollision'; value: string; locale: string }

/**
 * Whether a proposed segment may be used.
 *
 * Checked against reserved platform routes and against the project's own page
 * slugs in every locale — a segment that shadows a page would silently take its
 * URL, and the page would simply stop resolving with nothing to show why.
 *
 * NOT checked against the project's own history: returning to a previous name is
 * a revert, not a collision, and `applySegmentChange` handles it by retiring the
 * redirect.
 */
export function segmentIssues(
  candidate: string,
  opts: {
    pageSlugs?: Readonly<Record<string, readonly string[]>>
    reserved?: readonly string[]
  } = {},
): SegmentIssue[] {
  const value = normalise(candidate)
  const issues: SegmentIssue[] = []
  if (!value) return [{ kind: 'empty' }]
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) issues.push({ kind: 'invalidCharacters', value })

  const reserved = opts.reserved ?? DEFAULT_RESERVED_SEGMENTS
  if (reserved.map(normalise).includes(value)) issues.push({ kind: 'reservedRoute', value })

  for (const [locale, slugs] of Object.entries(opts.pageSlugs ?? {})) {
    if (slugs.map(normalise).includes(value)) issues.push({ kind: 'pageSlugCollision', value, locale })
  }
  return issues
}

/**
 * Apply a segment change, maintaining the history.
 *
 * A LIST, NOT A PREVIOUS VALUE. `menu` → `carta` → `menu-2026` would otherwise
 * drop the `menu` redirect at the second rename, and every link already printed
 * on a card or indexed by Google would 404. Each historic segment keeps
 * redirecting to whatever is current.
 *
 * REVERTING RETIRES A REDIRECT. Setting the segment back to a historic value
 * removes it from the history: it is the live segment again, so a redirect from
 * it to itself would be a loop. The segment being replaced joins the history in
 * the same step.
 *
 * Deduplicated and normalised, so a rename that differs only in case or a
 * trailing slash does not accumulate a second entry that reserves the same name
 * twice.
 */
export function applySegmentChange(state: SegmentState, next: string): SegmentState {
  const current = normalise(state.current)
  const candidate = normalise(next)
  if (!candidate || candidate === current) return { current, history: dedupe(state.history) }

  const history = dedupe([...state.history, current]).filter((h) => h !== candidate)
  return { current: candidate, history }
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const n = normalise(v)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** Every segment that must resolve: the live one plus everything that redirects. */
export function reservedSegments(state: SegmentState): string[] {
  return dedupe([state.current, ...state.history])
}

/**
 * What a request for `/{segment}/{slug}` should do.
 *
 *   serve     — the live segment
 *   redirect  — a historic segment; 301 to the same slug under the current one
 *   unknown   — not ours; the route must fall through to notFound() rather than
 *               swallow a path that belongs to something else
 */
export function resolveSegment(
  state: SegmentState,
  requested: string,
): { kind: 'serve' } | { kind: 'redirect'; to: string } | { kind: 'unknown' } {
  const value = normalise(requested)
  if (!value) return { kind: 'unknown' }
  if (value === normalise(state.current)) return { kind: 'serve' }
  if (dedupe(state.history).includes(value)) return { kind: 'redirect', to: normalise(state.current) }
  return { kind: 'unknown' }
}

/** The public path of a document, for canonical URLs and the sitemap. */
export function publicPath(opts: {
  locale: string
  tenant: string
  segment: string
  slug: string
}): string {
  return `/${opts.locale}/${opts.tenant}/${normalise(opts.segment)}/${normalise(opts.slug)}`
}
