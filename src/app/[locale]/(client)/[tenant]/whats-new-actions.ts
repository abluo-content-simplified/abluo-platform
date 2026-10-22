'use server'

/**
 * "What's new" — mark the updates a person just saw as read (ADR-030,
 * migration 035).
 *
 * Runs with the person's OWN session client, never the service role: RLS on
 * product_update_reads only lets them insert rows for themselves
 * (user_id = auth.uid()) and only for a published update. The user id comes
 * from the session, never from the request. Idempotent (existing marks are
 * ignored). Never throws: a failure only means the dot shows again next time.
 */
import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 100

export async function markUpdatesReadAction(ids: string[]): Promise<{ ok: boolean }> {
  if (!Array.isArray(ids)) return { ok: false }
  const clean = [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))].slice(0, MAX_IDS)
  if (clean.length === 0) return { ok: true }
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false }
    const { error } = await supabase
      .from('product_update_reads')
      .upsert(
        clean.map((update_id) => ({ user_id: user.id, update_id })),
        { onConflict: 'user_id,update_id', ignoreDuplicates: true },
      )
    if (error) {
      console.warn(`what's new: read marks not saved (${error.message})`)
      return { ok: false }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/**
 * Close an INFO announcement for this person (migration 045). Warnings cannot
 * be closed: the notice is read under the person's own RLS and refused unless
 * it is a published info notice. Idempotent; never throws.
 */
export async function dismissNoticeAction(id: string): Promise<{ ok: boolean }> {
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false }
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false }
    const { data: notice } = await supabase.from('product_notices').select('id, tone').eq('id', id).maybeSingle()
    if (!notice || (notice as { tone: string }).tone !== 'info') return { ok: false }
    const { error } = await supabase
      .from('product_notice_dismissals')
      .upsert({ user_id: user.id, notice_id: id }, { onConflict: 'user_id,notice_id', ignoreDuplicates: true })
    if (error) {
      console.warn(`announcements: dismissal not saved (${error.message})`)
      return { ok: false }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
