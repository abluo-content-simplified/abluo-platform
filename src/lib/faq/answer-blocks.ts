/**
 * FAQ answers — the restricted rich text of ADR-037 D12.
 *
 * Allowed: paragraphs (style `normal` only), bullet and numbered lists
 * (level 1-4), decorators `strong` / `em`, and the shared body link
 * annotation (external `href` or an `internal` reference). Everything else —
 * headings, quotes, images, embeds, tables, other annotations — is refused by
 * the server (`sanitizeFaqAnswer`) and removed by the editor's mirror
 * (`normalizeFaqAnswer`), so an autosave never fails on a paste.
 *
 * Internal links are ALWAYS stored as WEAK references (D12: "warn, never
 * block"): archiving or deleting the target never fails because of an FAQ
 * answer. Whether a NEW reference points at a document of the same project is
 * checked by the caller (it needs a read): `collectInternalRefs`.
 *
 * Pure, dependency-free apart from the shared helpers in normalize-blocks.ts
 * (safe in client bundles; must NOT import server modules).
 */
import {
  BODY_KEY,
  BODY_LIMITS,
  bodyReference,
  cleanLink,
  isSpan,
  isTextBlock,
  normalizeBlocks,
  preserved,
  type BodyBlock,
  type BodyLink,
} from '@/lib/client/normalize-blocks'

export { collectInternalRefs } from '@/lib/client/normalize-blocks'

/** Blocks per answer. FAQ answers are short (D12 asks for a few sentences). */
export const FAQ_ANSWER_LIMITS = { blocks: 200, spansPerBlock: BODY_LIMITS.spansPerBlock, spanText: BODY_LIMITS.spanText, markDefsPerBlock: BODY_LIMITS.markDefsPerBlock } as const

export const FAQ_ANSWER_STYLES = ['normal'] as const
export const FAQ_ANSWER_LISTS = ['bullet', 'number'] as const
export const FAQ_ANSWER_DECORATORS = ['strong', 'em'] as const

export class FaqAnswerError extends Error {
  readonly code = 'invalid_value' as const
  constructor(message: string) {
    super(message)
    this.name = 'FaqAnswerError'
  }
}

const bad = (message: string): never => {
  throw new FaqAnswerError(message)
}

/** Internal links are weak references; an `href` link is returned as is. */
function weak(link: BodyLink): BodyLink {
  return 'internal' in link ? { ...link, internal: { _type: 'reference', _ref: link.internal._ref, _weak: true } } : link
}

/**
 * Rebuilds an answer (one language) from a strict shape, or throws
 * `FaqAnswerError`. `existing` is what is stored for that language: a link
 * annotation that is an exact copy of a stored one is accepted even when it no
 * longer passes the strict link rules (a stored link never blocks saving).
 * Returns `[]` for "no answer".
 */
export function sanitizeFaqAnswer(value: unknown, existing?: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > FAQ_ANSWER_LIMITS.blocks) return bad('An answer must be a list of paragraphs.')
  const ref = bodyReference(existing)
  const blockKeys = new Set<string>()
  const out = value.map((raw) => {
    const b = raw as Record<string, unknown> | null
    if (!b || typeof b !== 'object' || b._type !== 'block') return bad('An answer holds text only.')
    if (typeof b._key !== 'string' || !BODY_KEY.test(b._key) || blockKeys.has(b._key)) return bad('Unsupported answer block.')
    blockKeys.add(b._key)
    const style = b.style ?? 'normal'
    if (style !== 'normal') return bad('Answers have paragraphs and lists only.')
    const block: Record<string, unknown> = { _type: 'block', _key: b._key, style: 'normal', markDefs: [] }
    if (b.listItem !== undefined) {
      if (typeof b.listItem !== 'string' || !(FAQ_ANSWER_LISTS as readonly string[]).includes(b.listItem)) return bad('Unsupported list.')
      const level = b.level ?? 1
      if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 4) return bad('Unsupported list level.')
      block.listItem = b.listItem
      block.level = level
    }
    if (b.markDefs !== undefined && (!Array.isArray(b.markDefs) || b.markDefs.length > FAQ_ANSWER_LIMITS.markDefsPerBlock)) {
      return bad('Unsupported links.')
    }
    const defs = new Map<string, Record<string, unknown>>()
    for (const d of (b.markDefs as unknown[] | undefined) ?? []) {
      const link = cleanLink(d)
      let def: Record<string, unknown> | null = link ? weak(link) : null
      // A stored link annotation (exact copy, same key) is left alone.
      if (!def && (d as { _type?: unknown } | null)?._type === 'link') def = preserved(d, ref.markDefs)
      if (!def || defs.has(def._key as string)) return bad('Unsupported link.')
      defs.set(def._key as string, def)
    }
    if (!Array.isArray(b.children) || b.children.length === 0 || b.children.length > FAQ_ANSWER_LIMITS.spansPerBlock) {
      return bad('Unsupported answer content.')
    }
    const usedMarks = new Set<string>()
    const childKeys = new Set<string>()
    block.children = b.children.map((rawSpan) => {
      const s = rawSpan as Record<string, unknown> | null
      if (!s || s._type !== 'span' || typeof s._key !== 'string' || !BODY_KEY.test(s._key) || childKeys.has(s._key)) {
        return bad('Unsupported answer text.')
      }
      childKeys.add(s._key)
      if (typeof s.text !== 'string' || s.text.length > FAQ_ANSWER_LIMITS.spanText) return bad('Answer text too long.')
      const marks = s.marks ?? []
      if (!Array.isArray(marks) || !marks.every((m) => typeof m === 'string' && ((FAQ_ANSWER_DECORATORS as readonly string[]).includes(m) || defs.has(m)))) {
        return bad('Unsupported formatting.')
      }
      for (const m of marks as string[]) usedMarks.add(m)
      return { _type: 'span', _key: s._key, text: s.text, marks: [...new Set(marks as string[])] }
    })
    block.markDefs = [...defs.values()].filter((d) => usedMarks.has(d._key as string))
    return block
  })
  // Trailing empty paragraphs are not an answer.
  const isBlank = (b: Record<string, unknown>) => (b.children as Array<{ text: string }>).every((c) => c.text.trim() === '')
  while (out.length && isBlank(out[out.length - 1] as Record<string, unknown>)) out.pop()
  return out
}

/**
 * The editor-side mirror: whatever the editor (or a paste) produced → a value
 * `sanitizeFaqAnswer` accepts. Headings and quotes become paragraphs, anything
 * the answer type cannot hold is dropped (its text is kept), unknown
 * annotations are removed. `[]` means "no answer".
 */
export function normalizeFaqAnswer(value: unknown): BodyBlock[] {
  const out: BodyBlock[] = []
  for (const item of normalizeBlocks(value)) {
    if (!isTextBlock(item)) continue
    const children = item.children.filter(isSpan)
    if (!children.length) continue
    const defs = item.markDefs.map((d) => cleanLink(d)).filter((d): d is BodyLink => !!d).map(weak)
    const keys = new Set(defs.map((d) => d._key))
    const block: BodyBlock = {
      ...item,
      style: 'normal',
      markDefs: defs,
      children: children.map((c) => ({ ...c, marks: c.marks.filter((m) => keys.has(m) || (FAQ_ANSWER_DECORATORS as readonly string[]).includes(m)) })),
    }
    if (block.listItem && !(FAQ_ANSWER_LISTS as readonly string[]).includes(block.listItem)) block.listItem = 'bullet'
    out.push(block)
  }
  return out.slice(0, FAQ_ANSWER_LIMITS.blocks)
}
