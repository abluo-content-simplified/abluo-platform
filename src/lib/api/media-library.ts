/**
 * Client dashboard — the Media screen (`/{project}/media`): the project's
 * Media Library with search and tags, where each photo is used, and editing a
 * photo's own facts. Uploads and edits reuse the shared Media Library code
 * (`uploadProjectImage`, `listProjectMedia` in post-media.ts,
 * `updateGalleryPhoto` in gallery-photos.ts) with the Media Library gate
 * (`MEDIA_MANAGE_PERMISSION` — owner/editor via `canManageMedia`).
 * No delete yet.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { listProjectMedia, type ListProjectMediaOptions, type PostMediaDeps, type ProjectMediaItem } from '@/lib/api/post-media'
import { localized } from '@/lib/api/gallery-drafts'

export type MediaUsage = { kind: 'gallery' | 'page' | 'post'; id: string; title: string }
export type MediaLibraryItem = ProjectMediaItem & { usedIn: MediaUsage[] }

type Client = Pick<typeof sanityWriteClient, 'fetch'>

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
): Promise<{ defaultLocale: string; locales: string[] }> {
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
