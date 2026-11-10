/**
 * Announcements for the signed-in client (migration 045). Server-only.
 *
 * Read AS the user — their session client, no service role. RLS lets them see
 * published notices only, and only their own dismissals. The layout calls this
 * on every client page, so it must never break the page: a missing table
 * (migration 045 not applied: 42P01 / PGRST205) or any other failure returns
 * null and the dashboard simply shows no banner.
 */
import { createClient } from '@/lib/supabase/server'
import { isMissingTableError } from './model'
import { buildClientNotices, isMissingColumnError, NOTICE_COLUMNS, NOTICE_COLUMNS_045, NOTICE_LIMITS, type ClientNotice, type NoticeRow } from './notices'

export async function loadClientNotices(opts: {
  userId: string
  locale: string
  enabledModuleIds: readonly string[]
  /** ADR-050: the site being looked at (site-aimed notices). */
  projectId?: string | null
  now?: number
}): Promise<ClientNotice[] | null> {
  const now = opts.now ?? Date.now()
  try {
    const supabase = await createClient()
    const read = (columns: string) =>
      supabase
        .from('product_notices')
        .select(columns)
        .eq('status', 'published')
        // Not over yet (the exact window is applied in buildClientNotices).
        .gt('ends_at', new Date(now).toISOString())
        .order('starts_at', { ascending: false })
        .limit(NOTICE_LIMITS.feed * 3)
    const [first, dismissals, acks] = await Promise.all([
      read(NOTICE_COLUMNS),
      supabase.from('product_notice_dismissals').select('notice_id').eq('user_id', opts.userId).limit(1000),
      // Migration 069; an error (not applied yet) just means "nothing acknowledged".
      supabase.from('product_notice_acks').select('notice_id').eq('user_id', opts.userId).limit(1000),
    ])
    // Migration 069 not applied yet: read the 045 columns (announcements keep working).
    const notices = isMissingColumnError(first.error) ? await read(NOTICE_COLUMNS_045) : first
    if (notices.error || dismissals.error) {
      const error = notices.error ?? dismissals.error
      if (!isMissingTableError(error)) console.warn(`announcements: not loaded (${error?.message ?? 'unknown error'})`)
      return null
    }
    const dismissedIds = new Set(((dismissals.data ?? []) as { notice_id: string }[]).map((r) => r.notice_id))
    return buildClientNotices((notices.data ?? []) as unknown as NoticeRow[], {
      locale: opts.locale,
      enabledModuleIds: opts.enabledModuleIds,
      dismissedIds,
      now,
      projectId: opts.projectId ?? null,
      userId: opts.userId,
      acknowledgedIds: new Set(acks.error ? [] : ((acks.data ?? []) as { notice_id: string }[]).map((r) => r.notice_id)),
    }).slice(0, NOTICE_LIMITS.feed)
  } catch (e) {
    console.warn(`announcements: not loaded (${e instanceof Error ? e.message : String(e)})`)
    return null
  }
}
