/**
 * Screenshot intake (ADR-039 D10) — pure byte handling, no dependency.
 *
 *   sniffImage()     the real type from the file's first bytes (never its name)
 *   stripMetadata()  removes EXIF / XMP / IPTC / text chunks (GPS, camera,
 *                    author) without re-encoding the pixels
 *   imageSize()      width × height from the header
 *
 * Unknown or damaged files are refused (null), never passed through.
 */
import type { AttachmentMime } from './model'

export function sniffImage(bytes: Uint8Array): AttachmentMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

export type StrippedImage = { bytes: Uint8Array; mime: AttachmentMime; width: number | null; height: number | null }

/** Returns the cleaned file, or null when the file is not a well-formed PNG / JPEG / WebP. */
export function stripMetadata(input: Uint8Array): StrippedImage | null {
  const mime = sniffImage(input)
  try {
    if (mime === 'image/png') return png(input)
    if (mime === 'image/jpeg') return jpeg(input)
    if (mime === 'image/webp') return webp(input)
  } catch {
    return null
  }
  return null
}

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i])
  return s
}
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) + b[at + 1]
const u32le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0)
const u24le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16)

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ── PNG: drop eXIf, tEXt, iTXt, zTXt, tIME chunks ────────────────────────────
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])
function png(b: Uint8Array): StrippedImage | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let at = 8
  let width: number | null = null
  let height: number | null = null
  let sawEnd = false
  while (at + 12 <= b.length) {
    const len = u32be(b, at)
    const type = ascii(b, at + 4, 4)
    const end = at + 12 + len
    if (end > b.length) return null
    if (type === 'IHDR') { width = u32be(b, at + 8); height = u32be(b, at + 12) }
    if (!PNG_DROP.has(type)) parts.push(b.subarray(at, end))
    at = end
    if (type === 'IEND') { sawEnd = true; break }
  }
  if (!sawEnd || width === null) return null
  return { bytes: concat(parts), mime: 'image/png', width, height }
}

// ── JPEG: drop APP1 (EXIF/XMP), APP13 (IPTC) and COM before the image data ──
function jpeg(b: Uint8Array): StrippedImage | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let at = 2
  let width: number | null = null
  let height: number | null = null
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]
    if (marker === 0xff) { at += 1; continue } // fill byte
    if (marker === 0xd9) { parts.push(b.subarray(at, at + 2)); return width === null ? null : { bytes: concat(parts), mime: 'image/jpeg', width, height } }
    const len = u16be(b, at + 2)
    const end = at + 2 + len
    if (len < 2 || end > b.length) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) { height = u16be(b, at + 5); width = u16be(b, at + 7) }
    if (marker === 0xda) { // start of scan: the rest is image data
      parts.push(b.subarray(at))
      return width === null ? null : { bytes: concat(parts), mime: 'image/jpeg', width, height }
    }
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(b.subarray(at, end))
    at = end
  }
  return null
}

// ── WebP: drop EXIF and XMP chunks, clear their VP8X flags, fix RIFF size ───
function webp(b: Uint8Array): StrippedImage | null {
  const chunks: Uint8Array[] = []
  let at = 12
  let width: number | null = null
  let height: number | null = null
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4))
  while (at + 8 <= riffEnd) {
    const type = ascii(b, at, 4)
    const len = u32le(b, at + 4)
    const end = at + 8 + len + (len % 2)
    if (at + 8 + len > b.length) return null
    if (type === 'VP8X') {
      const c = b.slice(at, at + 8 + len + (len % 2))
      c[8] = c[8] & ~0x0c // clear EXIF (0x08) and XMP (0x04) flags
      width = u24le(b, at + 12) + 1
      height = u24le(b, at + 15) + 1
      chunks.push(c)
    } else if (type === 'EXIF' || type === 'XMP ') {
      // dropped
    } else {
      if (type === 'VP8 ' && width === null && len >= 10) { width = u16le(b, at + 14) & 0x3fff; height = u16le(b, at + 16) & 0x3fff }
      if (type === 'VP8L' && width === null && len >= 5) {
        const bits = u32le(b, at + 9)
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
      }
      chunks.push(b.subarray(at, Math.min(end, b.length)))
    }
    at = end
  }
  if (!chunks.length) return null
  const body = concat(chunks)
  const header = new Uint8Array(12)
  header.set(b.subarray(0, 4), 0)
  const size = body.length + 4
  header[4] = size & 0xff; header[5] = (size >> 8) & 0xff; header[6] = (size >> 16) & 0xff; header[7] = (size >>> 24) & 0xff
  header.set(b.subarray(8, 12), 8)
  return { bytes: concat([header, body]), mime: 'image/webp', width, height }
}
const u16le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8)
