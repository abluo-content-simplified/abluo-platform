/**
 * Reads an image's format, pixel size and whether it is animated from its
 * first bytes — no decoding, no dependency. Used by the processing policy
 * (ADR-035) on the server, where the browser's own measurement can't be trusted.
 *
 * Returns null when the bytes are not a JPEG, PNG or WebP we can read.
 * Width/height are null when the header is readable but the size isn't found
 * (the policy then decides on bytes alone).
 */

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export type ImageInfo = {
  type: ImageFormat
  width: number | null
  height: number | null
  /** APNG (`acTL`) or animated WebP (VP8X animation flag). Never true for JPEG. */
  animated: boolean
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

function jpeg(b: Uint8Array): ImageInfo {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1]
    if (marker === 0xff) {
      i += 1
      continue
    }
    // Standalone markers have no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break // end of image / start of scan
    const length = u16be(b, i + 2)
    // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7), animated: false }
    }
    if (length < 2) break
    i += 2 + length
  }
  return { type: 'image/jpeg', width: null, height: null, animated: false }
}

function png(b: Uint8Array): ImageInfo {
  const width = b.length >= 24 && ascii(b, 12, 16) === 'IHDR' ? u32be(b, 16) : null
  const height = width === null ? null : u32be(b, 20)
  // APNG declares `acTL` before the first `IDAT`.
  let animated = false
  let i = 8
  while (i + 8 <= b.length) {
    const len = u32be(b, i)
    const kind = ascii(b, i + 4, i + 8)
    if (kind === 'acTL') {
      animated = true
      break
    }
    if (kind === 'IDAT' || kind === 'IEND') break
    i += 12 + len
  }
  return { type: 'image/png', width, height, animated }
}

function webp(b: Uint8Array): ImageInfo {
  const chunk = ascii(b, 12, 16)
  if (chunk === 'VP8X' && b.length >= 30) {
    return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, animated: (b[20] & 0x02) !== 0 }
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, animated: false }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false }
  }
  return { type: 'image/webp', width: null, height: null, animated: false }
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes)
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return png(bytes)
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return webp(bytes)
  return null
}
