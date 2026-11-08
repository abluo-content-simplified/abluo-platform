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
import { PROJECT_KEY, segmentKey } from './site-url'

export type SanitySearchDef = ModuleSearchDef & { source: SanitySearchSource }

export const isSanitySearchDef = (d: ModuleSearchDef): d is SanitySearchDef => d.source.type === 'sanity'

/** Rows fetched per type before draft/published merging (≈ 20 documents, two rows each at worst). */
export const SEARCH_ROW_CAP = 40
export const SEARCH_MAX_WORDS = 4
/** Key under which the site's default content locale travels in the same response. */
export const SITE_KEY = '_site'

/** Max alternative patterns per search word (typed, accent-folded, stem). */
export const SEARCH_MAX_ALTERNATIVES = 3

const VOWELS = /[aeiouàáâäèéêëìíîïòóôöùúûü]$/u
const foldAccents = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '')

/** The lowercase words of the query (wildcards and quotes stripped, capped). */
export function searchWords(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[*"\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SEARCH_MAX_WORDS)
}

/**
 * One word → its alternative prefix patterns, OR-ed in the query (GROQ `match`
 * is case-insensitive but accent-SENSITIVE and stored text cannot be folded,
 * so the folding happens on the query side):
 *  1. the word as typed (`perché*`);
 *  2. the accent-folded form, when the user typed accents (`perche*`);
 *  3. the folded word without its final vowel (`perch*`), which finds the
 *     final accents of Italian/French (perché, caffè, città) when typed
 *     without them. Only for purely alphabetic words of ≥ 3 letters whose stem
 *     keeps ≥ 3 letters, so `ca*` can never appear.
 */
export function wordAlternatives(word: string): string[] {
  const folded = foldAccents(word)
  const out = [word]
  if (folded !== word) out.push(folded)
  if (/^\p{L}+$/u.test(folded) && folded.length >= 3 && VOWELS.test(folded) && folded.length - 1 >= 3) out.push(folded.slice(0, -1))
  return [...new Set(out)].slice(0, SEARCH_MAX_ALTERNATIVES).map((w) => `${w}*`)
}

/** Query → per word, its alternative patterns (`[['perche*', 'perch*'], …]`). */
export function searchTermGroups(q: string): string[][] {
  return searchWords(q).map(wordAlternatives)
}

/** Splits the query into the as-typed prefix pattern per word (the first alternative of each). */
export function searchTerms(q: string): string[] {
  return searchWords(q).map((w) => `${w}*`)
}

/** Bound parameter name of word `i`, alternative `j` (`t0`, `t0b`, `t0c`). */
export const termParam = (i: number, j: number) => `t${i}${'abcdefgh'[j - 1] ?? ''}`

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
    case 'termKeys':
    case 'termKey':
      return []
  }
}

const isTermField = (f: SearchField) => f.kind === 'termKeys' || f.kind === 'termKey'

/**
 * score() accepts only plain attribute paths (and pt::text of one) on the left
 * of `match`: no `select()`, no `->` dereference, no `[]` traversal — Sanity
 * rejects the whole query with "score() function received unexpected
 * expression" (live failure on dev, 2026-11-08). Those fields still FILTER;
 * they just don't add to the ranking. Term-label sub-queries are filter-only too.
 */
export const scoreable = (f: SearchField): boolean => !f.when && !f.name.includes('->') && !isTermField(f)

/**
 * The label sub-query for a term field: the document matches when any of its
 * term keys is the key of a (live, same-project) `taxonomyTerm` whose label in
 * ANY language matches one of the word's alternatives. `module`/`kind` come
 * from the static declaration; the words are bound params.
 */
function termLabelMatch(f: SearchField, terms: string[]): string {
  const t = f.terms
  if (!t || !/^[a-z][a-z0-9-]*$/.test(t.module) || (t.kind !== 'category' && t.kind !== 'tag')) {
    throw new Error(`search field "${f.name}": invalid terms declaration`)
  }
  const labels = `[${LOCALE_CODES.map((c) => `label.${c}`).join(', ')}]`
  const keyIn = f.kind === 'termKey' ? `key == ^.${f.name}` : `key in ^.${f.name}`
  const labelMatch = terms.map((term) => `${labels} match ${term}`).join(' || ')
  return `count(*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "${t.module}" && kind == "${t.kind}" && !(_id in path("drafts.**")) && ${keyIn} && (${labelMatch})]) > 0`
}

/** `match` expression for the fields of one weight tier against one word's alternative params (OR-ed). */
function tierMatch(fields: SearchField[], terms: string[], forScore = false): string | null {
  const used = forScore ? fields.filter(scoreable) : fields
  const scalars = used.flatMap(scalarExprs)
  const parts: string[] = []
  if (scalars.length) for (const term of terms) parts.push(`[${scalars.join(', ')}] match ${term}`)
  for (const f of used) {
    if (f.kind === 'stringArray') for (const term of terms) parts.push(forScore ? `${f.name} match ${term}` : `${f.name}[] match ${term}`)
    else if (isTermField(f)) parts.push(termLabelMatch(f, terms))
  }
  return parts.length ? `(${parts.join(' || ')})` : null
}

const tiers = (fields: SearchField[]) =>
  ([3, 2, 1] as const).map((w) => ({ weight: w, fields: fields.filter((f) => f.weight === w) })).filter((t) => t.fields.length)

/**
 * For a draft row, its published twin's state — so a draft whose text matched is
 * not mislabelled "draft only" (or un-archived) when the published document did
 * not match the words itself. Same project only.
 */
