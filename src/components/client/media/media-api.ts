/**
 * Which server actions a shared media component talks to. The gallery wizard
 * uses the Gallery module's actions (gallery.gallery.write); the Media screen
 * uses the Media Library's (owner/editor); the admin Media screen (ADR-030)
 * uses the admin's (`requireAbluoAdmin`, any project). Same shapes either way.
 */
import { batchGalleryPhotosAction, listGalleryMediaAction, updateGalleryPhotoAction, uploadGalleryImageAction } from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { batchMediaPhotosAction, listMediaLibraryAction, updateMediaPhotoAction, uploadMediaImageAction } from '@/app/[locale]/(client)/[tenant]/media/actions'
import {
  batchAdminMediaPhotosAction,
  deleteAdminMediaAction,
  listAdminMediaAction,
  updateAdminMediaPhotoAction,
  uploadAdminMediaAction,
} from '@/app/[locale]/(admin)/media/actions'

export type MediaScope = 'gallery' | 'media' | 'admin'
/** The scopes that can show the Media Library screen. */
export type MediaLibraryScope = Exclude<MediaScope, 'gallery'>

export function mediaApi(scope: MediaScope) {
  if (scope === 'admin') {
    return { upload: uploadAdminMediaAction, list: listAdminMediaAction, update: updateAdminMediaPhotoAction, batch: batchAdminMediaPhotosAction }
  }
  return scope === 'media'
    ? { upload: uploadMediaImageAction, list: listMediaLibraryAction, update: updateMediaPhotoAction, batch: batchMediaPhotosAction }
    : { upload: uploadGalleryImageAction, list: listGalleryMediaAction, update: updateGalleryPhotoAction, batch: batchGalleryPhotosAction }
}

/**
 * The Media screen's library read. `projectSlug: null` = every project, which
 * only the admin scope can list (the client scope refuses it before any call).
 */
export function listLibrary(scope: MediaLibraryScope, input: { projectSlug: string | null; cursor: string | null }) {
  if (scope === 'admin') return listAdminMediaAction(input)
  if (input.projectSlug === null) return Promise.resolve({ ok: false as const, error: 'forbidden' as const })
  return listMediaLibraryAction({ projectSlug: input.projectSlug, cursor: input.cursor })
}

/** Deleting a photo: admin only (the client dashboard has no delete yet). */
export function deleteFromLibrary(scope: MediaLibraryScope, input: { projectSlug: string; assetId: string }) {
  if (scope !== 'admin') return Promise.resolve({ ok: false as const, error: 'forbidden' as const })
  return deleteAdminMediaAction(input)
}

/** A square CDN thumbnail of a Sanity image URL. */
export const thumbOf = (url: string, size = 320): string | null => (url ? `${url}?w=${size}&h=${size}&fit=crop&auto=format` : null)
