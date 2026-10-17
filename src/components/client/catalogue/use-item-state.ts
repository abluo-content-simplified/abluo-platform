'use client'

import { useCallback, useRef, useState } from 'react'
import type { PendingSet } from '@/lib/client/autosave/journal'
import {
  attachmentIssues,
  bookDetailsPatch,
  bookYearInvalid,
  NOT_REVIEWED,
  attachmentsPatch,
  declarationPatch,
  isBlockingAttachmentIssue,
  linkFormIssues,
  linksPatch,
  offerFormIssues,
  offerRows,
  offersToDoc,
  type AttachmentForm,
  type BookDetailsForm,
  type DeclarationForm,
  type ItemProfile,
  type ItemState,
  type LinkForm,
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
  defaultLocale,
  update,
}: {
  initial: ItemState
  initialPhotos: ItemPhoto[]
  channels: readonly string[]
  optionCounts: ReadonlyMap<string, number>
  /** The main language: a link row is saved once it has a label in it. */
  defaultLocale: string
  update: (set: PendingSet) => void
}) {
  const [s, setS] = useState<ItemState>(() => ({ ...initial, offers: offerRows(initial.offers, channels, newKey) }))
  // The last acceptable year, so author/ISBN typed while the year is wrong still save without losing it.
  const lastYear = useRef(initial.bookDetails.year)
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
    setText: (field: 'name' | 'byline' | 'description', locale: string, value: string) => {
      setS((prev) => ({ ...prev, [field]: { ...prev[field], [locale]: value } }))
      update({ [`${field}.${locale}`]: value })
    },
    /** F-2 — complete rows only are sent (the server refuses an unsafe address anyway); a bad row stays on screen with its message. */
    setLinks: (links: LinkForm[]) => patch({ links }, linkFormIssues(links, defaultLocale).length === 0 ? { links: linksPatch(links, defaultLocale) } : undefined),
    /** Amendment I-3 — all optional. A year that is not acceptable is not saved (the field says why); the rest is. */
    setBookDetails: (bookDetails: BookDetailsForm) => {
      if (!bookYearInvalid(bookDetails)) lastYear.current = bookDetails.year
      patch({ bookDetails }, { bookDetails: bookDetailsPatch(bookDetails, lastYear.current) })
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
