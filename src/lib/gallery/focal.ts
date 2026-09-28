import type { SanityCrop, SanityHotspot } from '@/lib/sanity/types'

// ── Focal point → CSS object-position ─────────────────────────────────────────
// ADR-022 §4a. A gallery tile has a fixed shape set by the layout, and the photo
// is cropped into it. Without this, the browser crops around the CENTRE of the
// photo, which is how Claudia Hoffmann's studio gallery ended up showing floor
// instead of the chair and window.
//
// The editor marks the focal point once, on the Media Library asset (Sanity's
// "hotspot"). Sanity stores it as fractions of the ORIGINAL image. The image
// URL builder already applies the editor's crop rectangle, so the image the
// browser receives is the cropped one — the hotspot must be re-expressed in
// that cropped frame before it becomes an object-position.
//
// Why object-position rather than asking the CDN for an exact-size crop: tile
// shapes change across breakpoints (a tile is 4:3 on desktop and a full-width
// panorama when it closes an uneven last row on a tablet). object-position
// works for every shape with one set of image URLs.
//
// Using the focal fraction directly as the percentage is deliberate: with
// object-fit: cover, `object-position: x% y%` places the point at x of the
// image at x of the box, so the focal point is ALWAYS inside the visible tile,
// whatever its shape. Exact centring is impossible near the edges anyway.

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5)

/**
 * Re-express a hotspot centre in the frame of the cropped image.
 * Returns null when there is no usable hotspot.
 */
export function focalPoint(
  hotspot: Pick<SanityHotspot, 'x' | 'y'> | null | undefined,
  crop?: SanityCrop | null
): { x: number; y: number } | null {
  if (!hotspot || typeof hotspot.x !== 'number' || typeof hotspot.y !== 'number') return null
  const left = crop?.left ?? 0
  const right = crop?.right ?? 0
  const top = crop?.top ?? 0
  const bottom = crop?.bottom ?? 0
  const w = 1 - left - right
  const h = 1 - top - bottom
  const x = w > 0 ? (hotspot.x - left) / w : hotspot.x
  const y = h > 0 ? (hotspot.y - top) / h : hotspot.y
  return { x: clamp01(x), y: clamp01(y) }
}

/** CSS object-position for an image; the centre when no focal point is set. */
export function focalObjectPosition(
  image: { hotspot?: Pick<SanityHotspot, 'x' | 'y'> | null; crop?: SanityCrop | null } | null | undefined
): string {
  const p = focalPoint(image?.hotspot, image?.crop)
  if (!p) return '50% 50%'
  const pct = (n: number) => `${Math.round(n * 10000) / 100}%`
  return `${pct(p.x)} ${pct(p.y)}`
}
