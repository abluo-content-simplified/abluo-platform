/**
 * Client dashboard — the Media screen (`/{project}/media`): the project's
 * Media Library with search and tags, where each photo is used, and editing a
 * photo's own facts. Uploads and edits reuse the shared Media Library code
 * (`uploadProjectImage`, `listProjectMedia` in post-media.ts,
 * `updateGalleryPhoto` in gallery-photos.ts) with the Media Library gate
 * (`MEDIA_MANAGE_PERMISSION` — owner/editor via `canManageMedia`).
 * `deleteMediaAsset` exists for the admin Media screen (ADR-030); the client
 * dashboard does not offer delete yet.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { listProjectMedia, type ListProjectMediaOptions, type PostMediaDeps, type ProjectMediaItem } from '@/lib/api/post-media'
import { GalleryError, localized } from '@/lib/api/gallery-drafts'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'

export type MediaUsage = { kind: 'gallery' | 'page' | 'post'; id: string; title: string }
/** A site's languages, default first. */
export type MediaSite = { defaultLocale: string; locales: string[] }
/**
 * The project a photo belongs to — set only by lists that span several
 * projects (the admin Media screen); the client dashboard never sets it.
 */
export type MediaItemProject = { slug: string; name: string; site: MediaSite }
export type MediaLibraryItem = ProjectMediaItem & { usedIn: MediaUsage[]; project?: MediaItemProject }

type Client = Pick<typeof sanityWriteClient, 'fetch'>
type DeleteClient = Pick<typeof sanityWriteClient, 'fetch' | 'getDocument' | 'delete'>

/**
 * The `sanity.imageAsset` id of a Sanity CDN image URL
 * (`…/images/<p>/<d>/<hash>-<w>x<h>.<ext>` → `image-<hash>-<w>x<h>-<ext>`), or null.
 */
export function imageRefFromUrl(url: string): string | null {
  const m = /^https:\/\/cdn\.sanity\.io\/images\/[^/]+\/[^/]+\/([a-f0-9]+-\d+x\d+)\.([a-z0-9]+)(?:\?.*)?$/i.exec(url)
  return m ? `image-${m[1]}-${m[2]}` : null
}

const pickTitle = (value: unknown, locale: string): string => {
  const v = localized(value)
  return v[locale] ?? v.en ?? Object.values(v)[0] ?? ''
}

/**
 * Where each asset is used: published galleries, pages and posts of THIS
 * project that reference the asset (or, for a blog cover, its image).
 * One request; the query text only ever interpolates loop indices.
 */
export async function mediaUsage(
  client: Client,
  projectSlug: string,
  assets: { assetId: string; url: string }[],
  locale: string
): Promise<Map<string, MediaUsage[]>> {
  const out = new Map<string, MediaUsage[]>()
  if (!assets.length) return out
  const params: Record<string, unknown> = { projectSlug }
  const parts = assets.map((a, i) => {
    params[`a${i}`] = a.assetId
    params[`r${i}`] = imageRefFromUrl(a.url) ?? '-'
    return `"u${i}": *[_type in ["gallery", "page", "post"] && projectSlug == $projectSlug
      && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
      && (references($a${i}) || coverImage.asset._ref == $r${i})]{ _id, _type, title, internalName }`
  })
  const rows = await client.fetch<Record<string, Array<{ _id: string; _type: string; title?: unknown; internalName?: unknown }> | null> | null>(
    `{ ${parts.join(',\n')} }`,
    params
  )
  assets.forEach((a, i) => {
    const list = (rows?.[`u${i}`] ?? []).map((r) => ({
      kind: (r._type === 'gallery' ? 'gallery' : r._type === 'post' ? 'post' : 'page') as MediaUsage['kind'],
      id: r._id,
      title: pickTitle(r.title, locale) || (typeof r.internalName === 'string' ? r.internalName : ''),
    }))
    out.set(a.assetId, list)
  })
  return out
}

/** One page of the Media screen: photos with their facts and where they are used, plus the project's tags. */
export async function listMediaLibrary(
  ctx: TenantAuthorizationContext,
  projectId: string,
  options: ListProjectMediaOptions = {},
  deps: PostMediaDeps & { client?: Client } = {}
): Promise<{ items: MediaLibraryItem[]; nextCursor: string | null; tags: string[] }> {
  const grant = assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
  const client = (deps.client as Client | undefined) ?? sanityWriteClient
  const page = await listProjectMedia(ctx, projectId, options, deps, MEDIA_MANAGE_PERMISSION)
  const site = await client.fetch<{ defaultLocale?: string | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale }`,
    { projectSlug: grant.projectSlug }
  )
  const usage = await mediaUsage(client, grant.projectSlug, page.items, site?.defaultLocale || 'en')
  return { ...page, items: page.items.map((i) => ({ ...i, usedIn: usage.get(i.assetId) ?? [] })) }
}

/** The site's languages (default first) for the Media screen. Media Library gate. */
export async function getMediaSite(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: { client?: Client } = {}
): Promise<MediaSite> {
  const grant = assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug: grant.projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0] || 'en'
  return { defaultLocale, locales: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * Deletes one Media Library photo (the `mediaAsset` document; the image binary
 * stays in Sanity, like the legacy `DELETE /api/media/[id]`). Media Library
 * gate first; the asset must be a published `mediaAsset` of the grant's
 * project ("not_found" otherwise, so ids can't be probed), and nothing may
 * reference it — published, draft or version — ("in_use"): a photo still on a
 * page, post or gallery is never deleted from under it.
 */
export async function deleteMediaAsset(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { assetId: string },
  deps: { client?: DeleteClient } = {}
): Promise<{ assetId: string }> {
  const grant = assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const assetId = input?.assetId
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) throw new GalleryError('not_found', 'Unknown photo.')
  const asset = (await client.getDocument(assetId)) as { _type?: string; projectSlug?: string } | undefined
  if (!asset || asset._type !== 'mediaAsset' || asset.projectSlug !== grant.projectSlug) {
    throw new GalleryError('not_found', 'Unknown photo.')
  }
  // `raw`: the clients' default perspective is `published`, which would not see
  // a draft gallery or post (or a release version) that still uses the photo —
  // and weak draft references would not stop Sanity's delete either.
  const refs = await client.fetch<number | null>(`count(*[references($id)])`, { id: assetId }, { perspective: 'raw' })
  if (typeof refs !== 'number') throw new GalleryError('failed', 'Could not check where the photo is used.')
  if (refs > 0) throw new GalleryError('in_use', 'This photo is still used.')
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    await client.delete(assetId)
  } catch (error) {
    // A reference that appeared meanwhile: Sanity refuses the delete.
    if ((error as { statusCode?: number })?.statusCode === 409) throw new GalleryError('in_use', 'This photo is still used.')
    throw new GalleryError('failed', 'Could not delete.')
  }
  return { assetId }
}
