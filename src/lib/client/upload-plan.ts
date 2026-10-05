/**
 * Decides whether the browser should resize a photo before uploading it.
 *
 * The real compression is TinyPNG's, on the server (createMediaAsset). The
 * browser only steps in when the file would not fit the upload: server
 * actions accept 4 MB (next.config `experimental.serverActions.bodySizeLimit`,
 * under Vercel's 4.5 MB request limit), or when the photo is far larger than
 * any screen needs. Then it re-encodes at HIGH quality so Tinify still has
 * real work to do — never a second lossy squeeze of an already-small file.
 */

export const UPLOAD_LIMITS = {
  /** Largest body we send (multipart overhead stays under the 4 MB limit). */
  maxSendBytes: 3.8 * 1024 * 1024,
  /** Longest edge worth keeping for a cover (2× a 1280px header). */
  maxEdge: 2560,
  /** First re-encode quality. */
  quality: 0.92,
  /** Formats the server accepts as they are. */
  types: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
} as const

export type UploadAttempt = { maxEdge: number; quality: number; type: 'image/jpeg' }
export type UploadPlan = { action: 'send' } | { action: 'resize'; attempts: UploadAttempt[] }

/**
 * `width`/`height` are the decoded pixel size, or null when the browser could
 * not decode the image (then a supported file is sent as is and the server
 * decides; an unsupported one must be resized, i.e. converted).
 */
export function planUpload(file: {
  size: number
  type: string
  width?: number | null
  height?: number | null
}): UploadPlan {
  const supported = UPLOAD_LIMITS.types.includes(file.type)
  const longest = Math.max(file.width ?? 0, file.height ?? 0)
  const fits = file.size <= UPLOAD_LIMITS.maxSendBytes
  if (supported && fits && longest <= UPLOAD_LIMITS.maxEdge) return { action: 'send' }

  const edge = Math.min(UPLOAD_LIMITS.maxEdge, longest || UPLOAD_LIMITS.maxEdge)
  return {
    action: 'resize',
    attempts: [
      { maxEdge: edge, quality: UPLOAD_LIMITS.quality, type: 'image/jpeg' },
      { maxEdge: edge, quality: 0.85, type: 'image/jpeg' },
      { maxEdge: Math.min(edge, 2048), quality: 0.85, type: 'image/jpeg' },
    ],
  }
}

/** "2.4 MB", "610 KB" — for the upload confirmation. */
export function formatBytes(bytes: number, locale = 'en'): string {
  const nf = (max: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: max })
  if (bytes >= 1024 * 1024) return `${nf(1).format(bytes / (1024 * 1024))} MB`
  return `${nf(0).format(Math.max(1, Math.round(bytes / 1024)))} KB`
}
