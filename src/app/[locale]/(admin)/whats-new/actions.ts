'use server'

/**
 * Admin "What's new" — save / publish / archive product updates and upload
 * their image (ADR-030, migration 035).
 *
 * Every action calls `requireAbluoAdmin()` FIRST (abluo_admin + two-factor)
 * and refuses when it returns null — the (admin) layout gate is not enough
 * for a server action, which can be invoked directly. Writes use the service
 * role (no API role may write product_updates). Input is validated by the
 * pure `validateProductUpdate`; the image is checked by its real bytes.
 */
import { revalidatePath } from 'next/cache'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { sniffImageType } from '@/lib/account/avatar'
import { getNoticeForAdmin, toAdminNotice, type AdminNotice } from '@/lib/whats-new/notices-admin'
import {
  NOTICE_COLUMNS,
  nextNoticeStatus,
  validateNotice,
  type NoticeError,
  type NoticeInput,
  type NoticeRow,
} from '@/lib/whats-new/notices'
import { getProductUpdateForAdmin, toAdminUpdate, type AdminProductUpdate } from '@/lib/whats-new/admin'
import {
  isMissingTableError,
  nextStatus,
  PRODUCT_UPDATE_BUCKET,
  PRODUCT_UPDATE_COLUMNS,
  PRODUCT_UPDATE_IMAGE_MAX_BYTES,
  productUpdateSlug,
  updateImageObjectPath,
  updateImagePathFromUrl,
  validateProductUpdate,
  type ProductUpdateError,
  type ProductUpdateInput,
  type ProductUpdateRow,
} from '@/lib/whats-new/model'

export type SaveIntent = 'save' | 'publish' | 'archive' | 'draft'

export type SaveProductUpdateResult =
  /** `warning`: saved, but the pop-up flag could not be stored (migration 045 not applied). */
  | { ok: true; update: AdminProductUpdate; warning?: 'popupUnavailable' }
  | { ok: false; error: 'forbidden' | 'notFound' | 'failed'; errors?: undefined }
  | { ok: false; error: 'invalid'; errors: ProductUpdateError[] }

const INTENTS: readonly SaveIntent[] = ['save', 'publish', 'archive', 'draft']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveProductUpdateAction(
  id: string | null,
  intent: SaveIntent,
  input: ProductUpdateInput,
): Promise<SaveProductUpdateResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (!INTENTS.includes(intent)) return { ok: false, error: 'failed' }
  if (id !== null && !UUID.test(id)) return { ok: false, error: 'notFound' }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const checked = validateProductUpdate(input, { knownModules: MODULE_REGISTRY.map((m) => m.id), supabaseUrl })
  if (!checked.ok) return { ok: false, error: 'invalid', errors: checked.errors }

  const admin = createAdminClient()
  const current = id ? await getProductUpdateForAdmin(id) : null
  if (id && !current) return { ok: false, error: 'notFound' }

  const next = nextStatus(
    intent,
    current ? { status: current.status, publishedAt: current.published_at } : null,
    new Date().toISOString(),
  )
  const values = { ...checked.values, status: next.status, published_at: next.publishedAt, updated_by: actor.userId }

  const { data, error } = current
    ? await admin.from('product_updates').update(values).eq('id', current.id).select(PRODUCT_UPDATE_COLUMNS).single()
    : await admin
        .from('product_updates')
        .insert({ ...values, slug: productUpdateSlug(checked.values.title), created_by: actor.userId })
        .select(PRODUCT_UPDATE_COLUMNS)
        .single()
  if (error || !data) {
    console.warn(`what's new: save failed (${error?.message ?? 'no row'})`)
    return { ok: false, error: 'failed' }
  }

  // The previous image, if it was replaced or removed, is deleted (best-effort).
  const previousPath = updateImagePathFromUrl(current?.image_url, supabaseUrl)
  if (previousPath && previousPath !== updateImagePathFromUrl(checked.values.image_url, supabaseUrl)) {
    await admin.storage.from(PRODUCT_UPDATE_BUCKET).remove([previousPath]).catch(() => undefined)
  }

  revalidatePath('/whats-new')
  // Client dashboards read the feed in their layout on every request (dynamic);
  // nothing to revalidate there.
  // "Show as pop-up" is written on its own (migration 045): when the column is
  // not there yet the update still saves, and only a ticked box is reported.
  const wantPopup = input.showAsPopup === true
  const flag = await admin.from('product_updates').update({ show_as_popup: wantPopup }).eq('id', (data as ProductUpdateRow).id)
  if (flag.error && wantPopup) console.warn(`what's new: pop-up flag not saved (${flag.error.message})`)
  const popupSaved = wantPopup && !flag.error
  return {
    ok: true,
    update: toAdminUpdate(data as ProductUpdateRow, null, popupSaved),
    ...(flag.error && wantPopup ? { warning: 'popupUnavailable' as const } : {}),
  }
}

