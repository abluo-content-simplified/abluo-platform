'use server'

import { refreshProjectNow } from '@/lib/admin/analytics'

export type RefreshActionState = { status: 'idle' | 'done' | 'refused' | 'failed'; ga4?: string; gsc?: string; errors?: string[] }

/**
 * Admin "Refresh now" (ADR-030 §5.2): run the daily snapshot for one site
 * immediately. `refreshProjectNow` calls requireAbluoAdmin() first — a
 * non-admin (or an admin without two-factor) gets 'refused' and nothing runs.
 */
export async function refreshAnalyticsAction(_prev: RefreshActionState, formData: FormData): Promise<RefreshActionState> {
  const slug = formData.get('slug')
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return { status: 'refused' }
  try {
    const result = await refreshProjectNow(slug)
    if (!result) return { status: 'refused' }
    return { status: 'done', ga4: result.ga4, gsc: result.gsc, errors: result.errors }
  } catch (e) {
    console.error('[admin/analytics] refresh failed:', e)
    return { status: 'failed' }
  }
}
