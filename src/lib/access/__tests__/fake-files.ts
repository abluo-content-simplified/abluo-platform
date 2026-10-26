/**
 * In-memory private bucket + the storage HTTP endpoint behind its signed URLs.
 * Signed URLs carry their expiry; the fake fetch honours Range like Supabase
 * Storage (206 + Content-Range) and refuses expired or unknown links.
 */
import { assertSignedSeconds, type SiteAccessFiles } from '../file-storage'
import { AccessError } from '../model'

export type FakeFiles = SiteAccessFiles & {
  objects: Map<string, Uint8Array>
  signed: Array<{ path: string; seconds: number; downloadName?: string }>
  uploadsSigned: string[]
  removed: string[]
  failRemove?: boolean
  fetch: typeof fetch
  fetchCalls: Array<{ url: string; range: string | null }>
  /** Make the storage endpoint misbehave for the next fetch. */
  nextFetch?: 'error' | 'ignore-range' | 'missing' | 'wrong-length'
}

export function createFakeFiles(now: () => number = Date.now): FakeFiles {
  const f = {
    objects: new Map<string, Uint8Array>(), signed: [], uploadsSigned: [], removed: [], fetchCalls: [],
  } as unknown as FakeFiles
  Object.assign(f, {
    async createSignedUploadUrl(path: string) {
      f.uploadsSigned.push(path)
      return { signedUrl: `https://storage.test/upload/sign/${path}?token=t`, token: 't' }
    },
    async download(path: string, maxBytes: number) {
      const b = f.objects.get(path)
      if (!b) return null
      if (b.length > maxBytes) throw new AccessError('invalid_input', 'object too large')
      return b
    },
    async signedUrl(path: string, seconds: number, downloadName?: string) {
      assertSignedSeconds(seconds)
      f.signed.push({ path, seconds, downloadName })
      const u = new URL(`https://storage.test/object/sign/site-access-files/${path}`)
      u.searchParams.set('exp', String(now() + seconds * 1000))
      if (downloadName) u.searchParams.set('download', downloadName)
      return u.toString()
    },
    async remove(paths: string[]) {
      if (f.failRemove) throw new AccessError('unavailable', 'storage remove')
      for (const p of paths) { f.objects.delete(p); f.removed.push(p) }
      return paths
    },
  })
  f.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    f.fetchCalls.push({ url: url.toString(), range: headers.get('range') })
    const mode = f.nextFetch
    f.nextFetch = undefined
    if (mode === 'error') throw new Error('network')
    if (Number(url.searchParams.get('exp')) < now()) return new Response('expired', { status: 400 })
    const path = decodeURIComponent(url.pathname.replace('/object/sign/site-access-files/', ''))
    const bytes = mode === 'missing' ? undefined : f.objects.get(path)
    if (!bytes) return new Response('not found', { status: 404 })
    const body = mode === 'wrong-length' ? bytes.slice(1) : bytes
    const range = headers.get('range')
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null
    if (m && mode !== 'ignore-range') {
      const s = Number(m[1]), e = Math.min(Number(m[2]), body.length - 1)
      return new Response(new Blob([body.slice(s, e + 1) as BlobPart]), { status: 206, headers: { 'Content-Range': `bytes ${s}-${e}/${body.length}`, 'Content-Length': String(e - s + 1) } })
    }
    return new Response(new Blob([body as BlobPart]), { status: 200, headers: { 'Content-Length': String(body.length) } })
  }) as typeof fetch
  return f
}

/** A small valid PDF of exactly `size` bytes (≥ 32). */
export function pdfBytes(size = 4096, fill = 0x41): Uint8Array {
  const head = new TextEncoder().encode('%PDF-1.7\n')
  const tail = new TextEncoder().encode('\n%%EOF\n')
  const b = new Uint8Array(size).fill(fill)
  b.set(head, 0)
  b.set(tail, size - tail.length)
  return b
}
