/**
 * Image presentation shared constants.
 *
 * These values are intentionally centralised here so that all image-based
 * components on the platform behave identically. When the Design System gains
 * dedicated media tokens (hover scale, transition duration, easing) these
 * constants will be replaced by DS-driven values.
 *
 * Usage rules for IMAGE_HOVER_CLASSES:
 *   1. Add className="group" (or include "group") to the element that should
 *      respond to hover — usually the card link or the image container.
 *   2. Set overflow-hidden on the direct parent of the <img> so scaled images
 *      don't bleed outside their container.
 *   3. Apply IMAGE_HOVER_CLASSES to the <img> element.
 */

/**
 * Standard hover zoom animation applied to every card / section image.
 *
 * Reference: BlogListingSection PostCard (the platform visual standard).
 * - duration-500 — 500 ms, gives a leisurely feel without being sluggish
 * - ease-out — decelerates into the scaled state for a polished look
 * - scale-105 — 5 % zoom, subtle but perceptible
 */
export const IMAGE_HOVER_CLASSES =
  'transition-transform duration-500 ease-out group-hover:scale-105' as const
