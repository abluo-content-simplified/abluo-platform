/**
 * Dashboard search (ADR-047) — builds the ONE Sanity request for every Sanity
 * kind from the modules' declarations, and merges the rows it returns.
 *
 * Safety by construction:
 *  - Every sub-query filters `projectSlug == $projectSlug` (the slug is the
 *    caller's grant, never the request) and excludes `versions.**`.
 *  - User text is NEVER part of the query string: each search word is a bound
 *    parameter (`$t0`, `$t1`, …). Everything interpolated below comes from the
 *    static module declarations.
 */
import { LOCALE_CODES } from '@/lib/i18n/locales'
import type { ModuleSearchDef, SanitySearchSource, SearchField } from '@/lib/modules/types'
import type { SearchKind } from './types'

export type SanitySearchDef = ModuleSearchDef & { source: SanitySearchSource }

export const isSanitySearchDef = (d: ModuleSearchDef): d is SanitySearchDef => d.source.type === 'sanity'

/** Rows fetched per type before draft/published merging (≈ 20 documents, two rows each at worst). */
export const SEARCH_ROW_CAP = 40
export const SEARCH_MAX_WORDS = 4
/** Key under which the site's default content locale travels in the same response. */
export const SITE_KEY = '_site'

/** Splits the query into bound-parameter terms: lowercase words, prefix-matched. */
export function searchTerms(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[*"\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SEARCH_MAX_WORDS)
  return words.map((w) => `${w}*`)
}

function scalarExprs(f: SearchField): string[] {
  const wrap = (e: string) => (f.when ? `select(${f.when} => ${e})` : e)
  switch (f.kind) {
    case 'localizedString':
    case 'localizedText':
      return LOCALE_CODES.map((c) => wrap(`${f.name}.${c}`))
    case 'localizedPortableText':
      return LOCALE_CODES.map((c) => wrap(`pt::text(${f.name}.${c})`))
    case 'string':
      return [wrap(f.name)]
    case 'stringArray':
      return []
  }
}

/**
 * score() accepts only plain attribute paths (and pt::text of one) on the left
 * of `match`: no `select()`, no `->` dereference, no `[]` traversal — Sanity
 * rejects the whole query with "score() function received unexpected
 * expression" (live failure on dev, 2026-11-08). Those fields still FILTER;
 * they just don't add to the ranking.
 */
export const scoreable = (f: SearchField): boolean => !f.when && !f.name.includes('->')

/** `match` expression for the fields of one weight tier against one term param. */
function tierMatch(fields: SearchField[], term: string, forScore = false): string | null {
  const used = forScore ? fields.filter(scoreable) : fields
  const scalars = used.flatMap(scalarExprs)
  const parts: string[] = []
  if (scalars.length) parts.push(`[${scalars.join(', ')}] match ${term}`)
  for (const f of used) if (f.kind === 'stringArray') parts.push(forScore ? `${f.name} match ${term}` : `${f.name}[] match ${term}`)
  return parts.length ? `(${parts.join(' || ')})` : null
}

const tiers = (fields: SearchField[]) =>
  ([3, 2, 1] as const).map((w) => ({ weight: w, fields: fields.filter((f) => f.weight === w) })).filter((t) => t.fields.length)

/**
 * For a draft row, its published twin's state — so a draft whose text matched is
 * not mislabelled "draft only" (or un-archived) when the published document did
 * not match the words itself. Same project only.
 */
const PUBLISHED_TWIN =
  '"_pub": select(_id in path("drafts.**") => *[projectSlug == $projectSlug && _id == string::split(^._id, "drafts.")[1]][0]{ _id, archivedAt })'

/** The sub-query for one declaration. `nTerms` search words are bound as `$t0…`. */
export function buildSubQuery(def: SanitySearchDef, nTerms: number): string {
  const s = def.source
  const ts = tiers(s.fields)
  const words = Array.from({ length: nTerms }, (_, i) => `$t${i}`)
  const anyField = (term: string) => `(${ts.map((t) => tierMatch(t.fields, term)).filter(Boolean).join(' || ')})`
  const filter = [
    `_type == "${s.docType}"`,
    'projectSlug == $projectSlug',
    '!(_id in path("versions.**"))',
    ...(s.drafts === false ? ['!(_id in path("drafts.**"))'] : []),
    ...(s.extraFilter ? [`(${s.extraFilter})`] : []),
    ...words.map(anyField),
  ].join(' && ')
  const scoreArgs = words
    .flatMap((term) => ts.map((t) => ({ expr: tierMatch(t.fields, term, true), weight: t.weight })))
    .filter((a): a is { expr: string; weight: 1 | 2 | 3 } => Boolean(a.expr))
    .map((a) => (a.weight === 1 ? a.expr : `boost(${a.expr}, ${a.weight})`))
  const ranked = scoreArgs.length ? ` | score(${scoreArgs.join(', ')})` : ''
  return `*[${filter}]${ranked} | order(_score desc, _updatedAt desc)[0...${SEARCH_ROW_CAP}]{ _id, archivedAt, _score, ${PUBLISHED_TWIN}, ${s.projection} }`
}

export type SanitySearchQuery = { query: string; params: Record<string, string>; kinds: SearchKind[] }

/** One GROQ object query for all the given Sanity declarations (+ the site's default locale). */
export function buildSearchQuery(defs: SanitySearchDef[], projectSlug: string, terms: string[]): SanitySearchQuery {
  const entries = defs.map((d) => `"${d.kind}": ${buildSubQuery(d, terms.length)}`)
  entries.push(`"${SITE_KEY}": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].defaultLocale`)
  const params: Record<string, string> = { projectSlug }
  terms.forEach((t, i) => (params[`t${i}`] = t))
  return { query: `{ ${entries.join(', ')} }`, params, kinds: defs.map((d) => d.kind) }
}

export type RawSearchRow = Record<string, unknown> & { _id: string; _score?: number; archivedAt?: unknown }

export type MergedRow = {
  id: string
  /** The row whose text is shown (draft over published). */
  row: RawSearchRow
  draft: boolean
  archived: boolean
  score: number
}

const bare = (id: string) => id.replace(/^drafts\./, '')

/**
 * Draft over published by bare id: the draft row's text wins, the archived
 * state comes from the published row (the draft is a copy; the published
 * document is what Archive changes), and a row with no published twin is
 * flagged `draft`. Best score first.
 */
export function mergeRows(rows: readonly RawSearchRow[] | null | undefined, includeArchived: boolean): MergedRow[] {
  const byId = new Map<string, { published?: RawSearchRow; draft?: RawSearchRow }>()
  for (const row of rows ?? []) {
    if (!row || typeof row._id !== 'string') continue
    const id = bare(row._id)
    const slot = byId.get(id) ?? {}
    if (row._id.startsWith('drafts.')) slot.draft = row
    else slot.published = row
    byId.set(id, slot)
  }
  const merged: MergedRow[] = []
  for (const [id, { published, draft }] of byId) {
    const row = draft ?? published!
    // The published twin may be absent from the results (it did not match): read it off the draft row.
    const twin = published ?? (draft?._pub && typeof draft._pub === 'object' ? (draft._pub as RawSearchRow) : undefined)
    const archived = Boolean((twin ?? draft!).archivedAt)
    if (archived && !includeArchived) continue
    merged.push({
      id,
      row,
      draft: !twin,
      archived,
      score: Math.max(typeof draft?._score === 'number' ? draft._score : 0, typeof published?._score === 'number' ? published._score : 0),
    })
  }
  return merged.sort((a, b) => b.score - a.score)
}
