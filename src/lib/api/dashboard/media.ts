/**
 * Dashboard provider — Media Library. One small read for the "Photos" tile
 * and the alt-text attention rule. It goes through the same guards as the
 * Media screen: `assertProjectAccess(media.library.manage)` FIRST, then the
 * tenant-scoped Sanity client (which forces `$projectSlug` from the grant).
 * It reads counts and alt texts only — no new access to anything else.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { tenantScopedSanityClient, type SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { POST_MEDIA_LIMITS } from '@/lib/api/post-media'
import { needsDescription } from '@/lib/client/media-filter'
import { settle } from '@/lib/api/dashboard/settle'
import { missingAltTextRule, type AttentionItem } from '@/lib/client/attention'

export type MediaGlance = { photos: number; missingAlt: number }
export type MediaDashboard = { glance: MediaGlance; attention: AttentionItem[] }

type Row = { defaultLocale?: string | null; total?: number | null; alts?: unknown[] | null }

/** A stored alt text (localized object, or a legacy plain string) as language → text. */
export function altMap(value: unknown): Record<string, string> {
  if (typeof value === 'string') return value.trim() ? { en: value } : {}
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string'),
  ) as Record<string, string>
}

/** Pure: the tile and the attention item from the row read. */
export function summarizeMedia(row: Row | null, attentionHref: string | null): MediaDashboard {
  const locale = row?.defaultLocale || 'en'
  const alts = Array.isArray(row?.alts) ? row!.alts : []
  const missingAlt = alts.filter((a) => needsDescription({ alt: altMap(a) }, locale)).length
  const photos = typeof row?.total === 'number' ? row.total : alts.length
  const item = attentionHref ? missingAltTextRule(missingAlt, attentionHref) : null
  return { glance: { photos, missingAlt }, attention: item ? [item] : [] }
}

export async function getMediaDashboard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { attentionHref: string | null },
  deps: { fetch?: SanityFetchFn } = {},
): Promise<MediaDashboard | null> {
  const row = await settle('media.counts', async () => {
    assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
    const scoped = tenantScopedSanityClient(ctx, projectId, deps)
    return scoped.fetch<Row | null>(
      `{
        "defaultLocale": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].defaultLocale,
        "total": count(*[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && !(_id in path("drafts.**"))]),
        "alts": *[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && !(_id in path("drafts.**"))]
          | order(_createdAt desc)[0...${POST_MEDIA_LIMITS.scan}].altText
      }`,
      {},
    )
  })
  if (row === null) return null
  return summarizeMedia(row, opts.attentionHref)
}
