/**
 * resolveEmbedUrl
 *
 * Converts a user-provided video URL into an embeddable iframe src.
 *
 * Supported inputs:
 *   YouTube watch:      youtube.com/watch?v=VIDEO_ID       (with any extra params)
 *   YouTube watch+list: youtube.com/watch?v=VIDEO_ID&list=PLAYLIST_ID
 *   YouTube short:      youtu.be/VIDEO_ID                  (with optional ?list=PLAYLIST_ID)
 *   YouTube playlist:   youtube.com/playlist?list=PLAYLIST_ID
 *   YouTube embed:      youtube.com/embed/VIDEO_ID         (passthrough)
 *   YouTube embed list: youtube.com/embed/videoseries?list=PLAYLIST_ID (passthrough)
 *   Cloudflare:         *.cloudflarestream.com/VIDEO_ID/watch → /iframe
 *   Cloudflare:         *.cloudflarestream.com/VIDEO_ID/iframe (passthrough)
 *
 * Returns null for unrecognised or unsupported URLs (channel pages, etc.).
 */
export function resolveEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const url = raw.trim()

  // Playlist ID, if present on any YouTube URL shape (watch, short, or playlist link)
  const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/)
  const list = listMatch ? listMatch[1] : null

  // YouTube watch URL — captures ID regardless of additional query params
  const ytWatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/
  )
  if (ytWatch) {
    return list
      ? `https://www.youtube.com/embed/${ytWatch[1]}?list=${list}`
      : `https://www.youtube.com/embed/${ytWatch[1]}`
  }

  // YouTube short URL — youtu.be/ID
  const ytShort = url.match(
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&]|$)/
  )
  if (ytShort) {
    return list
      ? `https://www.youtube.com/embed/${ytShort[1]}?list=${list}`
      : `https://www.youtube.com/embed/${ytShort[1]}`
  }

  // YouTube playlist URL — no specific video, embed the whole playlist
  const ytPlaylist = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/playlist\?(?:.*&)?list=([a-zA-Z0-9_-]+)/
  )
  if (ytPlaylist) return `https://www.youtube.com/embed/videoseries?list=${ytPlaylist[1]}`

  // YouTube embed URL — already in the right form, pass through
  if (/youtube\.com\/embed\/(videoseries|[a-zA-Z0-9_-]{11})/.test(url)) return url

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
