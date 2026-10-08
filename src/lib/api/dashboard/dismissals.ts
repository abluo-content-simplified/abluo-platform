/**
 * Things a person has hidden on their dashboard, per project (migration 039,
 * `dashboard_dismissals`). First use: "Hide checklist" on Home.
 *
 * Read and written AS the person (their session client): RLS lets each person
 * see and add only their own rows, and only for a project they belong to. The
 * user id comes from the server-side session, never from the request.
 *
 * Safe before the migration is applied: a missing table reads as
 * "not available" (the card then simply offers no Hide button).
 */
import { createClient } from '@/lib/supabase/server'

/** Keys are code constants, never user input. Matches the CHECK in migration 039. */
export const DISMISSAL_KEY_PATTERN = /^[a-z][a-zA-Z0-9.-]{0,63}$/
export const SETUP_CHECKLIST_DISMISSAL = 'setupChecklist'

export type DismissalState = { available: boolean; dismissed: boolean }

type Db = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A missing table (migration 039 not applied yet) → "not available", never an error page. */
export function isMissingDismissalsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return error.code === '42P01' || error.code === 'PGRST205' || (/dashboard_dismissals/.test(msg) && /exist|schema cache/.test(msg))
}

export async function readDismissal(
  userId: string,
  projectId: string,
  key: string,
  deps: { client?: Db } = {},
): Promise<DismissalState> {
  if (!DISMISSAL_KEY_PATTERN.test(key)) return { available: false, dismissed: false }
  try {
    const db = deps.client ?? ((await createClient()) as unknown as Db)
    const { data, error } = await db
      .from('dashboard_dismissals')
      .select('key')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .eq('key', key)
      .maybeSingle()
    if (error) {
      if (!isMissingDismissalsTable(error)) console.warn(`[dashboard] dismissal read failed (${error.message ?? 'unknown'})`)
      return { available: false, dismissed: false }
    }
    return { available: true, dismissed: Boolean(data) }
  } catch {
    return { available: false, dismissed: false }
  }
}

/** Idempotent: hiding twice is fine. */
export async function writeDismissal(
  userId: string,
  projectId: string,
  key: string,
  deps: { client?: Db } = {},
): Promise<boolean> {
  if (!DISMISSAL_KEY_PATTERN.test(key)) return false
  try {
    const db = deps.client ?? ((await createClient()) as unknown as Db)
    const { error } = await db
      .from('dashboard_dismissals')
      .upsert({ user_id: userId, project_id: projectId, key }, { onConflict: 'user_id,project_id,key', ignoreDuplicates: true })
    if (error) {
      console.warn(`[dashboard] dismissal not saved (${error.message ?? 'unknown'})`)
      return false
    }
    return true
  } catch {
    return false
  }
}
