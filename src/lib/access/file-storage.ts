/**
 * Site Access — the private file store port (ADR-040 §10, B2.4).
 *
 * Bucket `site-access-files` (migration 050): PRIVATE, PDF only, 20 MB. Only
 * the service role reaches it, through `withSiteAccessStore()` in server.ts.
 * No code path ever asks for a public URL of this bucket — a test enforces it.
 *
 *   createSignedUploadUrl  one direct-to-storage upload of a path the DATABASE
 *                          chose (site_access_begin_upload), no overwrite
 *   download               the stored object, for the server-side check
 *   signedUrl              a bearer link of at most 60 seconds
 *   remove                 objects the sweep was handed (never an active file)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCESS_BUCKET, ACCESS_LIMITS, AccessError } from './model'

export interface SiteAccessFiles {
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>
  /** The object's bytes, or null when it does not exist. Refuses objects larger than maxBytes. */
  download(path: string, maxBytes: number): Promise<Uint8Array | null>
  /** Signed GET link, `seconds` ≤ 60. With downloadName the response is an attachment. */
  signedUrl(path: string, seconds: number, downloadName?: string): Promise<string>
  /** Removes objects; a missing object counts as removed. Returns the paths now gone. */
  remove(paths: string[]): Promise<string[]>
}

export function assertSignedSeconds(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > ACCESS_LIMITS.signedUrlSeconds) {
    throw new AccessError('invalid_input', 'signed url lifetime must be 1–60 seconds')
  }
}

export function createSupabaseSiteAccessFiles(db: SupabaseClient): SiteAccessFiles {
  const bucket = () => db.storage.from(ACCESS_BUCKET)
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: false })
      if (error || !data) throw new AccessError('unavailable', 'signed upload url')
      return { signedUrl: data.signedUrl, token: data.token }
    },
    async download(path, maxBytes) {
      const { data, error } = await bucket().download(path)
      if (error || !data) {
        const status = (error as { statusCode?: string | number; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status
        if (String(status) === '404' || String(status) === '400') return null
        throw new AccessError('unavailable', 'storage download')
      }
      if (data.size > maxBytes) throw new AccessError('invalid_input', 'object too large')
      return new Uint8Array(await data.arrayBuffer())
    },
    async signedUrl(path, seconds, downloadName) {
      assertSignedSeconds(seconds)
      const { data, error } = await bucket().createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined)
      if (error || !data?.signedUrl) throw new AccessError('unavailable', 'signed url')
      return data.signedUrl
    },
    async remove(paths) {
      if (paths.length === 0) return []
      const { error } = await bucket().remove(paths)
      if (error) throw new AccessError('unavailable', 'storage remove')
      return paths
    },
  }
}
