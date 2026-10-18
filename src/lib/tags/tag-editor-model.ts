/**
 * What the tag box shows and stores, as pure functions (the component only
 * renders). Shared by photos, the batch sheet and galleries.
 */
import {
  countsFromNames,
  INTERNAL_TAG_LIMITS,
  resolveTagSpelling,
  suggestTags,
  tagMatchKey,
  topTags,
  type TagCount,
} from './internal-tags'

export const TOP_TAG_CHIPS = 8
export const TYPED_SUGGESTIONS = 6

/** The usage list: real counts when the caller has them, else the old names-only `suggestions` (in order). */
export function editorCounts(counts: readonly TagCount[] | undefined, suggestions: readonly string[] | undefined): readonly TagCount[] {
  return counts && counts.length ? counts : countsFromNames(suggestions ?? [])
}

/**
 * Adds typed or tapped texts to the chosen tags. A text that matches a tag in
 * use (or already chosen) ignoring case/accents keeps THAT spelling, so no
 * near-duplicates appear; nothing is added beyond `max`. Returns the same
 * array when nothing changed.
 */
export function addTags(
  chosen: readonly string[],
  raws: readonly string[],
  known: readonly TagCount[],
  max: number = INTERNAL_TAG_LIMITS.perItem
): string[] {
  const names = [...chosen, ...known.map((k) => k.tag)]
  const keys = new Set(chosen.map(tagMatchKey))
  const next = [...chosen]
  for (const raw of raws) {
    if (next.length >= max) break
    const tag = resolveTagSpelling(raw, names)
    if (!tag || keys.has(tagMatchKey(tag))) continue
    keys.add(tagMatchKey(tag))
    next.push(tag)
  }
  return next.length === chosen.length ? (chosen as string[]) : next
}

/**
 * Under the box: the most used tags while it is empty; matches while typing
 * (starts-with first, accents ignored). Nothing when the list is full.
 */
export function editorOffers(chosen: readonly string[], counts: readonly TagCount[], draft: string, max: number = INTERNAL_TAG_LIMITS.perItem): string[] {
  if (chosen.length >= max) return []
  if (!draft.trim()) return topTags(counts.filter((c) => !chosen.some((t) => tagMatchKey(t) === tagMatchKey(c.tag))), TOP_TAG_CHIPS)
  return suggestTags(counts, draft, chosen, TYPED_SUGGESTIONS)
}
