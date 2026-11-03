// ── Items as C5 availability inputs (impact previews of Setup writers) ────────
//
// Pure mapping, one query. C5-6 scope: every NON-ARCHIVED item document copy
// (drafts and published both; counts are per stored document id, the UI shows
// distinct items). Commerce is read through `commerceOf` (the only commerce
// reader) and the primary category through `itemCategoryAssignment` (the one
// assignment reader), so the impact of a category or channel change is computed
// from exactly what the resolvers read.

import type { ItemAvailabilityInput } from '../commerce/channel-availability'
import type { ChannelSet } from '../commerce/channels'
import { commerceOf } from '../commerce/legacy-commerce'
import { itemCategoryAssignment } from './read'
import type { CategoryTree } from './types'

/** Project-scoped, versions excluded, archived excluded. */
export const ITEM_AVAILABILITY_QUERY = /* groq */ `*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**")) && !defined(archivedAt)]{ _id, primaryCategory, additionalCategories, categories, formats, offers, channelAvailability }`

export type ItemAvailabilityRow = { _id: string; primaryCategory?: unknown; additionalCategories?: unknown; categories?: unknown; formats?: unknown; offers?: unknown; channelAvailability?: unknown }

export function availabilityItemsOf(rows: readonly ItemAvailabilityRow[] | null | undefined, tree: CategoryTree, channels: ChannelSet): ItemAvailabilityInput[] {
  return (rows ?? []).map((r) => {
    const commerce = commerceOf(r, channels)
    return { itemId: r._id, primaryCategory: itemCategoryAssignment(r, tree).primary, itemRules: commerce.itemRules, formats: commerce.formats }
  })
}
