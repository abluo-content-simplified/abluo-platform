import type { GalleryItem } from '@/lib/sanity/types'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { focalObjectPosition } from './focal'
import { naturalAspect } from './layout'

// ── Server → client view model ────────────────────────────────────────────────
// Everything a gallery needs to render and to open the lightbox, resolved once
// on the server: URLs, alt text, captions, focal point, natural shape. The
// client components receive plain serialisable data and never build a URL.

export interface GalleryViewItem {
  key: string
  /** Media Library asset id — de-duplication and deep-link identity. */
  assetId: string
  isVideo: boolean
  /** Tile image. */
  src?: string
  srcSet?: string
  /** Lightbox image (the whole photo, larger). */
  fullSrc?: string
  fullSrcSet?: string
  alt: string
  title?: string
  caption?: string
  /** CSS object-position from the focal point (ADR-022 §4a). */
  objectPosition: string
  /** Natural width / height. */
  aspect: number
  lqip?: string | null
  width?: number
  height?: number
  /** Original CDN URL, for structured data. */
  url?: string | null
}

/** Effective title and caption: a per-gallery override wins over the Media Library value. */
export function resolveItemText(item: GalleryItem): { title?: string; caption?: string } {
  const title = item.titleOverrideEnabled && item.titleOverride ? item.titleOverride : item.mediaAsset?.title
  const caption = item.captionOverrideEnabled && item.captionOverride ? item.captionOverride : item.mediaAsset?.caption
  return { title: title || undefined, caption: caption || undefined }
}

export function toViewItem(item: GalleryItem): GalleryViewItem {
  const asset = item.mediaAsset
  const image = asset?.image
  const { title, caption } = resolveItemText(item)
  const dims = image?.dimensions ?? undefined
  return {
    key: item._key,
    assetId: asset?._id ?? item._key,
    isVideo: asset?.mediaType === 'video',
    src: image ? imageUrl(image, 800) : undefined,
    srcSet: image ? imageSrcSet(image, [400, 800, 1200, 1600]) : undefined,
    fullSrc: image ? imageUrl(image, 1600) : undefined,
    fullSrcSet: image ? imageSrcSet(image, [800, 1200, 1600, 2400]) : undefined,
    // Alt text is the Media Library's job (media-library-first rule). Photos
    // may be described later (Tom, wave B): until then the photo's NAME is the
    // fallback; with no name the alt is empty (decorative).
    alt: asset?.altText || asset?.name?.trim() || '',
    title,
    caption,
    objectPosition: focalObjectPosition(image),
    aspect: naturalAspect(dims),
    lqip: image?.lqip ?? null,
    width: dims?.width,
    height: dims?.height,
    url: image?.url ?? null,
  }
}

export function toViewItems(items: GalleryItem[]): GalleryViewItem[] {
  return items.filter((i) => !!i.mediaAsset).map(toViewItem)
}
