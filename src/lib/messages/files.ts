/**
 * Message file intake (ADR-050 D5) — pure byte handling, no dependency.
 * Images go through the ticket screenshot cleaner (type from the bytes,
 * EXIF / GPS stripped). PDFs are checked from their first bytes and kept as
 * they are (never re-encoded); they are served as downloads.
 */
import { stripMetadata } from '@/lib/support-tickets/image'
import { MESSAGE_LIMITS, type MessageFailure, type MessageFileType } from './model'

export type IncomingFile = { name: string; type: string; bytes: Uint8Array }
export type PreparedFile = { bytes: Uint8Array; mime: MessageFileType; width: number | null; height: number | null; name: string }

/** "%PDF-" at the start, and an end-of-file marker somewhere in the last kilobyte. */
export function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  const head = String.fromCharCode(...bytes.subarray(0, 5))
  if (head !== '%PDF-') return false
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024))
  let s = ''
  for (const b of tail) s += String.fromCharCode(b)
  return s.includes('%%EOF')
}

/** A file name safe to show and to send in a download header: no path, no control characters, ≤ 120 chars. */
export function cleanFileName(name: string, mime: MessageFileType): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').trim()
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 110) || (mime === 'application/pdf' ? 'document' : 'image')
  return `${stem}.${ext}`
}

/** Checks every file before anything is written. */
export function prepareMessageFiles(files: readonly IncomingFile[] | undefined): { ok: true; value: PreparedFile[] } | { ok: false; reason: MessageFailure } {
  const list = (files ?? []).filter((f) => f.bytes.length > 0)
  if (list.length > MESSAGE_LIMITS.attachmentsMax) return { ok: false, reason: 'tooManyAttachments' }
  const out: PreparedFile[] = []
  for (const f of list) {
    if (isPdf(f.bytes)) {
      if (f.bytes.length > MESSAGE_LIMITS.pdfBytesMax) return { ok: false, reason: 'attachmentTooLarge' }
      out.push({ bytes: f.bytes, mime: 'application/pdf', width: null, height: null, name: cleanFileName(f.name, 'application/pdf') })
      continue
    }
    if (f.bytes.length > MESSAGE_LIMITS.imageBytesMax) return { ok: false, reason: 'attachmentTooLarge' }
    const clean = stripMetadata(f.bytes)
    if (!clean) return { ok: false, reason: 'attachmentType' }
    out.push({ bytes: clean.bytes, mime: clean.mime, width: clean.width, height: clean.height, name: cleanFileName(f.name, clean.mime) })
  }
  return { ok: true, value: out }
}

export function extensionOf(mime: MessageFileType): string {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
}
