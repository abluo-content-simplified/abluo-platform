/**
 * Media processing policy (ADR-035) — decides, per image, whether Tinify is
 * worth calling. One pure function; platform constants, never per tenant and
 * never shown to users.
 *
 * Resizing is the browser's job (`planUpload`, before the upload): by the time
 * an image reaches the server it is ≤ 2560 px and ≤ 3.8 MB in every normal
 * case. What's left to decide is compression only:
 *
 * - `keep`     — already light: small files, modern formats of modest size,
 *                low bytes-per-pixel (an already-compressed JPEG), animations
 *                (Tinify would flatten them).
 * - `optimize` — everything else: typically the browser's q0.92 re-encode or
 *                a camera JPEG (≈ 0.15–0.25 bytes/pixel; Tinify takes it to
 *                ≈ 0.03–0.08, measured 2026-10-15), so anything above 0.08
 *                still has a real saving left.
 *
 * Skipping saves Tinify credits and ≈ 3 s per photo. Thresholds are starting
 * values, to be tuned with real uploads.
 */
import type { ImageInfo } from '@/lib/media/image-info'

export const MEDIA_POLICY = {
  /** Below this, never worth a call. */
  alwaysKeepBytes: 150 * 1024,
  /** WebP/AVIF up to this size are kept (already efficiently encoded). */
  modernFormatKeepBytes: 1024 * 1024,
  /** Bytes per pixel at or below which a JPEG/PNG counts as already compressed. */
  keepBytesPerPixel: 0.08,
  /** Without a readable pixel size, keep only below this. */
  unknownSizeKeepBytes: 500 * 1024,
} as const

export type ProcessingDecision = {
  action: 'keep' | 'optimize'
  reason: 'small' | 'modern_format' | 'already_compressed' | 'animated' | 'heavy' | 'unknown_size'
}

export function decideProcessing(input: { bytes: number; info: ImageInfo | null }): ProcessingDecision {
  const { bytes, info } = input
  if (info?.animated) return { action: 'keep', reason: 'animated' }
  if (bytes <= MEDIA_POLICY.alwaysKeepBytes) return { action: 'keep', reason: 'small' }
  if (info?.type === 'image/webp' && bytes <= MEDIA_POLICY.modernFormatKeepBytes) {
    return { action: 'keep', reason: 'modern_format' }
  }
  const pixels = info?.width && info?.height ? info.width * info.height : 0
  if (!pixels) {
    return bytes <= MEDIA_POLICY.unknownSizeKeepBytes
      ? { action: 'keep', reason: 'unknown_size' }
      : { action: 'optimize', reason: 'unknown_size' }
  }
  return bytes / pixels <= MEDIA_POLICY.keepBytesPerPixel
    ? { action: 'keep', reason: 'already_compressed' }
    : { action: 'optimize', reason: 'heavy' }
}
