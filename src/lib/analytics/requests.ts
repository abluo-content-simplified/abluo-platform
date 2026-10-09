// Server-only: contact requests over time for the Analytics page (analytics v2, Tom 2026-10-09).
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { FORMS_SUBMISSION_READ_PERMISSION } from '@/lib/api/client-dashboard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { projectDataClient } from '@/lib/support/data-client'
import { requestStats, type RequestRow, type RequestStats } from './request-stats'

/**
 * Contact requests on the Analytics page: how many in the last 28 days vs the
 * 28 before, per day, and the pages they were sent from. Our own data
 * (form_submissions), not Google's — complete, non-spam submissions only, the
 * same rule as the Contact requests list and the admin portfolio count.
 *
 * Client side, it needs BOTH the analytics page's permission (checked by the
 * page) AND `forms.submission.read` with the Forms module installed — an
 * Editor who may see analytics but not leads gets null here, never a count.
 * The read goes through the person's own RLS-backed session (or, in a support
 * visit, the service role scoped to this one project).
 */

/** Two windows of 28 days; a small site's requests fit far below this. */
const MAX_ROWS = 2000

type Reader = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

export async function readRequestRows(db: Reader, projectId: string, since: string): Promise<RequestRow[]> {
  const { data, error } = await db
    .from('form_submissions')
    .select('created_at, page_path:source->>page_path')
    .eq('project_id', projectId)
    .eq('completion_state', 'complete')
    .neq('status', 'spam')
    .gte('created_at', `${since}T00:00:00Z`)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)
  if (error) throw new Error(`form_submissions read failed: ${error.message ?? 'unknown'}`)
  return (data ?? []) as RequestRow[]
}

export function canSeeRequests(ctx: TenantAuthorizationContext, projectId: string): boolean {
  try {
    assertModuleAction(ctx, projectId, FORMS_SUBMISSION_READ_PERMISSION)
    return true
  } catch {
    return false
  }
}

/** Null when the caller may not see contact requests (or the Forms module is off). */
export async function getProjectRequestStats(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: { client?: Reader; now?: number } = {},
): Promise<RequestStats | null> {
  if (!canSeeRequests(ctx, projectId)) return null
  const now = deps.now ?? Date.now()
  const db = deps.client ?? ((await projectDataClient(ctx, projectId)) as unknown as Reader)
  const stats = requestStats([], now)
  return requestStats(await readRequestRows(db, projectId, stats.since), now)
}
