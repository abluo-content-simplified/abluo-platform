'use client'

import { useCallback, useState } from 'react'
import type { PendingSet } from '@/lib/client/autosave/journal'
import {
  attachmentIssues,
  NOT_REVIEWED,
  attachmentsPatch,
  declarationPatch,
  isBlockingAttachmentIssue,
  offerFormIssues,
  offerRows,
  offersToDoc,
  type AttachmentForm,
  type DeclarationForm,
  type ItemProfile,
  type ItemState,
  type OfferForm,
  type Visibility,
} from '@/lib/modules/catalogue/dashboard-form'
import type { ItemPhoto } from './item-fields'

const newKey = () => Math.random().toString(36).slice(2, 14)

/**
 * The item form behind the wizard and the editor: local state for instant
 * feedback, and every valid change handed to the draft's autosave. Prices
 * and option attachments are only sent once they validate (the server would
 * refuse them anyway); until then the screen shows what to fix.
 */
export function useItemState({
  initial,
  initialPhotos,
  channels,
  optionCounts,
  update,
}: {
  initial: ItemState
  initialPhotos: ItemPhoto[]
  channels: readonly string[]
  optionCounts: ReadonlyMap<string, number>
  update: (set: PendingSet) => void
}) {
  const [s, setS] = useState<ItemState>(() => ({ ...initial, offers: offerRows(initial.offers, channels, newKey) }))
  const [photos, setPhotosState] = useState<ItemPhoto[]>(initialPhotos)

  const patch = useCallback(
    (local: Partial<ItemState>, remote?: PendingSet) => {
      setS((prev) => ({ ...prev, ...local }))
      if (remote) update(remote)
    },
    [update]
  )

  return {
    s,
    photos,
    /**
     * D-2/D-3: changing the profile TO food starts the declaration over as "not
     * reviewed" (the server does the same); away from food it is dropped.
     */
    setProfile: (itemProfile: ItemProfile) => {
      if (s.itemProfile === itemProfile) return
      patch({ itemProfile, allergenDeclaration: NOT_REVIEWED }, { itemProfile })
    },
    setDeclaration: (allergenDeclaration: DeclarationForm) => patch({ allergenDeclaration }, { allergenDeclaration: declarationPatch(allergenDeclaration) }),
    setText: (field: 'name' | 'description', locale: string, value: string) => {
      setS((prev) => ({ ...prev, [field]: { ...prev[field], [locale]: value } }))
      update({ [`${field}.${locale}`]: value })
    },
    setCategories: (categories: string[]) => patch({ categories }, { categories }),
    setDietary: (dietary: string[]) => patch({ dietary }, { dietary }),
    setPhotos: (next: ItemPhoto[]) => {
      setPhotosState(next)
      patch({ imageIds: next.map((p) => p.assetId) }, { images: next.map((p) => p.assetId) })
    },
    setOffers: (offers: OfferForm[]) => patch({ offers }, offerFormIssues(offers, channels).length === 0 ? { offers: offersToDoc(offers) } : undefined),
    setOptions: (options: AttachmentForm[]) =>
      patch({ options }, attachmentIssues(options, optionCounts).some(isBlockingAttachmentIssue) ? undefined : { optionLists: attachmentsPatch(options) }),
    setHasPage: (hasPage: boolean) => patch({ hasPage }, { hasPage }),
    setSlug: (locale: string, value: string) => {
      setS((prev) => ({ ...prev, slug: { ...prev.slug, [locale]: value } }))
      update({ [`slug.${locale}`]: value.trim() })
    },
    setVisibility: (visibility: Visibility) => patch({ visibility }, { visibility }),
  }
}
