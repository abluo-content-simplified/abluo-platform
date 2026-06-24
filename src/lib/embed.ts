/**
 * resolveEmbedUrl
 *
 * Converts a user-provided video URL into an embeddable iframe src.
 *
 * Supported inputs:
 *   YouTube watch:   youtube.com/watch?v=VIDEO_ID  (with any extra params)
 *   YouTube short:   youtu.be/VIDEO_ID
 *   YouTube embed:   youtube.com/embed/VIDEO_ID    (passthrough)
 *   Cloudflare:      *.cloudflarestream.com/VIDEO_ID/watch → /iframe
 *   Cloudflare:      *.cloudflarestream.com/VIDEO_ID/iframe (passthrough)
 *
 * Returns null for unrecognised or unsupported URLs (channel pages, playlists, etc.).
 */
export function resolveEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const url = raw.trim()

  // YouTube watch URL — captures ID regardless of additional query params
  const ytWatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/
  )
  if (ytWatch) return `https://www.youtube.com/embed/${ytWatch[1]}`

  // YouTube short URL — youtu.be/ID
  const ytShort = url.match(
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&]|$)/
  )
  if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}`

  // YouTube embed URL — already in the right form, pass through
  if (/youtube\.com\/embed\/[a-zA-Z0-9_-]{11}/.test(url)) return url

  // Cloudflare Stream — replace /watch (with optional query string) with /iframe
  if (/cloudflarestream\.com/.test(url)) {
    if (/\/watch(\?.*)?$/.test(url)) {
      return url.replace(/\/watch(\?.*)?$/, '/iframe')
    }
    // Already an iframe URL
    if (url.endsWith('/iframe')) return url
  }

  return null
}
