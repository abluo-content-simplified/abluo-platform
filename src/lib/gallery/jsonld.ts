import type { GalleryViewItem } from './view'

// ── Gallery structured data (ADR-022 §7) ──────────────────────────────────────
// schema.org ImageGallery with one ImageObject per photo, so search and answer
// engines can read what the photos are without a human looking at them.
// Nothing is asserted that is not authored: no caption key without a caption.

const MAX_IMAGES = 50

/** A stable JPEG rendition of a Sanity CDN original (some originals are AVIF). */
export function structuredImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}w=1600&fm=jpg&q=85`
}

export function buildImageGallerySchema(input: {
  name?: string | null
  description?: string | null
  locale: string
  items: GalleryViewItem[]
}): Record<string, unknown> | null {
  const images = input.items
    .filter((i) => !i.isVideo && i.url)
    .slice(0, MAX_IMAGES)
    .map((i) => ({
      '@type': 'ImageObject',
      contentUrl: structuredImageUrl(i.url),
      ...(i.width && i.height && { width: i.width, height: i.height }),
      ...(i.alt && { description: i.alt }),
      ...((i.caption ?? i.title) && { caption: i.caption ?? i.title }),
    }))
  if (images.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    inLanguage: input.locale,
    ...(input.name && { name: input.name }),
    ...(input.description && { description: input.description }),
    image: images,
  }
}
