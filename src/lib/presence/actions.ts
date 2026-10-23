'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * ADR-030 A1 — "I still have a dashboard open". Records `profiles.last_seen_at`
 * for the signed-in person through `touch_last_seen()` (own row only, at most
 * once every 2 minutes — the database decides, so calling more often is
 * harmless). Never throws: presence is a nicety, not part of any task.
 */
export async function touchLastSeen(): Promise<void> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data?.user) return
    await supabase.rpc('touch_last_seen')
  } catch {
    /* migration 049 not applied, offline … — ignore */
  }
}
