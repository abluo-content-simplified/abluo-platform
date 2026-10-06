'use server'

/**
 * Client dashboard — gallery server actions.
 *
 * Thin wrappers over `src/lib/api/gallery-drafts.ts`, `gallery-photos.ts` and
 * the shared Media Library code in `post-media.ts`, which hold every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes
 * (`GalleryActionError`); `detail` carries where a gallery is used (in_use).
 * Photos never need a description to publish (Tom, wave B).
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  batchGalleries,
  createGallery,
  deleteGallery,
  discardGalleryDraft,
  getGalleryDraft,
  GALLERY_WRITE_PERMISSION,
  GalleryError,
  listGalleries,
  openGalleryForEdit,
  patchGalleryDraft,
  publishGalleryDraft,
  type GalleryBatchResult,
  type GalleryErrorCode,
  type GalleryListItem,
  type GallerySnapshot,
  type GalleryUsage,
} from '@/lib/api/gallery-drafts'
import { batchUpdatePhotos, updateGalleryPhoto, type BatchPhotosInput, type UpdateGalleryPhotoInput } from '@/lib/api/gallery-photos'
import {
  listProjectMedia,
  PostMediaError,
  uploadProjectImage,
  type PostMediaErrorCode,
  type ProjectMediaItem,
  type UploadedPostImage,
} from '@/lib/api/post-media'

export type GalleryActionError = 'unauthenticated' | GalleryErrorCode | PostMediaErrorCode
type Fail = { ok: false; error: GalleryActionError; detail?: { usedIn?: GalleryUsage[]; assetIds?: string[] } }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getTenantAuthorizationContext>>>, projectId: string) => Promise<T>): Promise<Result<T>> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = typeof projectSlug === 'string' ? resolveProjectGrant(ctx.projects, projectSlug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof GalleryError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
    if (error instanceof PostMediaError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function listGalleriesAction(input: { projectSlug: string }): Promise<Result<{ galleries: GalleryListItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ galleries: await listGalleries(ctx, pid) }))
}

export async function getGalleryAction(input: { projectSlug: string; id: string }): Promise<Result<{ gallery: GallerySnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ gallery: await getGalleryDraft(ctx, pid, input.id) }))
}

/** Creates drafts.<id> from the published gallery when missing. Call before the first edit. */
export async function openGalleryForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openGalleryForEdit(ctx, pid, input.id))
}

export async function createGalleryAction(input: { projectSlug: string; title?: string }): Promise<Result<{ id: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createGallery(ctx, pid, { title: input.title }))
}

export async function patchGalleryDraftAction(input: {
  projectSlug: string
  id: string
  rev: string
  set: Record<string, unknown>
}): Promise<Result<{ rev: string; keys?: string[] }>> {
  return run(input?.projectSlug, (ctx, pid) => patchGalleryDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function updateGalleryPhotoAction(
  input: { projectSlug: string } & UpdateGalleryPhotoInput
): Promise<Result<Awaited<ReturnType<typeof updateGalleryPhoto>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    updateGalleryPhoto(ctx, pid, {
      assetId: input.assetId,
      rev: input.rev,
      name: input.name,
      alt: input.alt,
      title: input.title,
      caption: input.caption,
      tags: input.tags,
      focal: input.focal,
    })
  )
}

/** "Name and tag all": base name + number and/or tags for up to 100 photos; each is checked on its own. */
export async function batchGalleryPhotosAction(
  input: { projectSlug: string } & BatchPhotosInput
): Promise<Result<Awaited<ReturnType<typeof batchUpdatePhotos>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    batchUpdatePhotos(ctx, pid, { assetIds: input.assetIds, baseName: input.baseName, addTags: input.addTags })
  )
}

/** FormData: `projectSlug`, `file`. Files the photo in the Media Library (tag "gallery"). */
export async function uploadGalleryImageAction(formData: FormData): Promise<Result<UploadedPostImage>> {
  const file = formData?.get?.('file')
  return run(formData?.get?.('projectSlug'), async (ctx, pid) => {
    if (!(file instanceof File)) throw new PostMediaError('invalid_value', 'No file.')
    return uploadProjectImage(ctx, pid, file, { tag: 'gallery', permission: GALLERY_WRITE_PERMISSION })
  })
}

export async function listGalleryMediaAction(input: {
  projectSlug: string
  cursor?: string | null
  q?: string | null
  tags?: string[] | null
}): Promise<Result<{ items: ProjectMediaItem[]; nextCursor: string | null; tags: string[] }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    listProjectMedia(ctx, pid, { cursor: input.cursor ?? null, q: input.q ?? null, tags: input.tags ?? null }, {}, GALLERY_WRITE_PERMISSION)
  )
}

export async function publishGalleryDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ id: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishGalleryDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardGalleryDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardGalleryDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

export async function deleteGalleryAction(input: { projectSlug: string; id: string; rev?: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await deleteGallery(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

/** Select several: delete (owners; galleries shown on the website are skipped as "in_use") or add tags. ≤ 100, each checked on its own. */
export async function batchGalleriesAction(input: {
  projectSlug: string
  ids: string[]
  op: 'delete' | 'tags'
  addTags?: string[]
}): Promise<Result<{ results: GalleryBatchResult[] }>> {
  return run(input?.projectSlug, (ctx, pid) => batchGalleries(ctx, pid, { ids: input.ids, op: input.op, addTags: input.addTags }))
}
