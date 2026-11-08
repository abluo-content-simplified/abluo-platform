/**
 * Pure matching helpers of the search palette (ADR-047, batch A). No React, no
 * DOM, no language: callers pass already-translated text.
 *
 *   • fold          accent- and case-insensitive form (NFD).
 *   • parsePrefix   "/" → Go To mode, "+" → Create mode (only at the very start).
 *   • matchCandidate  word-prefix match on a label and its synonyms, with light
 *                   typo tolerance (Damerau-Levenshtein ≤ 1 for words ≥ 4
 *                   letters, ≤ 2 for ≥ 8) → a score and a "strong" flag.
 *   • pickTopHit    the one strong navigation match that may lead the results.
 *   • highlightSegments  splits a title into plain / matched runs.
 *   • relativeShort "2d", "1w", "3mo" in the viewer's language.
 */

const MARKS = /[̀-ͯ]/g

/** Case- and accent-insensitive form for matching. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').toLowerCase().trim()
}

/** Folded words (letters and digits only). */
export function words(s: string): string[] {
  return fold(s).match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Optimal-string-alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function damerau(a: string, b: string): number {
  if (a === b) return 0
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => [i, ...new Array<number>(m).fill(0)])
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[n][m]
}

/** How many typos a query word may have: none under 4 letters, 1 from 4, 2 from 8. */
export function typoBudget(len: number): number {
  return len >= 8 ? 2 : len >= 4 ? 1 : 0
}

// ── Prefix modes ─────────────────────────────────────────────────────────────

export type SearchMode = 'all' | 'goto' | 'create'

/** "/" or "+" at the very start of the text selects a mode; `text` is what follows. A "/" or "+" elsewhere is ordinary text. */
export function parsePrefix(raw: string): { mode: SearchMode; token: '' | '/' | '+'; text: string } {
  if (raw.startsWith('/')) return { mode: 'goto', token: '/', text: raw.slice(1).trim() }
  if (raw.startsWith('+')) return { mode: 'create', token: '+', text: raw.slice(1).trim() }
  return { mode: 'all', token: '', text: raw.trim() }
}

/** The query with its prefix replaced by `token` (used by the footer chips). */
export function withPrefix(raw: string, token: '/' | '+'): string {
  return token + parsePrefix(raw).text
}

// ── Matching ─────────────────────────────────────────────────────────────────

export type Candidate = {
  /** The visible label. */
  label: string
  /** Synonyms and keywords (each may be several words). */
  synonyms?: readonly string[]
}

export type Match = {
  /** Higher is better. */
  score: number
  /** The whole query is the start of (or equals) the label or a synonym → may be a Top Hit. */
  strong: boolean
}

// Tiers of one query word against one candidate word.
const T_LABEL_EXACT = 60
const T_LABEL_PREFIX = 50
const T_SYN_EXACT = 40
const T_SYN_PREFIX = 30
const T_LABEL_TYPO = 20
const T_SYN_TYPO = 10

function wordTier(q: string, candidateWords: string[], exact: number, prefix: number, typo: number): number {
  let best = 0
  const budget = typoBudget(q.length)
  for (const w of candidateWords) {
    if (w === q) return exact
    if (w.startsWith(q)) best = Math.max(best, prefix)
    else if (budget > 0 && best < typo && (damerau(q, w) <= budget || (w.length > q.length && damerau(q, w.slice(0, q.length)) <= budget))) best = typo
  }
  return best
}

/** Does `query` match the candidate? null = no. An empty query matches everything (score 1, not strong). */
export function matchCandidate(query: string, c: Candidate): Match | null {
  const q = fold(query)
  const qWords = words(query)
  if (qWords.length === 0) return { score: 1, strong: false }
  const labelWords = words(c.label)
  const synWords = (c.synonyms ?? []).flatMap(words)
  let total = 0
  for (const qw of qWords) {
    const t = Math.max(wordTier(qw, labelWords, T_LABEL_EXACT, T_LABEL_PREFIX, T_LABEL_TYPO), wordTier(qw, synWords, T_SYN_EXACT, T_SYN_PREFIX, T_SYN_TYPO))
    if (t === 0) return null
    total += t
  }
  let score = total / qWords.length
  const label = fold(c.label)
  const phrases = (c.synonyms ?? []).map(fold)
  let strong = false
  if (label === q) {
    strong = true
    score += 100
  } else if (label.startsWith(q)) {
    strong = true
    score += 80
  } else if (phrases.some((p) => p === q)) {
    strong = true
    score += 70
  } else if (phrases.some((p) => p.startsWith(q))) {
    strong = true
    score += 60
  }
  return { score, strong }
}

