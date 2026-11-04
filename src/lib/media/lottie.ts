/**
 * Lottie animations in the Media Library (ADR-046) — the pure half: is this
 * file a Lottie animation, which flavour, and what do we know about it.
 *
 * Two flavours are accepted, both of the open Lottie format (Lottie
 * Animation Community specification 1.0):
 *
 *   - `lottie-json` — the plain animation (`.json`, IANA `video/lottie+json`):
 *     one JSON object with a version, frame rate, in/out points, size and a
 *     `layers` array. Read fully, so its size and length are known.
 *   - `dotlottie` — the packaged animation (`.lottie`): a ZIP archive with a
 *     `manifest.json` and an `animations/` folder. Recognised by its ZIP
 *     header and those two names; it is not unpacked here, so its size and
 *     length stay unknown (the player reads them when it plays).
 *
 * Anything else — an image, an SVG, any other JSON or ZIP — is not an
 * animation (`null`). The check runs on the file's own bytes, never on its
 * declared type or extension.
 */

export const LOTTIE_LIMITS = {
  /** Upload size limit. Real animations are tens of KB; 2 MB leaves room for embedded images. */
  maxBytes: 2 * 1024 * 1024,
  /** Sanity reads this as the file's type. */
  contentType: { 'lottie-json': 'application/json', dotlottie: 'application/zip' },
  extension: { 'lottie-json': 'json', dotlottie: 'lottie' },
} as const

export type LottieFormat = 'lottie-json' | 'dotlottie'

export type LottieInfo = {
  format: LottieFormat
  /** Canvas size in px (lottie-json only). */
  width?: number
  height?: number
  /** Frames per second and length in frames (lottie-json only). */
  frameRate?: number
  frames?: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b)
}

/** True when `needle` (ASCII) occurs anywhere in `bytes`. ZIP entry names are stored uncompressed. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0))
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return true
  }
  return false
}

/** The animation's facts, or null when the bytes are not a Lottie animation. Pure. */
export function readLottie(bytes: Uint8Array): LottieInfo | null {
  if (!bytes?.length || bytes.length > LOTTIE_LIMITS.maxBytes) return null

  // `.lottie`: a ZIP archive (local file header "PK\x03\x04") holding a manifest and animations.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return containsAscii(bytes, 'manifest.json') && containsAscii(bytes, 'animations/') ? { format: 'dotlottie' } : null
  }

  // Plain Lottie JSON: the first non-space character opens an object.
  let i = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3 // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++
  if (bytes[i] !== 0x7b) return null
  let doc: unknown
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const d = doc as Record<string, unknown>
  if (typeof d.v !== 'string' || !isNum(d.fr) || !isNum(d.ip) || !isNum(d.op) || !isNum(d.w) || !isNum(d.h)) return null
  if (!Array.isArray(d.layers) || d.fr <= 0 || d.op <= d.ip || d.w <= 0 || d.h <= 0) return null
  return { format: 'lottie-json', width: d.w, height: d.h, frameRate: d.fr, frames: d.op - d.ip }
}

/** Length in seconds, when known. Pure. */
export function lottieSeconds(info: Pick<LottieInfo, 'frameRate' | 'frames'> | null | undefined): number | null {
  return info && isNum(info.frameRate) && isNum(info.frames) && info.frameRate > 0 ? info.frames / info.frameRate : null
}
