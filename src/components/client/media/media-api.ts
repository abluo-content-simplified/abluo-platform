/**
 * Which server actions a shared media component talks to. The gallery wizard
 * uses the Gallery module's actions (gallery.gallery.write); the Media screen
 * uses the Media Library's (owner/editor). Same shapes either way.
 */
import { batchGalleryPhotosAction, listGalleryMediaAction, updateGalleryPhotoAction, uploadGalleryImageAction } from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { batchMediaPhotosAction, listMediaLibraryAction, updateMediaPhotoAction, uploadMediaImageAction } from '@/app/[locale]/(client)/[tenant]/media/actions'

export type MediaScope = 'gallery' | 'media'

export function mediaApi(scope: MediaScope) {
  return scope === 'media'
    ? { upload: uploadMediaImageAction, list: listMediaLibraryAction, update: updateMediaPhotoAction, batch: batchMediaPhotosAction }
    : { upload: uploadGalleryImageAction, list: listGalleryMediaAction, update: updateGalleryPhotoAction, batch: batchGalleryPhotosAction }
}

/** A square CDN thumbnail of a Sanity image URL. */
export const thumbOf = (url: string, size = 320): string | null => (url ? `${url}?w=${size}&h=${size}&fit=crop&auto=format` : null)
