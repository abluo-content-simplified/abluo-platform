// ── Image sitemap entries (ADR-022 §7) ────────────────────────────────────────
// Google reads at most 1,000 images per URL; a gallery page is far below that.
const MAX_SITEMAP_IMAGES = 1000

/**
 * The `images` part of a sitemap entry: absolute https URLs only, each once.
 * Spread into an entry — returns {} when there is nothing, so pages without a
 * gallery are byte-for-byte unchanged.
 */
export function withImages(images: (string | null)[] | null | undefined): { images?: string[] } {
  const list = (images ?? []).filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
  return list.length > 0 ? { images: Array.from(new Set(list)).slice(0, MAX_SITEMAP_IMAGES) } : {}
}
