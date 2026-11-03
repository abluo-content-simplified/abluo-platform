import type { CatalogueLists } from '@/lib/api/catalogue-drafts'
import type { OptionListChoice } from './item-fields'
import type { ItemProfile } from '@/lib/modules/catalogue/profiles'

/**
 * Option lists an item may attach: any not archived — drafts included and
 * labelled as drafts (ADR-033 D-4). A never-published list is referenced
 * weakly; publishing the item is refused until it is published too, or the
 * editor publishes both together (D-5). Server-safe.
 */
export function optionListChoices(lists: CatalogueLists, defaultLocale: string): OptionListChoice[] {
  return lists.optionLists
    .filter((l) => l.status.status !== 'archived')
    .map((l) => ({ id: l.id, name: l.names[defaultLocale] || l.name || l.id, optionCount: l.optionCount, isDraft: !l.isPublished, ...(l.useFor && { useFor: l.useFor }), ...(l.useForCorrupt && { useForCorrupt: true as const }) }))
}

export type ItemChoice = {
  id: string
  name: string
  thumb: string | null
  categories: string[]
  /** D-21: at least one price on any format — the rule for a linked choice ("offered" is never a synonym for "priced"). */
  hasPrice: boolean
  imageCount: number
  offerCount: number
  /** Never published (D-4): shown as a draft, never implying it is public. */
  isDraft: boolean
  allergensNotReviewed: boolean
  /** D-22: the item's type and attached option lists (the option list's "Use for" preview counts with them). */
  profile?: ItemProfile | null
  optionListIds?: readonly string[]
}

/** Items a collection or an option may point at: not archived, drafts included (labelled, D-4). */
export function itemChoices(lists: CatalogueLists, defaultLocale: string): ItemChoice[] {
  return lists.items
    .filter((i) => i.status.status !== 'archived')
    .map((i) => ({
      id: i.id,
      name: i.names[defaultLocale] || i.name || i.id,
      thumb: i.thumb,
      categories: i.categories,
      hasPrice: i.offerCount > 0,
      imageCount: i.imageCount,
      offerCount: i.offerCount,
      isDraft: !i.isPublished,
      allergensNotReviewed: i.allergensNotReviewed,
      profile: i.itemProfile,
      optionListIds: i.optionLists,
    }))
}
