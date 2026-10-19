/**
 * FAQ placements — which questions a placement shows (ADR-037 D5, D6).
 *
 * Pure, no React / Next / Sanity imports: used by the FAQ section, the blog
 * post, the JSON-LD collector and tests, so what a visitor sees and what the
 * structured data says can never disagree.
 *
 * Rules:
 *   - A placement that has CHOSEN sets (stored references, public or not)
 *     shows its sets only; its legacy inline questions are read only while
 *     no set is chosen (rollout step 1 — the section's `items`, a post's
 *     imported `faq`).
 *   - Sets arrive already filtered to public ones (FAQ_SET_FIELDS); a missing
 *     or non-public reference arrives as null and is skipped.
 *   - An item shows in a language only when BOTH its question and its answer
 *     exist in that language — the query reads them with no fallback, this
 *     drops the incomplete ones. A set with nothing left is skipped; a
 *     placement with nothing left renders nothing, heading included.
 */
import type { FaqLegacyItem, FaqSetData, PortableTextBlock } from '@/lib/sanity/types'

export type FaqAnswer =
  | { kind: 'rich'; blocks: PortableTextBlock[] }
  /** Legacy plain-text answers (faqItem.answer is localizedText). */
  | { kind: 'plain'; text: string }

export interface FaqViewItem {
  key: string
  question: string
  answer: FaqAnswer
}

export interface FaqGroup {
  /** The set's id, or 'legacy' for inline questions. */
  id: string
  /** The set's public title in this language, if any. */
  title: string | null
  /** The project the set belongs to (internal links resolve within it). */
  projectSlug: string | null
  items: FaqViewItem[]
}

export interface FaqPlacementSource {
  faqSets?: (FaqSetData | null)[] | null
  /** Stored references, public or not. Absent → the number of sets received. */
  faqSetCount?: number | null
  legacyItems?: (FaqLegacyItem | { _key: string; question?: string | null; answer?: string | null } | null)[] | null
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** The plain text of a Portable Text answer (span texts, in order). */
export function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => {
      const children = (b as { children?: unknown })?.children
      return Array.isArray(children) ? children.map((c) => (typeof (c as { text?: unknown })?.text === 'string' ? (c as { text: string }).text : '')).join('') : ''
    })
    .join('\n')
}

/** The items of one set that are complete in this language. */
export function visibleSetItems(set: FaqSetData | null | undefined): FaqViewItem[] {
  if (!set || !Array.isArray(set.items)) return []
  const out: FaqViewItem[] = []
  for (const item of set.items) {
    if (!item || !isText(item.question) || !Array.isArray(item.answer) || !blocksText(item.answer).trim()) continue
    out.push({ key: item._key, question: item.question.trim(), answer: { kind: 'rich', blocks: item.answer } })
  }
  return out
}

/** True when the placement has chosen sets — then legacy questions are never read. */
export function usesFaqSets(src: FaqPlacementSource): boolean {
  const stored = typeof src.faqSetCount === 'number' ? src.faqSetCount : (src.faqSets?.length ?? 0)
  return stored > 0
}

/** The groups a placement renders, in order. Empty → render nothing. */
export function placementFaqGroups(src: FaqPlacementSource): FaqGroup[] {
  if (usesFaqSets(src)) {
    const groups: FaqGroup[] = []
    const seen = new Set<string>()
    for (const set of src.faqSets ?? []) {
      if (!set || seen.has(set._id)) continue
      seen.add(set._id)
      const items = visibleSetItems(set)
      if (items.length) groups.push({ id: set._id, title: isText(set.title) ? set.title.trim() : null, projectSlug: set.projectSlug ?? null, items })
    }
    return groups
  }
  const items: FaqViewItem[] = []
  for (const item of src.legacyItems ?? []) {
    if (!item || !isText(item.question) || !isText(item.answer)) continue
    items.push({ key: item._key, question: item.question, answer: { kind: 'plain', text: item.answer } })
  }
  return items.length ? [{ id: 'legacy', title: null, projectSlug: null, items }] : []
}

/**
 * Normalised question text, for de-duplication (D7) and the dashboard's
 * overlap warning (D6): Unicode-normalised, case-folded, whitespace collapsed,
 * leading ¿¡ and trailing ?!. dropped.
 */
export function normaliseQuestion(question: string): string {
  return question
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[¿¡]+\s*/, '')
    .replace(/[\s?？!！.。]+$/, '')
}
