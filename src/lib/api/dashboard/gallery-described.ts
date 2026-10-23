/**
 * Dashboard provider — "are all photos of this gallery described?" for the
 * Continue editing bar (3 of 4 = every photo has a description). One small
 * read for a handful of gallery ids; it reads only alt texts of the photos
 * in those galleries, through the tenant-scoped client (project forced from
 * the grant). A failed read just means "unknown" (the bar stays honest: lower).
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { assertProjectAccess } from '@/lib/api/media-permission'
import { GALLERY_WRITE_PERMISSION } from '@/lib/api/gallery-drafts'
import { altMap } from '@/lib/api/dashboard/media'
import { needsDescription } from '@/lib/client/media-filter'
import { settle } from '@/lib/api/dashboard/settle'

type Row = { _id: string; alts?: unknown[] | null }
type Result = { defaultLocale?: string | null; galleries?: Row[] | null }

/** Pure: gallery id → true when it has photos and every one has a description (the draft wins over the published copy). */
export function describedByGallery(result: Result | null): Record<string, boolean> {
  const locale = result?.defaultLocale || 'en'
  const picked = new Map<string, Row>()
  for (const row of result?.galleries ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    if (isDraft || !picked.has(id)) picked.set(id, row)
  }
  const out: Record<string, boolean> = {}
  for (const [id, row] of picked) {
    const alts = Array.isArray(row.alts) ? row.alts : []
    out[id] = alts.length > 0 && alts.every((a) => !needsDescription({ alt: altMap(a) }, locale))
  }
  return out
}

export async function getGalleriesDescribed(
  ctx: TenantAuthorizationContext,
  projectId: string,
  ids: readonly string[],
  deps: { fetch?: SanityFetchFn } = {},
): Promise<Record<string, boolean>> {
  if (!ids.length) return {}
  const result = await settle('gallery.described', async () => {
    assertProjectAccess(ctx, projectId, GALLERY_WRITE_PERMISSION)
    const scoped = tenantScopedSanityClient(ctx, projectId, deps)
    return scoped.fetch<Result>(
      `{
        "defaultLocale": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].defaultLocale,
        "galleries": *[_type == $type && projectSlug == $projectSlug && _id in $ids]{ _id, "alts": items[].mediaAsset->altText }
      }`,
      { type: 'gallery', ids: ids.flatMap((id) => [id, `drafts.${id}`]) },
    )
  })
  return describedByGallery(result)
}
