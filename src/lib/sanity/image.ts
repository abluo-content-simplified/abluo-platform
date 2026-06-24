import imageUrlBuilder from '@sanity/image-url'
import { sanityClient } from '@/lib/sanity/client'
import type { ResolvedImage } from '@/lib/sanity/types'

const builder = imageUrlBuilder(sanityClient)

/**
 * Build a responsive Sanity image URL.
 *
 * Usage:
 *   urlFor(image).width(800).auto('format').url()
 *   urlFor(image, 800)          // shorthand: 800px wide, auto format, q80
 */
export function urlFor(source: ResolvedImage | { asset: { _ref: string } }) {
  return builder.image(source)
}

/**
 * Get a ready-to-use URL for a given width.
 * Format is auto (WebP/AVIF where supported), quality 80.
 */
export function imageUrl(
  source: ResolvedImage | null | undefined,
  width: number,
  quality = 80,
): string | undefined {
  if (!source?.asset) return undefined
  return urlFor(source).width(width).quality(quality).auto('format').url()
}

/**
 * Build an absolute image URL optimised for Open Graph / social sharing.
 *
 * Forces JPEG output — social crawlers (WhatsApp, LinkedIn, Facebook, X/Twitter)
 * may not accept WebP or AVIF returned by auto('format').
 * Crops to 1200 × 630 (1.91:1) which is the recommended OG image size.
 */
export function ogImageUrl(
  source: ResolvedImage | { asset: { _ref: string } } | null | undefined,
): string | undefined {
  if (!source?.asset) return undefined
  return urlFor(source)
    .width(1200)
    .height(630)
    .fit('crop')
    .format('jpg')
    .quality(85)
    .url()
}

/**
 * Generate a srcSet string for responsive images.
 * widths defaults to [400, 800, 1200, 1600, 2400]
 */
export function imageSrcSet(
  source: ResolvedImage | null | undefined,
  widths: number[] = [400, 800, 1200, 1600, 2400],
  quality = 80,
): string | undefined {
  if (!source?.asset) return undefined
  return widths
    .map((w) => `${urlFor(source).width(w).quality(quality).auto('format').url()} ${w}w`)
    .join(', ')
}
