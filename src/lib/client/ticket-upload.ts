'use client'
/**
 * Fits support screenshots into one request (ADR-039 D10). Server actions
 * accept 4 MB (next.config bodySizeLimit, under Vercel's 4.5 MB request cap),
 * while a request may carry up to 3 screenshots of 5 MB each. When the files
 * together are too big, the browser re-encodes the largest ones (JPEG,
 * longest edge ≤ 2048 px — text in a screenshot stays readable) until they
 * fit. Re-encoding also drops metadata; the server strips it again anyway.
 * Returns null when they still do not fit.
 */
import { planScreenshotShrink } from '@/lib/support-tickets/client-form'

async function reencode(file: File, maxEdge: number, quality: number): Promise<File | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob) return null
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return null
  }
}

export async function fitScreenshots(files: File[], budgetBytes: number): Promise<File[] | null> {
  let current = [...files]
  for (const step of planScreenshotShrink()) {
    if (current.reduce((n, f) => n + f.size, 0) <= budgetBytes) return current
    const next: File[] = []
    for (const f of current) {
      if (f.size <= step.skipBelowBytes) { next.push(f); continue }
      const smaller = await reencode(f, step.maxEdge, step.quality)
      next.push(smaller && smaller.size < f.size ? smaller : f)
    }
    current = next
  }
  return current.reduce((n, f) => n + f.size, 0) <= budgetBytes ? current : null
}