const publishedTwin = (site: string) =>
  `"_pub": select(_id in path("drafts.**") => *[projectSlug == $projectSlug && _id == string::split(^._id, "drafts.")[1]][0]{ _id, archivedAt${site} })`

/**
 * The public-page facts of a declaration, read off the PUBLISHED document only:
 * `_live` (is it on the website right now) and `_slugs`. A published row carries
 * them at its root, a draft row on its `_pub` twin. Empty for types without a public page.
 */
const siteProjection = (def: SanitySearchDef) => {
  const site = def.source.site
  return site ? `, "_live": (${site.visible}), "_slugs": ${site.slugField ?? 'slug'}` : ''
}

/**
 * The sub-query for one declaration. Each search word is bound as `$t0…` with
 * optional alternatives `$t0b`, `$t0c` (see wordAlternatives). `alts` is the
 * number of alternatives per word (a plain number = that many words with one each).
 */
export function buildSubQuery(def: SanitySearchDef, alts: number | number[]): string {
  const s = def.source
  const ts = tiers(s.fields)
  const counts = typeof alts === 'number' ? Array.from({ length: alts }, () => 1) : alts
  const words = counts.map((n, i) => Array.from({ length: n }, (_, j) => `$${termParam(i, j)}`))
  // A word matches when ANY of its alternatives matches in ANY field; all words must match.
  const anyField = (terms: string[]) => `(${ts.map((t) => tierMatch(t.fields, terms)).filter(Boolean).join(' || ')})`
  const filter = [
    `_type == "${s.docType}"`,
    'projectSlug == $projectSlug',
    '!(_id in path("versions.**"))',
    ...(s.drafts === false ? ['!(_id in path("drafts.**"))'] : []),
    ...(s.extraFilter ? [`(${s.extraFilter})`] : []),
    ...words.map(anyField),
  ].join(' && ')
  const scoreArgs = words
    .flatMap((terms) => ts.map((t) => ({ expr: tierMatch(t.fields, terms, true), weight: t.weight })))
    .filter((a): a is { expr: string; weight: 1 | 2 | 3 } => Boolean(a.expr))
    .map((a) => (a.weight === 1 ? a.expr : `boost(${a.expr}, ${a.weight})`))
  const ranked = scoreArgs.length ? ` | score(${scoreArgs.join(', ')})` : ''
  return `*[${filter}]${ranked} | order(_score desc, _updatedAt desc)[0...${SEARCH_ROW_CAP}]{ _id, _updatedAt, archivedAt, _score${siteProjection(def)}, ${publishedTwin(siteProjection(def))}, ${s.projection} }`
}

export type SearchParams = Record<string, string | string[]>
export type SanitySearchQuery = { query: string; params: SearchParams; kinds: SearchKind[] }

/**
 * The project facts the public URLs need, in the same request: its domain, the
 * website's languages, and each declaration's path segment from the module
 * installation config. Identifiers come from static declarations (validated).
 */
function projectFacts(defs: SanitySearchDef[]): string {
  const segs = defs.flatMap((d) => {
    const seg = d.source.site?.segment
    if (!seg || 'fixed' in seg) return []
    if (![seg.moduleId, seg.configKey, d.kind].every((x) => /^[A-Za-z][A-Za-z0-9-]*$/.test(x))) throw new Error(`search site route of "${d.kind}": invalid segment declaration`)
    return [`"${segmentKey(d.kind)}": moduleInstallations[moduleId == "${seg.moduleId}" && enabled != false][0].config.${seg.configKey}`]
  })
  return `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ customDomain, "locales": coalesce(siteConfig->supportedLocales, *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].supportedLocales)${segs.length ? ', ' + segs.join(', ') : ''} }`
}

/** One GROQ object query for all the given Sanity declarations (+ the site's default locale). */
export function buildSearchQuery(defs: SanitySearchDef[], projectSlug: string, terms: (string | string[])[]): SanitySearchQuery {
  const groups = terms.map((t) => (Array.isArray(t) ? t : [t]).slice(0, SEARCH_MAX_ALTERNATIVES))
  const entries = defs.map((d) => `"${d.kind}": ${buildSubQuery(d, groups.map((g) => g.length))}`)
  entries.push(`"${SITE_KEY}": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].defaultLocale`)
  entries.push(`"${PROJECT_KEY}": ${projectFacts(defs)}`)
  const params: Record<string, string> = { projectSlug }
  groups.forEach((g, i) => g.forEach((t, j) => (params[termParam(i, j)] = t)))
  return { query: `{ ${entries.join(', ')} }`, params, kinds: defs.map((d) => d.kind) }
}

export type RawSearchRow = Record<string, unknown> & { _id: string; _score?: number; archivedAt?: unknown; _updatedAt?: unknown }

export type MergedRow = {
  id: string
  /** The row whose text is shown (draft over published). */
  row: RawSearchRow
  draft: boolean
  archived: boolean
  score: number
  /** `_updatedAt` of the row shown (the draft when the draft is shown). */
  updatedAt?: string
  /** Public-page facts of the PUBLISHED document (undefined when there is none). */
  site?: { live: boolean; slugs: unknown }
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
      updatedAt: typeof row._updatedAt === 'string' ? row._updatedAt : undefined,
      site: twin ? { live: twin._live === true, slugs: twin._slugs } : undefined,
      score: Math.max(typeof draft?._score === 'number' ? draft._score : 0, typeof published?._score === 'number' ? published._score : 0),
    })
  }
  return merged.sort((a, b) => b.score - a.score)
}