/** Matching items, best first; equal scores keep their input order (stable). */
export function rankMatches<T>(items: readonly T[], query: string, candidate: (item: T) => Candidate): { item: T; match: Match }[] {
  const out: { item: T; match: Match; i: number }[] = []
  items.forEach((item, i) => {
    const match = matchCandidate(query, candidate(item))
    if (match) out.push({ item, match, i })
  })
  return out.sort((a, b) => b.match.score - a.match.score || a.i - b.i).map(({ item, match }) => ({ item, match }))
}

/** Fewer than this many characters never produce a Top Hit ("m" would crown whatever starts with m). */
export const TOP_HIT_MIN_CHARS = 2

/**
 * The Top Hit rule. `ranked` is the Go To / Create / sub-destination matches in
 * one list (Go To first, so it wins ties). The first strong match (label or
 * synonym starts with the query, or equals it) is the Top Hit; everything else
 * stays in its own group. No strong match → undefined.
 */
export function pickTopHit<T>(ranked: readonly { item: T; match: Match }[], query: string): T | undefined {
  if (fold(query).length < TOP_HIT_MIN_CHARS) return undefined
  return ranked.find((r) => r.match.strong)?.item
}

// ── Highlighting ─────────────────────────────────────────────────────────────

export type Segment = { text: string; match: boolean }

/** `s` folded character by character, with the index in `s` each folded code unit came from. */
function foldWithMap(s: string): { folded: string; from: number[] } {
  let folded = ''
  const from: number[] = []
  let i = 0
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(MARKS, '').toLowerCase()
    for (let k = 0; k < f.length; k++) from.push(i)
    folded += f
    i += ch.length
  }
  return { folded, from }
}

/**
 * Splits `text` into runs, marking the start of every word that a query word
 * is a prefix of ("sett" in "Settings"), accent- and case-insensitively.
 */
export function highlightSegments(text: string, terms: readonly string[]): Segment[] {
  const qs = terms.map(fold).filter(Boolean)
  if (qs.length === 0 || !text) return [{ text, match: false }]
  const { folded, from } = foldWithMap(text)
  const marks: [number, number][] = []
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    const start = m.index ?? 0
    let len = 0
    for (const q of qs) if (m[0].startsWith(q)) len = Math.max(len, q.length)
    if (len > 0) {
      const a = from[start]
      const lastFolded = start + len - 1
      const b = from[lastFolded] + (String.fromCodePoint(text.codePointAt(from[lastFolded]) ?? 32).length)
      marks.push([a, b])
    }
  }
  if (marks.length === 0) return [{ text, match: false }]
  const out: Segment[] = []
  let at = 0
  for (const [a, b] of marks) {
    if (a > at) out.push({ text: text.slice(at, a), match: false })
    out.push({ text: text.slice(a, b), match: true })
    at = b
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false })
  return out
}

// ── Relative dates ───────────────────────────────────────────────────────────

const UNITS: { unit: Intl.NumberFormatOptions['unit']; seconds: number }[] = [
  { unit: 'year', seconds: 365 * 86400 },
  { unit: 'month', seconds: 30 * 86400 },
  { unit: 'week', seconds: 7 * 86400 },
  { unit: 'day', seconds: 86400 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
]

/**
 * A compact age in the viewer's language: "2d", "1w", "3mo" (en). Under a
 * minute (and any future date) reads as "now". Empty when the date is invalid.
 */
export function relativeShort(iso: string, locale: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, Math.floor((now - t) / 1000))
  const hit = UNITS.find((u) => diff >= u.seconds)
  if (!hit) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' }).format(0, 'second')
  const n = Math.floor(diff / hit.seconds)
  const narrow = new Intl.NumberFormat(locale, { style: 'unit', unit: hit.unit, unitDisplay: 'narrow' }).format(n)
  if (hit.unit !== 'month') return narrow
  // English narrow months read "3m", the same as minutes: take the relative form's own short unit ("3mo").
  const minutes = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }).format(n)
  if (narrow !== minutes) return narrow
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' }).format(-n, 'month').match(/\d+\s?\p{L}+\.?/u)?.[0] ?? narrow
}

/** The full date and time (24 h), for a tooltip. */
export function fullDateTime(iso: string, locale: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(t)
}
