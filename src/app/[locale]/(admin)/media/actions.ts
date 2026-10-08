'use server'

/**
 * Admin — cross-project Media (ADR-030 step 4). Same shapes as the client
 * Media screen's actions (`(client)/[tenant]/media/actions.ts`) so the shared
 * media components drive both through `mediaApi('admin')`.
 *
 * Every action:
 *   1. `requireAbluoAdmin()` first — null → `forbidden`, before any read.
 *   2. Takes an explicit `projectSlug`, verified against Supabase `projects`
 *      (service role; the slug must name exactly one row).
 *   3. Builds a Media-Library-only admin context for that ONE project
 *      (`adminMediaContext`, src/lib/admin/media-context.ts) and calls the
 *      SAME library code as the client dashboard — `listMediaLibrary`,
 *      `getMediaSite`, `deleteMediaAsset` (media-library.ts),
 *      `uploadProjectImage` (post-media.ts), `updateGalleryPhoto` /
 *      `batchUpdatePhotos` (gallery-photos.ts) — so every project-scope check
 *      (tenant-scoped reads, same-project asset checks, single Sanity project,
 *      type sniffing, size and rate limits, Tinify) runs unchanged.
 *   4. Records the view or write in the internal admin audit log.
 *
 * `list` with `projectSlug: null` walks every project (one page at a time,
 * each photo labelled with its project and that site's languages).
 */

import { requireAbluoAdmin, type AuthenticatedActor } from '@/lib/api/auth'
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { deleteMediaAsset, getMediaSite, listMediaLibrary, type MediaLibraryItem, type MediaSite } from '@/lib/api/media-library'
import { POST_MEDIA_LIMITS, PostMediaError, uploadProjectImage, type PostMediaErrorCode, type UploadedPostImage } from '@/lib/api/post-media'
import { GalleryError, type GalleryErrorCode } from '@/lib/api/gallery-drafts'
import { batchUpdatePhotos, updateGalleryPhoto, type BatchPhotosInput, type UpdateGalleryPhotoInput } from '@/lib/api/gallery-photos'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { recordAdminAudit } from '@/lib/admin/audit'
import { adminMediaContext, collectAcrossProjects, parseAdminMediaCursor, type AdminMediaProject } from '@/lib/admin/media-context'
import { loadAdminMediaProject, loadAdminMediaProjects } from '@/lib/admin/media-projects'

export type AdminMediaError = 'unauthenticated' | PostMediaErrorCode | GalleryErrorCode
type Result<T> = ({ ok: true } & T) | { ok: false; error: AdminMediaError }

function failure(error: unknown): { ok: false; error: AdminMediaError } {
  if (error instanceof PostMediaError || error instanceof GalleryError) return { ok: false, error: error.code }
  if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
  return { ok: false, error: 'failed' }
}

/** The admin, the verified project and its Media-Library-only context — or the refusal. */
async function withProject<T>(
  projectSlug: unknown,
  fn: (ctx: TenantAuthorizationContext, project: AdminMediaProject, actor: AuthenticatedActor) => Promise<T>
): Promise<Result<T>> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  try {
    const project = await loadAdminMediaProject(projectSlug)
    const ctx = project ? adminMediaContext(actor, project) : null
    if (!project || !ctx) return { ok: false, error: 'forbidden' }
    return { ok: true, ...(await fn(ctx, project, actor)) }
  } catch (error) {
    return failure(error)
  }
}

const label = (project: AdminMediaProject, site: MediaSite) => ({ slug: project.slug, name: project.name, site })

type ListInput = { projectSlug: string | null; cursor?: string | null; q?: string | null; tags?: string[] | null }
type ListResult = { items: MediaLibraryItem[]; nextCursor: string | null; tags: string[] }

