'use client'

/**
 * Browser side of a protected-PDF upload (ADR-040 B2.4/B2.5):
 *
 *   1. check the file here first (PDF signature, size) so a wrong file is
 *      named at once — the server checks again and is the one that decides;
 *   2. sha256 of the bytes (Web Crypto) — declared when the upload is
 *      reserved, re-measured by the server on the stored object;
 *   3. PUT straight to the one-time signed upload URL (the file never passes
 *      through a server action, which is capped at 4 MB);
 *   4. finish: the server reads the stored object and only then points the
 *      document at it. "Not uploaded yet" is retried briefly (storage can lag).
 */
import {
  beginAccessUploadAction,
  finishAccessUploadAction,
} from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessActionError } from '@/lib/access/action-errors'

export type UploadProblem = AccessActionError | 'not_a_pdf' | 'empty' | 'size_mismatch' | 'hash_mismatch' | 'too_large' | 'not_uploaded_yet' | 'network'

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const EOF_MARKER = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF

const has = (bytes: Uint8Array, sig: number[], at: number) => sig.every((b, j) => bytes[at + j] === b)

/** The same rule the server applies (src/lib/access/pdf.ts): starts with %PDF-, ends (last 1 KB) with %%EOF. */
export async function precheckPdf(file: Blob, maxBytes: number): Promise<UploadProblem | null> {
  if (file.size === 0) return 'empty'
  if (file.size > maxBytes) return 'file_too_large'
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer())
  if (!has(head, PDF_MAGIC, 0)) return 'not_a_pdf'
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 1024)).arrayBuffer())
  for (let i = tail.length - EOF_MARKER.length; i >= 0; i--) if (has(tail, EOF_MARKER, i)) return null
  return 'not_a_pdf'
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function put(url: string, file: Blob, onProgress: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', 'application/pdf')
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

export async function uploadProtectedPdf(input: {
  projectSlug: string
  documentId: string
  locale: string
  file: File
  maxBytes: number
  onProgress: (fraction: number) => void
}): Promise<{ ok: true; replaced: boolean } | { ok: false; problem: UploadProblem }> {
  const pre = await precheckPdf(input.file, input.maxBytes)
  if (pre) return { ok: false, problem: pre }
  const sha256 = await sha256Hex(input.file)
  const begun = await beginAccessUploadAction({
    projectSlug: input.projectSlug,
    documentId: input.documentId,
    locale: input.locale,
    sizeBytes: input.file.size,
    sha256,
    filename: input.file.name,
  })
  if (!begun.ok) return { ok: false, problem: begun.error }
  if (!(await put(begun.ticket.signedUrl, input.file, input.onProgress))) return { ok: false, problem: 'network' }
  input.onProgress(1)
  for (let attempt = 0; attempt < 4; attempt++) {
    const done = await finishAccessUploadAction({ projectSlug: input.projectSlug, uploadId: begun.ticket.uploadId })
    if (!done.ok) return { ok: false, problem: done.error }
    if (done.result.ok) return { ok: true, replaced: done.result.replaced }
    if (done.result.problem !== 'not_uploaded_yet') return { ok: false, problem: done.result.problem }
    await wait(800 * (attempt + 1))
  }
  return { ok: false, problem: 'not_uploaded_yet' }
}
