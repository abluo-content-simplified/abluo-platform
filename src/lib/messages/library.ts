/**
 * Media Library pictures in a message (ADR-050 D5, "the usual process").
 * The browser sends the chosen photos' Sanity CDN addresses; the server
 * fetches a copy (at most 2000 px, JPEG) and it then goes through the same
 * intake as an upload — type from the bytes, metadata stripped, size limits —
 * into the private message bucket. Only our own Sanity project's image CDN
 * is ever fetched; any other address is refused.
 */
import { SANITY_DATASET, SANITY_PROJECT_ID } from '@/lib/sanity/config'
import { MESSAGE_LIMITS } from './model'
import type { IncomingFile } from './files'

export type LibraryPick = { url: string; name: string }

/** Pure: the fetchable copy of a library picture, or null when it is not one of our Sanity images. */
export function libraryFetchUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'cdn.sanity.io' || u.port || u.username || u.password) return null
  const prefix = `/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}/`
  if (!u.pathname.startsWith(prefix)) return null
  const file = u.pathname.slice(prefix.length)
  if (!/^[a-f0-9]{20,64}-\d{1,5}x\d{1,5}\.(jpg|jpeg|png|webp|gif|avif|heic|tif|tiff)$/i.test(file)) return null
  return `https://cdn.sanity.io${prefix}${file}?w=2000&fit=max&fm=jpg&q=85`
}

/** Pure: the picks from the form (JSON), cleaned; at most the attachment limit. */
export function cleanLibraryPicks(input: unknown): LibraryPick[] {
  if (!Array.isArray(input)) return []
  const out: LibraryPick[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { url?: unknown; name?: unknown }
    if (!libraryFetchUrl(r.url)) continue
    if (out.some((p) => p.url === r.url)) continue
    out.push({ url: r.url as string, name: typeof r.name === 'string' ? r.name.slice(0, 120) : '' })
  }
  return out.slice(0, MESSAGE_LIMITS.attachmentsMax)
}

/** Fetches the picks. null when one cannot be fetched — the message is then not sent (never silently without it). */
export async function fetchLibraryImages(picks: readonly LibraryPick[]): Promise<IncomingFile[] | null> {
  const out: IncomingFile[] = []
  for (const p of picks) {
    const url = libraryFetchUrl(p.url)
    if (!url) return null
    try {
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MESSAGE_LIMITS.imageBytesMax) return null
      out.push({ name: p.name ? `${p.name.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.jpg` : 'image.jpg', type: 'image/jpeg', bytes })
    } catch {
      return null
    }
  }
  return out
}
