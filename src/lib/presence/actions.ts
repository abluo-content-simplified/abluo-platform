'use server'

import { getLocale } from 'next-intl/server'
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
    // ADR-050 D11: remember the dashboard language for the email digest (own row; no-op when unchanged).
    const locale = await getLocale().catch(() => null)
    if (locale === 'en' || locale === 'it' || locale === 'de') await supabase.rpc('set_interface_locale', { p_locale: locale })
  } catch {
    /* migration 049 / 069 not applied, offline … — ignore */
  }
}
