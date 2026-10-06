'use server'

/**
 * Client dashboard — Media screen server actions. Thin wrappers over
 * `src/lib/api/media-library.ts` and the shared Media Library code; every
 * check lives there. Gate: MEDIA_MANAGE_PERMISSION (owner/editor).
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { listMediaLibrary, type MediaLibraryItem } from '@/lib/api/media-library'
import { PostMediaError, uploadProjectImage, type PostMediaErrorCode, type UploadedPostImage } from '@/lib/api/post-media'
import { GalleryError, type GalleryErrorCode } from '@/lib/api/gallery-drafts'
import { batchUpdatePhotos, updateGalleryPhoto, type BatchPhotosInput, type UpdateGalleryPhotoInput } from '@/lib/api/gallery-photos'

export type MediaScreenError = 'unauthenticated' | PostMediaErrorCode | GalleryErrorCode
type Result<T> = ({ ok: true } & T) | { ok: false; error: MediaScreenError }

async function run<T>(
  projectSlug: unknown,
  fn: (ctx: NonNullable<Awaited<ReturnType<typeof getTenantAuthorizationContext>>>, projectId: string) => Promise<T>
): Promise<Result<T>> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = typeof projectSlug === 'string' ? resolveProjectGrant(ctx.projects, projectSlug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof PostMediaError || error instanceof GalleryError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function listMediaLibraryAction(input: {
  projectSlug: string
  cursor?: string | null
  q?: string | null
  tags?: string[] | null
}): Promise<Result<{ items: MediaLibraryItem[]; nextCursor: string | null; tags: string[] }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    listMediaLibrary(ctx, pid, { cursor: input.cursor ?? null, q: input.q ?? null, tags: input.tags ?? null })
  )
}

/** FormData: `projectSlug`, `file`. Files the photo in the Media Library (no tag). */
export async function uploadMediaImageAction(formData: FormData): Promise<Result<UploadedPostImage>> {
  const file = formData?.get?.('file')
  return run(formData?.get?.('projectSlug'), async (ctx, pid) => {
    if (!(file instanceof File)) throw new PostMediaError('invalid_value', 'No file.')
    return uploadProjectImage(ctx, pid, file, { tag: '', permission: MEDIA_MANAGE_PERMISSION })
  })
}

export async function updateMediaPhotoAction(
  input: { projectSlug: string } & UpdateGalleryPhotoInput
): Promise<Result<Awaited<ReturnType<typeof updateGalleryPhoto>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    updateGalleryPhoto(
      ctx,
      pid,
      { assetId: input.assetId, rev: input.rev, name: input.name, alt: input.alt, title: input.title, caption: input.caption, tags: input.tags, focal: input.focal },
      {},
      MEDIA_MANAGE_PERMISSION
    )
  )
}

/** Rename (base name + number) and/or add tags to up to 100 photos; each is checked on its own. */
export async function batchMediaPhotosAction(
  input: { projectSlug: string } & BatchPhotosInput
): Promise<Result<Awaited<ReturnType<typeof batchUpdatePhotos>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    batchUpdatePhotos(ctx, pid, { assetIds: input.assetIds, baseName: input.baseName, addTags: input.addTags }, {}, MEDIA_MANAGE_PERMISSION)
  )
}
