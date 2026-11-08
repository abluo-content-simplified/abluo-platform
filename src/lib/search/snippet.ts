/**
 * Dashboard search (ADR-047) — snippets: where a result matched when the title
 * does not show it.
 *
 * Pure text work, no I/O. Matching mirrors the GROQ side: case- and
 * accent-insensitive (NFD fold), a word matches as a PREFIX of a word of the
 * text (contact requests use substring matching, like their filter).
 */
import { LOCALE_CODES } from '@/lib/i18n/locales'
import type { SanitySearchDef } from './sanity-search'
import type { SearchParams } from './sanity-search'
import type { SearchHit } from './types'

export type Snippet = NonNullable<SearchHit['snippet']>

/** Target length of the shown window, in characters. */
export const SNIPPET_WINDOW = 120

/** Lowercase + strip combining marks, keeping a map from folded index → original index. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  let i = 0
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
    i += ch.length
  }
  return { folded, map }
}

export const foldText = (s: string) => foldWithMap(s).folded

/** Patterns (`perche*` or `perche`) → folded, wildcard-free needles, longest first. */
export function needlesOf(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((p) => foldText(p.replace(/\*+$/, '')).trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** First match of any needle in `text`: [start, end) in ORIGINAL text indices, or null. */
export function findMatch(text: string, needles: readonly string[], substring = false): [number, number] | null {
  const { folded, map } = foldWithMap(text)
  let best: [number, number] | null = null
  for (const n of needles) {
    let from = 0
    while (from <= folded.length - n.length) {
      const at = folded.indexOf(n, from)
      if (at < 0) break
      if (substring || !isWordChar(folded[at - 1])) {
        if (!best || at < best[0]) {
          const lastFolded = at + n.length - 1
          const origEnd = map[lastFolded] + (String.fromCodePoint(text.codePointAt(map[lastFolded]) ?? 0).length || 1)
          best = [map[at], origEnd]
        }
        break
      }
      from = at + 1
    }
  }
  return best
}

/** Does `text` contain any needle (word-prefix match)? */
export const textHasNeedle = (text: string, needles: readonly string[], substring = false) => findMatch(text, needles, substring) !== null

/**
 * A ~120-char window around the first match, cut on word boundaries, "…" on
 * the cut sides, whitespace collapsed. `match` is the exact original substring.
 */
export function cutSnippet(raw: string, needles: readonly string[], substring = false): Snippet | undefined {
  const text = raw.replace(/\s+/g, ' ').trim()
  const m = findMatch(text, needles, substring)
  if (!m) return undefined
  const [ms, me] = m
  const room = Math.max(0, SNIPPET_WINDOW - (me - ms))
  let start = Math.max(0, ms - Math.floor(room / 2))
  let end = Math.min(text.length, me + (room - (ms - start)))
  start = Math.max(0, Math.min(start, end - SNIPPET_WINDOW))
  // Never cut a word: pull the edges in to the nearest space, but not into the match.
  if (start > 0 && text[start - 1] !== ' ') {
    const sp = text.indexOf(' ', start)
    start = sp >= 0 && sp < ms ? sp + 1 : ms
  }
  if (end < text.length && text[end] !== ' ') {
    const sp = text.lastIndexOf(' ', end)
    end = sp > me ? sp : me
  }
  const before = text.slice(start, ms).replace(/^\s+/, '')
  const after = text.slice(me, end).replace(/\s+$/, '')
  return {
    before: (start > 0 ? '…' : '') + before,
    match: text.slice(ms, me),
    after: after + (end < text.length ? '…' : ''),
  }
}

/** First text (in the given order) that contains a match, cut into a snippet. */
export function firstSnippet(texts: readonly string[], needles: readonly string[], substring = false): Snippet | undefined {
  for (const t of texts) {
    if (!t) continue
    const s = cutSnippet(t, needles, substring)
    if (s) return s
  }
  return undefined
}

// ── The second Sanity request: snippet source text for the SHOWN hits only ────

type SnippetFieldSpec = { key: string; localized: boolean }

const snippetFields = (def: SanitySearchDef) => {
  const out: { field: SanitySearchDef['source']['fields'][number]; spec: SnippetFieldSpec }[] = []
  // Weight order: short text (2), body (1), then title-weight fields (another language's title) last.
  for (const w of [2, 1, 3] as const) {
    for (const f of def.source.fields) {
      if (f.weight !== w) continue
      if (f.kind === 'stringArray' || f.kind === 'termKeys' || f.kind === 'termKey') continue
      out.push({ field: f, spec: { key: `s${out.length}`, localized: f.kind !== 'string' } })
    }
  }
  return out
}

function fieldProjection(f: SanitySearchDef['source']['fields'][number], key: string): string {
  const wrap = (e: string) => (f.when ? `select(${f.when} => ${e})` : e)
  if (f.kind === 'string') return `"${key}": ${wrap(f.name)}`
  const pt = f.kind === 'localizedPortableText'
  const parts = LOCALE_CODES.map((c) => `"${c}": ${wrap(pt ? `pt::text(${f.name}.${c})` : `${f.name}.${c}`)}`)
  return `"${key}": { ${parts.join(', ')} }`
}

/** Param name carrying the ids to fetch for a kind. */
const idsParam = (kind: string) => `ids_${kind}`

/**
 * ONE request projecting the snippet-source text of the declared fields for
 * just the shown ids. Scoped to the project; ids are a bound array param.
 * null when there is nothing to fetch.
 */
export function buildSnippetQuery(
  wanted: { def: SanitySearchDef; ids: string[] }[],
  projectSlug: string
): { query: string; params: SearchParams } | null {
  const entries: string[] = []
  const params: SearchParams = { projectSlug }
  for (const { def, ids } of wanted) {
    if (!ids.length) continue
    const proj = snippetFields(def).map(({ field, spec }) => fieldProjection(field, spec.key))
    if (!proj.length) continue
    params[idsParam(def.kind)] = ids
    entries.push(`"${def.kind}": *[_id in $${idsParam(def.kind)} && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, ${proj.join(', ')} }`)
  }
  return entries.length ? { query: `{ ${entries.join(', ')} }`, params } : null
}

/** Ordered candidate texts of one fetched row: field by field; viewer locale → site default → the others. */
export function rowTexts(def: SanitySearchDef, row: Record<string, unknown>, locale: string, siteDefault: string): string[] {
  const order = [...new Set([locale, siteDefault, ...LOCALE_CODES])]
  const out: string[] = []
  for (const { spec } of snippetFields(def)) {
    const v = row[spec.key]
    if (typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object') for (const l of order) if (typeof (v as Record<string, unknown>)[l] === 'string') out.push((v as Record<string, string>)[l])
  }
  return out
}