/** One page of one project's library, or (projectSlug null) of every project's. Each photo carries its project. */
export async function listAdminMediaAction(input: ListInput): Promise<Result<ListResult>> {
  const options = { q: input?.q ?? null, tags: input?.tags ?? null }
  const first = !input?.cursor

  if (input?.projectSlug != null) {
    return withProject(input.projectSlug, async (ctx, project, actor) => {
      const site = await getMediaSite(ctx, project.id)
      const page = await listMediaLibrary(ctx, project.id, { ...options, cursor: input.cursor ?? null })
      if (first) await recordAdminAudit({ actorId: actor.userId, action: 'media.project.view', projectId: project.id, detail: { projectSlug: project.slug } })
      return { ...page, items: page.items.map((i) => ({ ...i, project: label(project, site) })) }
    })
  }

  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  try {
    const cursor = input?.cursor ? parseAdminMediaCursor(input.cursor) : null
    if (input?.cursor && !cursor) return { ok: false, error: 'invalid_value' }
    const projects = await loadAdminMediaProjects()
    const sites = new Map<string, MediaSite>()
    const page = await collectAcrossProjects<MediaLibraryItem>({
      projects,
      cursor,
      pageSize: POST_MEDIA_LIMITS.pageSize,
      fetchPage: async (project, inner) => {
        const ctx = adminMediaContext(actor, project)
        if (!ctx) return { items: [], nextCursor: null, tags: [] }
        if (!sites.has(project.slug)) sites.set(project.slug, await getMediaSite(ctx, project.id))
        return listMediaLibrary(ctx, project.id, { ...options, cursor: inner })
      },
      onSkip: (project, error) =>
        console.warn(`admin media: skipped project "${project.slug}" (${error instanceof Error ? error.message : String(error)})`),
    })
    if (!page) return { ok: false, error: 'invalid_value' }
    if (first) await recordAdminAudit({ actorId: actor.userId, action: 'media.project.view', projectId: null, detail: { scope: 'all-projects' } })
    return {
      ok: true,
      nextCursor: page.nextCursor,
      tags: page.tags,
      items: page.items.map(({ project, item }) => ({
        ...item,
        project: label(project, sites.get(project.slug) ?? { defaultLocale: 'en', locales: ['en'] }),
      })),
    }
  } catch (error) {
    return failure(error)
  }
}

/** FormData: `projectSlug`, `file`. Files the photo in that project's Media Library (no tag). */
export async function uploadAdminMediaAction(formData: FormData): Promise<Result<UploadedPostImage>> {
  const file = formData?.get?.('file')
  return withProject(formData?.get?.('projectSlug'), async (ctx, project, actor) => {
    if (!(file instanceof File)) throw new PostMediaError('invalid_value', 'No file.')
    const uploaded = await uploadProjectImage(ctx, project.id, file, { tag: '', permission: MEDIA_MANAGE_PERMISSION })
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'media.asset.upload',
      projectId: project.id,
      detail: { projectSlug: project.slug, assetId: uploaded.assetId },
    })
    return uploaded
  })
}

/** A photo's own facts: name, description, title, caption, tags, focal point. */
export async function updateAdminMediaPhotoAction(
  input: { projectSlug: string } & UpdateGalleryPhotoInput
): Promise<Result<Awaited<ReturnType<typeof updateGalleryPhoto>>>> {
  return withProject(input?.projectSlug, async (ctx, project, actor) => {
    const fields = { assetId: input.assetId, rev: input.rev, name: input.name, alt: input.alt, title: input.title, caption: input.caption, tags: input.tags, focal: input.focal }
    const result = await updateGalleryPhoto(ctx, project.id, fields, {}, MEDIA_MANAGE_PERMISSION)
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'media.asset.update',
      projectId: project.id,
      detail: { projectSlug: project.slug, assetId: input.assetId, fields: Object.keys(fields).filter((k) => k !== 'assetId' && k !== 'rev' && fields[k as keyof typeof fields] !== undefined) },
    })
    return result
  })
}

/** Rename (base name + number) and/or add tags to up to 100 photos of ONE project; each is checked on its own. */
export async function batchAdminMediaPhotosAction(
  input: { projectSlug: string } & BatchPhotosInput
): Promise<Result<Awaited<ReturnType<typeof batchUpdatePhotos>>>> {
  return withProject(input?.projectSlug, async (ctx, project, actor) => {
    const result = await batchUpdatePhotos(ctx, project.id, { assetIds: input.assetIds, baseName: input.baseName, addTags: input.addTags }, {}, MEDIA_MANAGE_PERMISSION)
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'media.asset.update',
      projectId: project.id,
      detail: {
        projectSlug: project.slug,
        batch: true,
        assetIds: result.results.filter((r) => r.ok).map((r) => r.assetId),
        rename: input.baseName !== undefined,
        addTags: input.addTags ?? [],
      },
    })
    return result
  })
}

/** Deletes one unused photo from the project's Media Library ("in_use" when anything still references it). */
export async function deleteAdminMediaAction(input: { projectSlug: string; assetId: string }): Promise<Result<{ assetId: string }>> {
  return withProject(input?.projectSlug, async (ctx, project, actor) => {
    const result = await deleteMediaAsset(ctx, project.id, { assetId: input.assetId })
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'media.asset.delete',
      projectId: project.id,
      detail: { projectSlug: project.slug, assetId: result.assetId },
    })
    return result
  })
}