export type UploadUpdateImageResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'missing' | 'tooLarge' | 'type' | 'failed' }

/**
 * Upload an image for an update. Returns its public URL; the update stores it
 * on save. JPEG / PNG / WebP by their real bytes only (no SVG), size-capped,
 * under a server-chosen path in the public `product-updates` bucket.
 */
export async function uploadProductUpdateImageAction(formData: FormData): Promise<UploadUpdateImageResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'missing' }
  if (file.size > PRODUCT_UPDATE_IMAGE_MAX_BYTES) return { ok: false, error: 'tooLarge' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return { ok: false, error: 'type' }

  const admin = createAdminClient()
  const path = updateImageObjectPath(type)
  const up = await admin.storage
    .from(PRODUCT_UPDATE_BUCKET)
    .upload(path, bytes, { contentType: type, cacheControl: '31536000', upsert: false })
  if (up.error) {
    console.warn(`what's new: image upload failed (${up.error.message})`)
    return { ok: false, error: 'failed' }
  }
  return { ok: true, url: admin.storage.from(PRODUCT_UPDATE_BUCKET).getPublicUrl(path).data.publicUrl }
}


// ── Announcements (migration 045) ────────────────────────────────────────────

export type SaveNoticeResult =
  | { ok: true; notice: AdminNotice }
  | { ok: false; error: 'forbidden' | 'notFound' | 'failed' | 'missing'; errors?: undefined }
  | { ok: false; error: 'invalid'; errors: NoticeError[] }

export async function saveNoticeAction(id: string | null, intent: SaveIntent, input: NoticeInput): Promise<SaveNoticeResult> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (!INTENTS.includes(intent)) return { ok: false, error: 'failed' }
  if (id !== null && !UUID.test(id)) return { ok: false, error: 'notFound' }

  const checked = validateNotice(input, {
    knownModules: MODULE_REGISTRY.map((m) => m.id),
    publishing: intent === 'publish',
    now: Date.now(),
  })
  if (!checked.ok) return { ok: false, error: 'invalid', errors: checked.errors }

  const admin = createAdminClient()
  const current = id ? await getNoticeForAdmin(id) : null
  if (id && !current) return { ok: false, error: 'notFound' }

  const values = { ...checked.values, status: nextNoticeStatus(intent, current?.status ?? null), updated_by: actor.userId }
  const { data, error } = current
    ? await admin.from('product_notices').update(values).eq('id', current.id).select(NOTICE_COLUMNS).single()
    : await admin.from('product_notices').insert({ ...values, created_by: actor.userId }).select(NOTICE_COLUMNS).single()
  if (error || !data) {
    console.warn(`announcements: save failed (${error?.message ?? 'no row'})`)
    return { ok: false, error: isMissingTableError(error) ? 'missing' : 'failed' }
  }
  revalidatePath('/whats-new')
  return { ok: true, notice: toAdminNotice(data as NoticeRow) }
}
