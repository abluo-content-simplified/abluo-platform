/**
 * Site Access — server-side checks of an uploaded PDF (ADR-040 §10, B2.4).
 * Pure apart from Node's crypto. The bucket already refuses non-PDF MIME
 * types and > 20 MB; these checks do not trust the browser's MIME type.
 */
import { createHash } from 'crypto'
import { ACCESS_LIMITS } from './model'

/** Supabase signed upload URLs are valid for 2 hours; the reservation outlives them a little. */
export const UPLOAD_TTL_SECONDS = 3 * 60 * 60

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const EOF_MARKER = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)
}

function containsNearEnd(bytes: Uint8Array, sig: number[], window = 1024): boolean {
  const from = Math.max(0, bytes.length - window)
  outer: for (let i = bytes.length - sig.length; i >= from; i--) {
    for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer
    return true
  }
  return false
}

export type PdfCheck =
  | { ok: true; sizeBytes: number; sha256: string }
  | { ok: false; problem: 'not_a_pdf' | 'size_mismatch' | 'hash_mismatch' | 'too_large' }

export function inspectPdf(bytes: Uint8Array, declared: { declaredSize: number; declaredSha256: string }): PdfCheck {
  if (bytes.length > ACCESS_LIMITS.fileBytesMax) return { ok: false, problem: 'too_large' }
  if (bytes.length !== declared.declaredSize) return { ok: false, problem: 'size_mismatch' }
  // Signature at offset 0 and an end-of-file marker near the end: a renamed
  // file, an HTML page or a truncated upload all fail here.
  if (!startsWith(bytes, PDF_MAGIC) || !containsNearEnd(bytes, EOF_MARKER)) return { ok: false, problem: 'not_a_pdf' }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== declared.declaredSha256.toLowerCase()) return { ok: false, problem: 'hash_mismatch' }
  return { ok: true, sizeBytes: bytes.length, sha256 }
}

/** The name as uploaded, for the dashboard only: no path, no control characters, ≤ 200. */
export function sanitizeFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const base = value.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean ? [...clean].slice(0, 200).join('') : null
}

/** A safe download name from the document title: letters, digits, spaces, dashes; always ".pdf". */
export function downloadFilename(title: string | undefined | null, fallback = 'document'): string {
  const base = (title ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  const cut = [...(base || fallback)].slice(0, 120).join('').trim()
  return `${cut || fallback}.pdf`
}
