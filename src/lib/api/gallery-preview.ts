/**
 * Mints the private preview link for a gallery (client dashboard · galleries).
 *
 * Reuses the post-preview infrastructure: the same signed token (kind
 * 'gallery'), the same 15 minutes, the same host rules. The page it opens is
 * the WEBSITE rendering the gallery's DRAFT:
 *   • with `pageId` — that page, exactly as published, with this gallery
 *     swapped for its draft wherever the page shows it;
 *   • without — the gallery alone in a Photo Gallery section in the site design.
 *
 * Gate, in order:
 *   1. `assertModuleAction(ctx, projectId, 'gallery.gallery.write')`.
 *   2. The gallery (draft, else published) must be a `gallery` of the GRANT's
 *      project, else "not_found".
 *   3. A `pageId` must be a page of this project that references the gallery.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { GALLERY_WRITE_PERMISSION, isGalleryId } from '@/lib/api/gallery-drafts'
import { PostPreviewError, previewOrigin, sitePreviewThemes, type DraftPreviewLink } from '@/lib/api/post-preview'
import { signDraftPreviewToken, previewSecret } from '@/lib/preview/draft-preview-token'

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch'>
export type GalleryPreviewDeps = { client?: Client; secret?: Buffer | null; now?: number }

/** One read: does this project's page `pageId` reference gallery `galleryId`? */
export async function pageShowsGallery(
  client: Pick<Client, 'fetch'>,
  pageId: string,
  galleryId: string,
  projectSlug: string
): Promise<boolean> {
  const hit = await client.fetch<string | null>(
    `*[_type == "page" && _id == $pageId && projectSlug == $projectSlug && references($galleryId)][0]._id`,
    { pageId, galleryId, projectSlug }
  )
  return hit === pageId
}

export async function mintGalleryPreview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; pageId?: string | null; host?: string | null; proto?: 'https' | 'http' },
  deps: GalleryPreviewDeps = {}
): Promise<DraftPreviewLink & { pageId: string | null }> {
  assertModuleAction(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? sanityWriteClient

  if (!isGalleryId(input?.id)) throw new PostPreviewError('not_found', 'Unknown gallery.')
  const pageId = input.pageId ?? null
  if (pageId !== null && !isGalleryId(pageId)) throw new PostPreviewError('not_found', 'Unknown page.')
  const secret = deps.secret === undefined ? previewSecret() : deps.secret
  if (!secret) throw new PostPreviewError('unavailable', 'Preview is not configured.')

  type Lite = { _type?: string; projectSlug?: string } | undefined
  const doc = ((await client.getDocument(`drafts.${input.id}`)) as Lite) ?? ((await client.getDocument(input.id)) as Lite)
  if (!doc || doc._type !== 'gallery' || doc.projectSlug !== grant.projectSlug) {
    throw new PostPreviewError('not_found', 'Unknown gallery.')
  }
  if (pageId && !(await pageShowsGallery(client, pageId, input.id, grant.projectSlug))) {
    throw new PostPreviewError('not_found', 'Unknown page.')
  }

  const themes = await sitePreviewThemes(client, grant.projectSlug)
  const { token, exp } = signDraftPreviewToken(
    { draftId: input.id, projectSlug: grant.projectSlug, userId: ctx.userId, kind: 'gallery', pageId },
    { secret, now: deps.now }
  )
  return {
    token,
    exp,
    origin: previewOrigin(input.host, { projectId: grant.projectId, projectSlug: grant.projectSlug }, input.proto),
    projectSlug: grant.projectSlug,
    themes,
    pageId,
  }
}
