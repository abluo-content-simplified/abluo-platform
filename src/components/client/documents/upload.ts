'use client'

/**
 * Browser side of a document upload (ADR-040 B2.4, R9 §15):
 *
 *   1. check the file here first (its type's signature, size) so a wrong file
 *      is named at once — the server checks again and is the one that decides;
 *   2. sha256 of the bytes (Web Crypto) — declared when the upload is
 *      reserved, re-measured by the server on the stored object;
 *   3. PUT straight to the one-time signed upload URL (the file never passes
 *      through a server action, which is capped at 4 MB);
 *   4. finish: the server reads the stored object and only then points the
 *      document's languages at it. "Not uploaded yet" is retried briefly.
 *
 * One upload may serve several languages (one stored file).
 */
import { beginDocumentUploadAction, finishDocumentUploadAction } from '@/app/[locale]/(client)/[tenant]/document-library/actions'
import type { AccessActionError } from '@/lib/access/action-errors'

export type UploadProblem = AccessActionError | 'wrong_type' | 'empty' | 'size_mismatch' | 'hash_mismatch' | 'too_large' | 'not_uploaded_yet' | 'network'

export const UPLOAD_TYPES: Record<string, { maxBytes: number }> = {
  'application/pdf': { maxBytes: 20 * 1024 * 1024 },
  'image/jpeg': { maxBytes: 10 * 1024 * 1024 },
  'image/png': { maxBytes: 10 * 1024 * 1024 },
  'image/webp': { maxBytes: 10 * 1024 * 1024 },
}

const EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** The file's type; some phones leave `type` empty, so fall back on the extension. */
export function fileType(file: { name: string; type: string }): string | null {
  const t = file.type?.toLowerCase()
  if (t && t in UPLOAD_TYPES) return t
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT[ext] ?? null
}

const has = (bytes: Uint8Array, sig: number[], at: number) => sig.every((b, j) => bytes[at + j] === b)
async function head(file: Blob, n: number) { return new Uint8Array(await file.slice(0, n).arrayBuffer()) }
async function tail(file: Blob, n: number) { return new Uint8Array(await file.slice(Math.max(0, file.size - n)).arrayBuffer()) }
function containsAt(bytes: Uint8Array, sig: number[]): boolean {
  for (let i = bytes.length - sig.length; i >= 0; i--) if (has(bytes, sig, i)) return true
  return false
}

/** The same signatures the server checks (src/lib/access/pdf.ts inspectDocumentFile). */
export async function precheckFile(file: File): Promise<{ ok: true; mimeType: string } | { ok: false; problem: UploadProblem }> {
  if (file.size === 0) return { ok: false, problem: 'empty' }
  const type = fileType(file)
  if (!type) return { ok: false, problem: 'wrong_type' }
  if (file.size > UPLOAD_TYPES[type].maxBytes) return { ok: false, problem: 'file_too_large' }
  const h = await head(file, 12)
  let ok = false
  if (type === 'application/pdf') ok = has(h, [0x25, 0x50, 0x44, 0x46, 0x2d], 0) && containsAt(await tail(file, 1024), [0x25, 0x25, 0x45, 0x4f, 0x46])
  else if (type === 'image/jpeg') ok = has(h, [0xff, 0xd8, 0xff], 0) && containsAt(await tail(file, 64), [0xff, 0xd9])
  else if (type === 'image/png') ok = has(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) && containsAt(await tail(file, 64), [0x49, 0x45, 0x4e, 0x44])
  else if (type === 'image/webp') ok = has(h, [0x52, 0x49, 0x46, 0x46], 0) && has(h, [0x57, 0x45, 0x42, 0x50], 8)
  return ok ? { ok: true, mimeType: type } : { ok: false, problem: 'wrong_type' }
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function put(url: string, file: Blob, mimeType: string, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', mimeType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.onabort = () => resolve(false)
    xhr.send(file)
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function uploadDocumentFile(input: {
  projectSlug: string
  documentId: string
  /** Every language this one file serves. */
  locales: string[]
  file: File
  onProgress: (fraction: number) => void
}): Promise<{ ok: true; replaced: boolean } | { ok: false; problem: UploadProblem }> {
  const pre = await precheckFile(input.file)
  if (!pre.ok) return pre
  const sha256 = await sha256Hex(input.file)
  const begun = await beginDocumentUploadAction({
    projectSlug: input.projectSlug,
    documentId: input.documentId,
    locales: input.locales,
    mimeType: pre.mimeType,
    sizeBytes: input.file.size,
    sha256,
    filename: input.file.name,
  })
  if (!begun.ok) return { ok: false, problem: begun.error }
  if (!(await put(begun.ticket.signedUrl, input.file, pre.mimeType, input.onProgress))) return { ok: false, problem: 'network' }
  input.onProgress(1)
  for (let attempt = 0; attempt < 4; attempt++) {
    const done = await finishDocumentUploadAction({ projectSlug: input.projectSlug, uploadId: begun.ticket.uploadId })
    if (!done.ok) return { ok: false, problem: done.error }
    if (done.result.ok) return { ok: true, replaced: done.result.replaced }
    if (done.result.problem !== 'not_uploaded_yet') return { ok: false, problem: done.result.problem }
    await wait(800 * (attempt + 1))
  }
  return { ok: false, problem: 'not_uploaded_yet' }
}
