'use server'

/**
 * Account — the signed-in person's own profile photo and name (Tom, 2026-10-08).
 *
 * Only ever acts on the caller's own profile: the user id comes from the
 * server-side session, never from the request. The file is checked by its
 * real bytes (jpeg/png/webp only — no SVG, which could carry script), size-
 * capped, stored under `avatars/{userId}/…`, and `profiles.avatar_url` is set
 * with the service role (authenticated users may only update `full_name`,
 * migration 012). The previous photo is removed.
 */
import { revalidatePath } from 'next/cache'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { normalizeDisplayName, type DisplayNameError } from '@/lib/account/display-name'
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  avatarObjectPath,
  avatarPathFromUrl,
  sniffImageType,
} from '@/lib/account/avatar'

export type AvatarActionResult = { ok: true; url: string | null } | { ok: false; error: 'unauthenticated' | 'missing' | 'tooLarge' | 'type' | 'failed' }

async function currentAvatarPath(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('profiles').select('avatar_url').eq('id', userId).maybeSingle()
  return avatarPathFromUrl((data as { avatar_url?: string | null } | null)?.avatar_url, process.env.NEXT_PUBLIC_SUPABASE_URL)
}

export async function uploadAvatarAction(formData: FormData): Promise<AvatarActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'missing' }
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: 'tooLarge' }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return { ok: false, error: 'type' }

  const admin = createAdminClient()
  const previous = await currentAvatarPath(ctx.userId)
  const path = avatarObjectPath(ctx.userId, type)

  const up = await admin.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType: type, cacheControl: '31536000', upsert: false })
  if (up.error) return { ok: false, error: 'failed' }

  const url = admin.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
  const { error } = await admin.from('profiles').update({ avatar_url: url }).eq('id', ctx.userId)
  if (error) {
    await admin.storage.from(AVATAR_BUCKET).remove([path])
    return { ok: false, error: 'failed' }
  }
  if (previous && previous !== path) await admin.storage.from(AVATAR_BUCKET).remove([previous])

  revalidatePath('/', 'layout')
  return { ok: true, url }
}

export async function removeAvatarAction(): Promise<AvatarActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const admin = createAdminClient()
  const previous = await currentAvatarPath(ctx.userId)
  const { error } = await admin.from('profiles').update({ avatar_url: null }).eq('id', ctx.userId)
  if (error) return { ok: false, error: 'failed' }
  if (previous) await admin.storage.from(AVATAR_BUCKET).remove([previous])
  revalidatePath('/', 'layout')
  return { ok: true, url: null }
}

export type NameActionResult = { ok: true; name: string } | { ok: false; error: 'unauthenticated' | DisplayNameError | 'failed' }

/**
 * The person's display name. It lives in `profiles.full_name` (what the
 * sidebar account menu, the greeting and People read); GoTrue's
 * `user_metadata.full_name` — the fallback those readers use — is kept in step
 * so the two never disagree. Written AS the person: `authenticated` may update
 * only `full_name` on their own row (migration 012 + RLS). Only when the
 * profile row is missing (it is created at sign-up) is it created with the
 * service role, for the session's own user id.
 */
export async function updateDisplayNameAction(raw: string): Promise<NameActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const checked = normalizeDisplayName(raw)
  if (!checked.ok) return checked
  const name = checked.name

  const supabase = await createClient()
  const { data, error } = await supabase.from('profiles').update({ full_name: name }).eq('id', ctx.userId).select('id')
  if (error) return { ok: false, error: 'failed' }
  if (!data || data.length === 0) {
    const { error: insertError } = await createAdminClient().from('profiles').upsert({ id: ctx.userId, full_name: name }, { onConflict: 'id' })
    if (insertError) return { ok: false, error: 'failed' }
  }
  // Keep the metadata fallback in step; the profile row is the source, so a failure here is not fatal.
  await supabase.auth.updateUser({ data: { full_name: name } }).catch(() => null)

  revalidatePath('/', 'layout')
  return { ok: true, name }
}
