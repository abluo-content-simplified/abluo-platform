// Server-only: imports the service-role client; never import from a client component.
/**
 * Announcements — the admin side (migration 045). Reads with the SERVICE ROLE,
 * so every caller must have passed `requireAbluoAdmin()` first.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { audienceModules, cleanLocalized, isMissingTableError, type LocalizedText, type ProductUpdateStatus } from './model'
import { NOTICE_COLUMNS, type NoticeRow, type NoticeTone } from './notices'

/** One notice as the admin editor works with it (plain data, client-safe). */
export type AdminNotice = {
  id: string
  status: ProductUpdateStatus
  message: LocalizedText
  tone: NoticeTone
  startsAt: string
  endsAt: string
  modules: string[]
  updatedAt: string
}

export function toAdminNotice(row: NoticeRow): AdminNotice {
  return {
    id: row.id,
    status: row.status,
    message: cleanLocalized(row.message),
    tone: row.tone === 'warning' ? 'warning' : 'info',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    modules: audienceModules(row.audience),
    updatedAt: row.updated_at,
  }
}

export type AdminNoticesResult =
  | { state: 'ok'; notices: AdminNotice[] }
  | { state: 'missing' }
  | { state: 'error'; message: string }

/** Newest window first. 'missing' = migration 045 not applied. */
export async function listNoticesForAdmin(limit = 100): Promise<AdminNoticesResult> {
  const { data, error } = await createAdminClient()
    .from('product_notices')
    .select(NOTICE_COLUMNS)
    .order('starts_at', { ascending: false })
    .limit(limit)
  if (error) return isMissingTableError(error) ? { state: 'missing' } : { state: 'error', message: error.message }
  return { state: 'ok', notices: ((data ?? []) as NoticeRow[]).map(toAdminNotice) }
}

export async function getNoticeForAdmin(id: string): Promise<NoticeRow | null> {
  const { data } = await createAdminClient().from('product_notices').select(NOTICE_COLUMNS).eq('id', id).maybeSingle()
  return (data as NoticeRow | null) ?? null
}
