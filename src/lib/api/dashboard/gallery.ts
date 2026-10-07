/**
 * Dashboard provider — Galleries. Reads through the existing enforced
 * `listGalleries` (gallery.gallery.read) and, for the latest live ones only,
 * `getGalleryStatuses` (same gate). Home calls it only when a gallery widget
 * or the gallery attention rule is visible.
 */
import { listGalleries, type GalleryListItem } from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { settle } from '@/lib/api/dashboard/settle'
import { staleDraftsRule, type AttentionItem } from '@/lib/client/attention'

/** Live galleries listed under "Latest galleries". */
export const LATEST_GALLERIES = 3

export type GalleryGlance = { total: number; live: number; unpublished: number }

export type GalleryDashboard = {
  galleries: GalleryListItem[]
  /** The newest live galleries, with where each is used. */
  latest: GalleryListItem[]
  statuses: Record<string, GalleryStatus>
  glance: GalleryGlance
  attention: AttentionItem[]
}

/** Pure: counts for the "Galleries" tile. */
export function galleryGlance(galleries: readonly Pick<GalleryListItem, 'isPublished' | 'hasDraft'>[]): GalleryGlance {
  return {
    total: galleries.length,
    live: galleries.filter((g) => g.isPublished).length,
    unpublished: galleries.filter((g) => !g.isPublished).length,
  }
}

/** Pure: galleries with unpublished work that nobody touched for a while. */
export function galleryAttention(
  galleries: readonly Pick<GalleryListItem, 'hasDraft' | 'updatedAt' | 'title' | 'internalName'>[],
  href: string,
  untitled: string,
  now = Date.now(),
): AttentionItem[] {
  const item = staleDraftsRule(
    'gallery',
    galleries.filter((g) => g.hasDraft).map((g) => ({ updatedAt: g.updatedAt, title: g.title || g.internalName || untitled })),
    href,
    now,
  )
  return item ? [item] : []
}

export async function getGalleryDashboard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { latest: boolean; attention: { href: string; untitled: string } | null },
): Promise<GalleryDashboard | null> {
  const galleries = await settle('gallery.list', () => listGalleries(ctx, projectId))
  if (!galleries) return null
  const latest = opts.latest ? galleries.filter((g) => g.isPublished).slice(0, LATEST_GALLERIES) : []
  const statuses = latest.length
    ? ((await settle('gallery.statuses', () => getGalleryStatuses(ctx, projectId, latest.map((g) => g.id)))) ?? {})
    : {}
  return {
    galleries,
    latest,
    statuses,
    glance: galleryGlance(galleries),
    attention: opts.attention ? galleryAttention(galleries, opts.attention.href, opts.attention.untitled) : [],
  }
}
