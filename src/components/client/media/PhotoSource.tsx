'use client'

/**
 * Where a photo comes from — the one shared "add photos" block (Catalogue
 * redesign quick win 2.5): Take a photo / From this phone / Upload (the
 * AddPhotos pipeline: preview, background TinyPNG, ADR-035) and Media
 * Library (the picker). Each photo reaches `onAdd` once it is a ready Media
 * Library asset. Any module that needs photos uses this, never its own picker.
 */
import { useState } from 'react'
import { AddPhotos, type AddedPhoto } from '@/components/client/media/AddPhotos'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import type { MediaScope } from '@/components/client/media/media-api'

export function PhotoSource({
  projectSlug,
  scope,
  defaultLocale,
  exclude,
  room,
  onAdd,
  disabled,
  owner,
}: {
  projectSlug: string
  scope: MediaScope
  defaultLocale: string
  /** Asset ids already used — hidden from the library picker. */
  exclude: string[]
  /** How many more photos fit; undefined = no limit. */
  room?: number
  /** Photos, in the order they became ready (uploads) or were tapped (library). */
  onAdd: (photos: AddedPhoto[]) => void
  disabled?: boolean
  /** Upload owner key (see AddPhotos). */
  owner?: string
}) {
  const [picking, setPicking] = useState(false)
  return (
    <>
      <AddPhotos projectSlug={projectSlug} scope={scope} room={room} disabled={disabled} owner={owner} onUploaded={(p) => onAdd([p])} onOpenLibrary={() => setPicking(true)} />
      {picking ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope={scope}
          defaultLocale={defaultLocale}
          exclude={exclude}
          room={room}
          onClose={() => setPicking(false)}
          onAdd={(photos) => {
            setPicking(false)
            onAdd(photos)
          }}
        />
      ) : null}
    </>
  )
}
