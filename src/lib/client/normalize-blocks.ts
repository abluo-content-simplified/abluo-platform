/**
 * Body normalisation for the Create flow ("Tell your story", ADR-025).
 *
 * The editor — and especially text pasted from Word, Google Docs or a web
 * page — can emit more than the server accepts. `normalizeBlocks` maps any
 * Portable Text-ish value onto exactly the shape `sanitizeBlocks`
 * (src/lib/api/post-drafts.ts) allows, so autosave never fails on a paste:
 *
 *   - styles: normal / h2 / h3 / blockquote (h1 → h2, h4–h6 → h3, rest → normal)
 *   - lists: bullet / number, level 1–4 (unknown list types → bullet)
 *   - marks: strong / em only (b/bold → strong, i/italic → em); links and
 *     other annotations are dropped but their text is kept; markDefs emptied
 *   - non-text blocks and inline objects dropped
 *   - keys kept when valid, generated otherwise, made unique
 *   - empty trailing paragraphs trimmed; size limits respected
 *
 * Pure and dependency-free (safe in client bundles — it must NOT import
 * post-drafts, which pulls in the Sanity write client).
 */
import type { PortableTextBlock } from '@portabletext/editor'

/** Mirrors LIMITS in post-drafts.ts (kept in sync by normalize-blocks.test.ts). */
export const BODY_LIMITS = { blocks: 2000, spansPerBlock: 500, spanText: 20_000 } as const

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const STYLE_MAP: Record<string, string> = {
  normal: 'normal',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  blockquote: 'blockquote',
}
const MARK_MAP: Record<string, 'strong' | 'em'> = {
  strong: 'strong',
  b: 'strong',
  bold: 'strong',
  em: 'em',
  i: 'em',
  italic: 'em',
}

export type BodySpan = { _type: 'span'; _key: string; text: string; marks: ('strong' | 'em')[] }
export type BodyBlock = {
  _type: 'block'
  _key: string
  style: 'normal' | 'h2' | 'h3' | 'blockquote'
  markDefs: []
  listItem?: 'bullet' | 'number'
  level?: number
  children: BodySpan[]
}

export function newKey(): string {
  let k = ''
  for (let i = 0; i < 12; i++) k += Math.floor(Math.random() * 16).toString(16)
  return k
}

function uniqueKey(raw: unknown, used: Set<string>): string {
  let key = typeof raw === 'string' && KEY.test(raw) && !used.has(raw) ? raw : newKey()
  while (used.has(key)) key = newKey()
  used.add(key)
  return key
}

type Run = { key?: unknown; text: string; marks: ('strong' | 'em')[] }

function normalizeSpans(children: unknown): BodySpan[] {
  if (!Array.isArray(children)) return []
  const runs: Run[] = []
  for (const raw of children) {
    const s = raw as Record<string, unknown> | null
    if (!s || s._type !== 'span') continue
    const text = typeof s.text === 'string' ? s.text : ''
    const marks = Array.isArray(s.marks)
      ? [...new Set(s.marks.map((m) => MARK_MAP[String(m)]).filter(Boolean))].sort()
      : []
    const prev = runs[runs.length - 1]
    // Merge neighbours with identical formatting (dropped links leave these).
    if (prev && prev.marks.join() === marks.join()) prev.text += text
    else runs.push({ key: s._key, text, marks })
  }
  // Respect the server's limits: split over-long text, cap the span count.
  const pieces: Run[] = []
  for (const r of runs) {
    if (r.text.length <= BODY_LIMITS.spanText) pieces.push(r)
    else
      for (let i = 0; i < r.text.length; i += BODY_LIMITS.spanText) {
        pieces.push({ key: i === 0 ? r.key : undefined, text: r.text.slice(i, i + BODY_LIMITS.spanText), marks: r.marks })
      }
  }
  const used = new Set<string>()
  return pieces
    .slice(0, BODY_LIMITS.spansPerBlock)
    .map((r) => ({ _type: 'span', _key: uniqueKey(r.key, used), text: r.text, marks: r.marks }))
}

function isEmpty(b: BodyBlock): boolean {
  return b.children.every((s) => s.text.trim() === '')
}

/**
 * Maps whatever the editor (or a paste) produced onto the server's body shape.
 * Always returns a value `sanitizeBlocks` accepts; `[]` means "no body".
 */
export function normalizeBlocks(value: unknown): BodyBlock[] {
  if (!Array.isArray(value)) return []
  const usedBlockKeys = new Set<string>()
  const out: BodyBlock[] = []
  for (const raw of value) {
    const b = raw as Record<string, unknown> | null
    if (!b || b._type !== 'block') continue
    const style = (STYLE_MAP[typeof b.style === 'string' ? b.style : 'normal'] ?? 'normal') as BodyBlock['style']
    const spans = normalizeSpans(b.children)
    const children: BodySpan[] = spans.length ? spans : [{ _type: 'span', _key: newKey(), text: '', marks: [] }]
    const block: BodyBlock = { _type: 'block', _key: uniqueKey(b._key, usedBlockKeys), style, markDefs: [], children }
    if (typeof b.listItem === 'string' && b.listItem) {
      block.listItem = b.listItem === 'number' ? 'number' : 'bullet'
      const level = typeof b.level === 'number' && Number.isFinite(b.level) ? Math.round(b.level) : 1
      block.level = Math.min(4, Math.max(1, level))
    }
    out.push(block)
  }
  while (out.length && isEmpty(out[out.length - 1])) out.pop()
  return out.slice(0, BODY_LIMITS.blocks)
}

/** Plain text of a body, one block per line (for word counts and AI prompts). */
export function blocksToPlainText(value: unknown): string {
  return normalizeBlocks(value)
    .map((b) => b.children.map((s) => s.text).join(''))
    .join('\n')
}

export function countWords(value: unknown): number {
  const text = blocksToPlainText(value).trim()
  return text ? text.split(/\s+/u).length : 0
}

/** Minutes to read at ~200 words a minute; at least 1 once there is any text. */
export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / 200)) : 0
}

/**
 * Plain text (e.g. from the clipboard) → body blocks. One paragraph per line;
 * blank lines are separators; "- ", "* ", "• " start bullets and "1. " / "1) "
 * start numbered items.
 */
export function textToBlocks(text: string): BodyBlock[] {
  const blocks: unknown[] = []
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const bullet = line.match(/^[-*•–]\s+(.*)$/u)
    const number = line.match(/^\d{1,3}[.)]\s+(.*)$/u)
    const body = bullet?.[1] ?? number?.[1] ?? line
    blocks.push({
      _type: 'block',
      style: 'normal',
      ...(bullet ? { listItem: 'bullet', level: 1 } : number ? { listItem: 'number', level: 1 } : {}),
      children: [{ _type: 'span', text: body, marks: [] }],
    })
  }
  return normalizeBlocks(blocks)
}

/** Narrow helper for callers holding the editor's own type. */
export function asEditorValue(blocks: BodyBlock[]): PortableTextBlock[] {
  return blocks as unknown as PortableTextBlock[]
}
