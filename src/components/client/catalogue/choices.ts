import type { CatalogueLists } from '@/lib/api/catalogue-drafts'
import type { OptionListChoice } from './item-fields'

/**
 * Option lists an item may attach: any not archived — drafts included and
 * labelled as drafts (ADR-033 D-4). A never-published list is referenced
 * weakly; publishing the item is refused until it is published too, or the
 * editor publishes both together (D-5). Server-safe.
 */
export function optionListChoices(lists: CatalogueLists, defaultLocale: string): OptionListChoice[] {
  return lists.optionLists
    .filter((l) => l.status.status !== 'archived')
    .map((l) => ({ id: l.id, name: l.names[defaultLocale] || l.name || l.id, optionCount: l.optionCount, isDraft: !l.isPublished }))
}

export type ItemChoice = {
  id: string
  name: string
  thumb: string | null
  categories: string[]
  offered: boolean
  imageCount: number
  offerCount: number
  /** Never published (D-4): shown as a draft, never implying it is public. */
  isDraft: boolean
  allergensNotReviewed: boolean
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
      offered: i.offerCount > 0,
      imageCount: i.imageCount,
      offerCount: i.offerCount,
      isDraft: !i.isPublished,
      allergensNotReviewed: i.allergensNotReviewed,
    }))
}
