// Server-only: imports the service-role client; never import from a client component.
/**
 * Announcements — the admin side (migration 045). Reads with the SERVICE ROLE,
 * so every caller must have passed `requireAbluoAdmin()` first.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { audienceModules, cleanLocalized, isMissingTableError, type LocalizedText, type ProductUpdateStatus } from './model'
import { isMissingColumnError, NOTICE_COLUMNS, NOTICE_COLUMNS_045, noticeAudience, type NoticeRow, type NoticeTone } from './notices'

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
  /** ADR-050 D8 (migration 069). */
  body: LocalizedText
  requiresAck: boolean
  projects: string[]
  users: string[]
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
    body: cleanLocalized(row.body),
    requiresAck: row.requires_ack === true,
    projects: noticeAudience(row.audience).projects,
    users: noticeAudience(row.audience).users,
  }
}

export type AdminNoticesResult =
  | { state: 'ok'; notices: AdminNotice[] }
  | { state: 'missing' }
  | { state: 'error'; message: string }

/** Newest window first. 'missing' = migration 045 not applied. */
export async function listNoticesForAdmin(limit = 100): Promise<AdminNoticesResult> {
  const read = (columns: string) => createAdminClient().from('product_notices').select(columns).order('starts_at', { ascending: false }).limit(limit)
  const first = await read(NOTICE_COLUMNS)
  // Migration 069 not applied yet: the 045 columns.
  const { data, error } = isMissingColumnError(first.error) ? await read(NOTICE_COLUMNS_045) : first
  if (error) return isMissingTableError(error) ? { state: 'missing' } : { state: 'error', message: error.message }
  return { state: 'ok', notices: ((data ?? []) as unknown as NoticeRow[]).map(toAdminNotice) }
}

export async function getNoticeForAdmin(id: string): Promise<NoticeRow | null> {
  const read = (columns: string) => createAdminClient().from('product_notices').select(columns).eq('id', id).maybeSingle()
  const first = await read(NOTICE_COLUMNS)
  const { data } = isMissingColumnError(first.error) ? await read(NOTICE_COLUMNS_045) : first
  return (data as unknown as NoticeRow | null) ?? null
}

/** Acknowledgements of the given notices (migration 069; empty before). */
export async function listNoticeAcks(noticeIds: string[]): Promise<Map<string, { user_id: string; acknowledged_at: string }[]>> {
  const out = new Map<string, { user_id: string; acknowledged_at: string }[]>()
  if (!noticeIds.length) return out
  const { data, error } = await createAdminClient().from('product_notice_acks').select('notice_id, user_id, acknowledged_at').in('notice_id', noticeIds).limit(5000)
  if (error) return out
  for (const r of (data ?? []) as { notice_id: string; user_id: string; acknowledged_at: string }[]) {
    out.set(r.notice_id, [...(out.get(r.notice_id) ?? []), { user_id: r.user_id, acknowledged_at: r.acknowledged_at }])
  }
  return out
}
