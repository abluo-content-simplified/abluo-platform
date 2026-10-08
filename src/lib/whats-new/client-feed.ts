/**
 * "What's new" for the signed-in client (ADR-030, migration 035). Server-only.
 *
 * Read AS the user — their session client, no service role. RLS lets them see
 * published updates only, and only their own read marks. The layout calls
 * this on every client page, so it must never break the page: a missing table
 * (migration 035 not applied: 42P01 / PGRST205) or any other failure returns
 * null and the dashboard simply shows no "What's new" entry.
 */
import { createClient } from '@/lib/supabase/server'
import {
  buildClientFeed,
  isMissingTableError,
  PRODUCT_UPDATE_COLUMNS,
  WHATS_NEW_LIMITS,
  type ClientProductUpdate,
  type ProductUpdateRow,
} from './model'

export type WhatsNewFeed = { updates: ClientProductUpdate[] }

export async function loadWhatsNewFeed(opts: {
  userId: string
  locale: string
  enabledModuleIds: readonly string[]
}): Promise<WhatsNewFeed | null> {
  try {
    const supabase = await createClient()
    const [updates, reads] = await Promise.all([
      supabase
        .from('product_updates')
        .select(PRODUCT_UPDATE_COLUMNS)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(WHATS_NEW_LIMITS.feed),
      supabase.from('product_update_reads').select('update_id').eq('user_id', opts.userId).limit(1000),
    ])
    if (updates.error || reads.error) {
      const error = updates.error ?? reads.error
      if (!isMissingTableError(error)) console.warn(`what's new: not loaded (${error?.message ?? 'unknown error'})`)
      return null
    }
    const readIds = new Set(((reads.data ?? []) as { update_id: string }[]).map((r) => r.update_id))
    return {
      updates: buildClientFeed((updates.data ?? []) as ProductUpdateRow[], {
        locale: opts.locale,
        enabledModuleIds: opts.enabledModuleIds,
        readIds,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      }),
    }
  } catch (e) {
    console.warn(`what's new: not loaded (${e instanceof Error ? e.message : String(e)})`)
    return null
  }
}
