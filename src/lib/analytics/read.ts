// Server-only: session-scoped Supabase reads for the client dashboard.
import { projectDataClient } from '@/lib/support/data-client'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { projectAnalyticsView, type ProjectAnalyticsView } from './view'
import type { SnapshotRow } from './types'

/**
 * Client-dashboard read of a project's analytics (ADR-029 §3.4).
 *
 * Same enforcement chain as contact requests (getDashboardSubmissions):
 *   1. the caller's grant on this project must carry `analytics.read`
 *      (Owner, Site admin, or an Editor with the extra) — checked here, before
 *      any I/O;
 *   2. the read goes through the person's own RLS-backed session, whose policy
 *      (migration 036) asks the database the same question.
 * Never calls Google: it reads the stored daily snapshot.
 */

export const ANALYTICS_READ_PERMISSION = 'analytics.read'

/** Rows read per project: two sources × the last ~3 weeks of daily snapshots, enough to find the latest good one. */
const ROWS_PER_PROJECT = 40

export const SNAPSHOT_COLUMNS = 'project_id, source, period_start, period_end, status, metrics, error, fetched_at'

type Reader = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A missing table (migration 036 not applied yet) reads as "nothing yet", never as an error page. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return error.code === '42P01' || error.code === 'PGRST205' || (/analytics_snapshots/.test(msg) && /exist|schema cache/.test(msg))
}

export function canReadAnalytics(grant: { permissions: readonly string[] } | null | undefined): boolean {
  return Boolean(grant?.permissions.includes(ANALYTICS_READ_PERMISSION))
}

export async function readSnapshotRows(db: Reader, projectId: string): Promise<SnapshotRow[]> {
  const { data, error } = await db
    .from('analytics_snapshots')
    .select(SNAPSHOT_COLUMNS)
    .eq('project_id', projectId)
    .order('period_end', { ascending: false })
    .limit(ROWS_PER_PROJECT)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(`analytics_snapshots read failed: ${error.message ?? 'unknown'}`)
  }
  return (data ?? []) as SnapshotRow[]
}

export async function getProjectAnalytics(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: { client?: Reader; now?: number } = {},
): Promise<ProjectAnalyticsView> {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant || !canReadAnalytics(grant)) {
    throw new TenantAuthorizationError(`analytics.read refused for project "${projectId}"`)
  }
  const db = deps.client ?? ((await projectDataClient(ctx, projectId)) as unknown as Reader)
  return projectAnalyticsView(await readSnapshotRows(db, projectId), deps.now)
}
