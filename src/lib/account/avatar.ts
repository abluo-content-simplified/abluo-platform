/**
 * Profile photos (Tom, 2026-10-08): a person uploads their own avatar from the
 * Account page. Stored in the public Supabase Storage bucket `avatars`, under
 * the person's own id, so `safeAvatarUrl` (only Abluo-hosted images reach the
 * client) accepts it everywhere the avatar is shown (sidebar, People list).
 *
 * Pure helpers here; the upload itself is the server action in
 * `src/app/[locale]/(client)/account/actions.ts`.
 */

export const AVATAR_BUCKET = 'avatars'
/** After the browser's square resize the file is small; this is a safety cap. */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024
/** The browser crops to a centred square and resizes to this edge before upload. */
export const AVATAR_EDGE_PX = 512

export type AvatarImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** The real type from the file's first bytes — the declared type is never trusted. */
export function sniffImageType(bytes: Uint8Array): AvatarImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  )
    return 'image/png'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return 'image/webp'
  return null
}

const EXT: Record<AvatarImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** `{userId}/{stamp}.{ext}` — a new name per upload so caches never show the old photo. */
export function avatarObjectPath(userId: string, type: AvatarImageType, stamp: number = Date.now()): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('invalid user id')
  return `${userId}/${stamp}.${EXT[type]}`
}

/** The storage path inside the bucket for a public avatar URL we issued, else null. */
export function avatarPathFromUrl(url: string | null | undefined, supabaseUrl: string | undefined): string | null {
  if (!url || !supabaseUrl) return null
  const prefix = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/`
  return url.startsWith(prefix) ? url.slice(prefix.length) : null
}
