'use server'

import { runGoogleSetup, type GoogleSetupWhich } from '@/lib/admin/google'
import type { GoogleSetupCode, GoogleSetupParams } from '@/lib/google/errors'

/** One row's result, as the card shows it. */
export type GoogleRowResult =
  | { state: 'connected' }
  | { state: 'waiting_for_site' | 'error'; code: GoogleSetupCode; message: string; params: GoogleSetupParams }

export type GoogleSetupActionState = {
  status: 'idle' | 'done' | 'refused' | 'failed'
  analytics?: GoogleRowResult
  searchConsole?: GoogleRowResult
}

const WHICH: readonly GoogleSetupWhich[] = ['analytics', 'search_console', 'both']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Set up Analytics" / "Connect Search Console" / "Set up both" on the admin
 * project page. `runGoogleSetup` calls requireAbluoAdmin() first — anything
 * else gets 'refused' and nothing runs. Each run is in the admin audit log.
 */
export async function googleSetupAction(_prev: GoogleSetupActionState, formData: FormData): Promise<GoogleSetupActionState> {
  const projectId = formData.get('projectId')
  const which = formData.get('which')
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId) || !WHICH.includes(which as GoogleSetupWhich)) return { status: 'refused' }
  try {
    const run = await runGoogleSetup(projectId, which as GoogleSetupWhich)
    if (!run) return { status: 'refused' }
    const row = (o: typeof run.analytics): GoogleRowResult | undefined =>
      !o ? undefined : o.state === 'connected' ? { state: 'connected' } : { state: o.state, code: o.code, message: o.message, params: o.params }
    return { status: 'done', analytics: row(run.analytics), searchConsole: row(run.searchConsole) }
  } catch (e) {
    console.error('[admin/google] setup failed:', e)
    return { status: 'failed' }
  }
}
