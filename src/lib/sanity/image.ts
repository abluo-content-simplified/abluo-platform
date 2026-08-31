import imageUrlBuilder from '@sanity/image-url'
import { SANITY_PROJECT_ID, SANITY_DATASET } from '@/lib/sanity/config'
import type { ResolvedImage } from '@/lib/sanity/types'

// Built from plain config, NOT from `sanityClient`. This module is imported by
// 'use client' components; importing the client would pull the (server-only)
// SANITY_API_READ_TOKEN module graph into the browser bundle. @sanity/image-url
// only ever builds CDN URLs and never authenticates, so config is all it needs.
const builder = imageUrlBuilder({ projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET })

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
