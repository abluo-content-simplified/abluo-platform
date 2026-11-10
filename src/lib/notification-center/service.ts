// Server-only: uses the service role. Never import from a client component.
/**
 * Notification Center — every read and write of `notifications` (ADR-050 D9).
 * The table is service-role only (migration 069). Producers call `notify()`
 * after their own write succeeded; a failure here is logged and swallowed —
 * the bell is a nicety, it never fails the action that triggered it.
 * Readers pass the signed-in person's own id (from the session) and their
 * side; nothing here trusts an id from the browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import {
  NOTIFICATION_LIMITS,
  collapse,
  isNotificationKind,
  isSafeHref,
  type NotificationInput,
  type NotificationItem,
  type NotificationSide,
  type NotificationSourceType,
} from './model'

type Db = SupabaseClient

const MISSING = ['42P01', 'PGRST205', '42703', 'PGRST204']
const isMissing = (e: { code?: string | null } | null | undefined) => !!e && MISSING.includes(e.code ?? '')

function withDb<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return runAsTrustedSystemOperation(`notification center (ADR-050): ${reason}`, fn)
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** Writes one row per recipient, collapsing onto an unread row of the same source. Never throws. */
export async function notify(inputs: readonly NotificationInput[]): Promise<void> {
  const valid = inputs.filter((i) => isUuid(i.userId) && isUuid(i.sourceId) && isNotificationKind(i.kind) && isSafeHref(i.href))
  if (!valid.length) return
  try {
    await withDb('record notifications for the people an event concerns', async (db) => {
      for (const input of valid) await writeOne(db, input)
    })
  } catch (e) {
    console.error('[notifications] notify failed', e instanceof Error ? e.message : e)
  }
}

async function writeOne(db: Db, input: NotificationInput, retry = true): Promise<void> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('notifications')
    .select('id, count')
    .eq('user_id', input.userId)
    .eq('side', input.side)
    .eq('source_type', input.sourceType)
    .eq('source_id', input.sourceId)
    .is('read_at', null)
    .maybeSingle()
  if (error) {
    if (!isMissing(error)) console.error('[notifications] read failed', error.message)
    return
  }
  const plan = collapse((data as { id: string; count: number } | null) ?? null, input, now)
  if (plan.op === 'update') {
    const up = await db.from('notifications').update(plan.patch).eq('id', plan.id)
    if (up.error) console.error('[notifications] update failed', up.error.message)
    return
  }
  const ins = await db.from('notifications').insert(plan.row)
  // 23505: another request inserted the unread row in between — collapse onto it once.
  if (ins.error?.code === '23505' && retry) return writeOne(db, input, false)
  if (ins.error && !isMissing(ins.error)) console.error('[notifications] insert failed', ins.error.message)
}

let adminCache: { at: number; ids: string[] } | null = null

/**
 * Everyone who answers for Abluo (ADR-050 D1): resolved at send time from the
 * platform role, never a hard-coded person. Cached for a minute.
 */
export async function abluoTeamIds(): Promise<string[]> {
  if (adminCache && Date.now() - adminCache.at < 60_000) return adminCache.ids
  try {
    const ids = await withDb('list the Abluo team (platform_role abluo_admin) to notify', async (db) => {
      const out: string[] = []
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Error(error.message)
        for (const u of data.users) if (u.app_metadata?.platform_role === 'abluo_admin') out.push(u.id)
        if (data.users.length < 200) break
      }
      return out
    })
    adminCache = { at: Date.now(), ids }
    return ids
  } catch (e) {
    console.error('[notifications] team lookup failed', e instanceof Error ? e.message : e)
    return adminCache?.ids ?? []
  }
}

type Row = { id: string; kind: string; href: string; params: Record<string, string | number> | null; count: number; created_at: string; read_at: string | null; project_id: string | null }

/** The newest rows for the panel (unread first, then by time). Empty when unavailable. */
export async function listNotifications(userId: string, side: NotificationSide): Promise<NotificationItem[]> {
  try {
    return await withDb('the signed-in person reads their own notifications', async (db) => {
      const { data, error } = await db
        .from('notifications')
        .select('id, kind, href, params, count, created_at, read_at, project_id')
        .eq('user_id', userId)
        .eq('side', side)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_LIMITS.panel * 2)
      if (error) return []
      const rows = ((data ?? []) as Row[]).filter((r) => isNotificationKind(r.kind))
      const projectIds = [...new Set(rows.map((r) => r.project_id).filter((p): p is string => Boolean(p)))]
      const names = new Map<string, string>()
      if (projectIds.length) {
        const { data: projects } = await db.from('projects').select('id, name, slug').in('id', projectIds)
        for (const p of (projects ?? []) as { id: string; name: string | null; slug: string }[]) names.set(p.id, (p.name ?? '').trim() || p.slug)
      }
      const items = rows.map((r) => ({
        id: r.id,
        kind: r.kind as NotificationItem['kind'],
        href: r.href,
        params: r.params ?? {},
        count: r.count,
        createdAt: r.created_at,
        read: r.read_at !== null,
        projectName: r.project_id ? names.get(r.project_id) ?? null : null,
      }))
      const unread = items.filter((i) => !i.read)
      const read = items.filter((i) => i.read)
      return [...unread, ...read].slice(0, NOTIFICATION_LIMITS.panel)
    })
  } catch {
    return []
  }
}

/** The bell's number. 0 on any failure. */
export async function countUnreadNotifications(userId: string, side: NotificationSide): Promise<number> {
  try {
    return await withDb('the signed-in person counts their unread notifications', async (db) => {
      const { count, error } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('side', side).is('read_at', null)
      return error ? 0 : count ?? 0
    })
  } catch {
    return 0
  }
}

/** Mark one row (`id`) or all of the person's rows read. Only their own rows are touched. */
export async function markNotificationsRead(userId: string, side: NotificationSide, id?: string): Promise<void> {
  if (id !== undefined && !isUuid(id)) return
  try {
    await withDb('the signed-in person marks their own notifications read', async (db) => {
      let q = db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('side', side).is('read_at', null)
      if (id) q = q.eq('id', id)
      await q
    })
  } catch {
    /* nicety */
  }
}

/** Opening the thing a notification is about marks it read (D9 auto-read). Never throws. */
export async function markSourceRead(userId: string, side: NotificationSide, sourceType: NotificationSourceType, sourceId: string): Promise<void> {
  if (!isUuid(sourceId)) return
  try {
    await withDb('opening a conversation / ticket marks its notification read', async (db) => {
      await db
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('side', side)
        .eq('source_type', sourceType)
        .eq('source_id', sourceId)
        .is('read_at', null)
    })
  } catch {
    /* nicety */
  }
}
