// Server-only: service-role reads behind requireAbluoAdmin. Never import from a client component.
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAdminAudit } from '@/lib/admin/audit'
import { loadAnalyticsIds } from '@/lib/analytics/config'
import { addDays, isoDay, WINDOW_DAYS } from '@/lib/analytics/periods'
import { isMissingTable, readSnapshotRows } from '@/lib/analytics/read'
import { refreshProjectAnalytics, type RefreshResult } from '@/lib/analytics/snapshot'
import type { SnapshotRow } from '@/lib/analytics/types'
import {
  portfolioRow,
  portfolioSummary,
  projectAnalyticsView,
  type PortfolioRow,
  type PortfolioSummary,
  type ProjectAnalyticsView,
} from '@/lib/analytics/view'

/**
 * Admin analytics reads (ADR-030 §5.2). Every function:
 *   1. calls requireAbluoAdmin() FIRST and returns null when refused (the
 *      (admin) layout gate is the first line; this is the second);
 *   2. reads with the service role (snapshots are server-only for admins);
 *   3. records the view in the admin audit log when asked to.
 * Never calls Google, except `refreshProjectNow` (the "Refresh now" action).
 */

/** Sites in the portfolio: the ones the daily job covers. */
const PORTFOLIO_STATUSES = ['active', 'preview']
/** Portfolio reads only recent snapshots (the job writes daily; older = stale anyway). */
const PORTFOLIO_LOOKBACK_DAYS = 7

type ProjectRef = { id: string; slug: string; name: string; status: string }

/** Only the metric parts the list needs — not top pages / queries — to keep the read small. */
const PORTFOLIO_COLUMNS =
  'project_id, source, period_start, period_end, status, error, fetched_at, ' +
  'current:metrics->current, previous:metrics->previous, last7:metrics->last7, previous7:metrics->previous7, ' +
  'top_channels:metrics->top_channels, daily:metrics->daily'

type SlimRow = Omit<SnapshotRow, 'metrics'> & Record<'current' | 'previous' | 'last7' | 'previous7' | 'top_channels' | 'daily', unknown>

function fromSlim(r: SlimRow): SnapshotRow {
  const { current, previous, last7, previous7, top_channels, daily, ...rest } = r
  return { ...rest, metrics: (r.status === 'ok' ? { current, previous, last7, previous7, top_channels, daily } : {}) as SnapshotRow['metrics'] }
}

export type AdminPortfolio = {
  rows: PortfolioRow[]
  summary: PortfolioSummary
  /** False when migration 036 is not applied yet. */
  ready: boolean
}

/** Contact requests per project in the last 28 days (complete, not spam). Null when the read fails. */
async function requestCounts(db: ReturnType<typeof createAdminClient>, projectIds: string[], since: string): Promise<Map<string, number> | null> {
  if (!projectIds.length) return new Map()
  const { data, error } = await db
    .from('form_submissions')
    .select('project_id')
    .in('project_id', projectIds)
    .eq('completion_state', 'complete')
    .neq('status', 'spam')
    .gte('created_at', `${since}T00:00:00Z`)
    .limit(50000)
  if (error) return null
  const out = new Map<string, number>()
  for (const r of (data ?? []) as { project_id: string }[]) out.set(r.project_id, (out.get(r.project_id) ?? 0) + 1)
  return out
}

export async function getAdminPortfolio(opts: { audit?: boolean; now?: number } = {}): Promise<AdminPortfolio | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const now = opts.now ?? Date.now()
  const db = createAdminClient()

  const { data: projects, error } = await db.from('projects').select('id, slug, name, status').in('status', PORTFOLIO_STATUSES).order('name')
  if (error) throw new Error(`projects read failed: ${error.message}`)
  const list = (projects ?? []) as ProjectRef[]
  const ids = list.map((p) => p.id)
  const today = isoDay(new Date(now))

  let ready = true
  let snapshots: SnapshotRow[] = []
  if (ids.length) {
    const res = await db
      .from('analytics_snapshots')
      .select(PORTFOLIO_COLUMNS)
      .in('project_id', ids)
      .gte('period_end', addDays(today, -PORTFOLIO_LOOKBACK_DAYS))
    if (res.error) {
      if (!isMissingTable(res.error)) throw new Error(`analytics_snapshots read failed: ${res.error.message}`)
      ready = false
    } else snapshots = ((res.data ?? []) as unknown as SlimRow[]).map(fromSlim)
  }
  const requests = await requestCounts(db, ids, addDays(today, -WINDOW_DAYS))

  const byProject = new Map<string, SnapshotRow[]>()
  for (const r of snapshots) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r])
  const views = new Map<string, ProjectAnalyticsView>()
  const rows = list.map((p) => {
    const mine = byProject.get(p.id) ?? []
    views.set(p.id, projectAnalyticsView(mine, now))
    return portfolioRow(p, mine, requests ? (requests.get(p.id) ?? 0) : null, now)
  })

  if (opts.audit) await recordAdminAudit({ actorId: actor.userId, action: 'analytics.portfolio.view', detail: { sites: rows.length } })
  return { rows, summary: portfolioSummary(rows, views), ready }
}

export type AdminProjectAnalytics = {
  project: { id: string; slug: string; name: string; status: string }
  view: ProjectAnalyticsView
  /** What is configured in Studio right now (live read, not the snapshot). */
  config: { ga4PropertyId: string | null; gscSiteUrl: string | null }
}

async function projectBy(db: ReturnType<typeof createAdminClient>, by: { slug: string } | { id: string }): Promise<ProjectRef | null> {
  const q = db.from('projects').select('id, slug, name, status')
  const { data, error } = 'slug' in by ? await q.eq('slug', by.slug).limit(2) : await q.eq('id', by.id).limit(1)
  if (error) throw new Error(`projects read failed: ${error.message}`)
  const rows = (data ?? []) as ProjectRef[]
  // Slugs are unique per client only (migration 023): an ambiguous slug is refused, never guessed.
  return rows.length === 1 ? rows[0] : null
}

/** One project's analytics for the admin, by slug (Analytics → site) or id (Project page block). */
export async function getAdminProjectAnalytics(
  by: { slug: string } | { id: string },
  opts: { audit?: boolean; now?: number } = {},
): Promise<AdminProjectAnalytics | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const db = createAdminClient()
  const project = await projectBy(db, by)
  if (!project) return null
  const [rows, ids] = await Promise.all([
    readSnapshotRows(db, project.id),
    loadAnalyticsIds([project.slug]).catch(() => new Map<string, { ga4PropertyId: string | null; gscSiteUrl: string | null }>()),
  ])
  if (opts.audit) await recordAdminAudit({ actorId: actor.userId, action: 'project.analytics.view', projectId: project.id })
  return {
    project,
    view: projectAnalyticsView(rows, opts.now),
    config: ids.get(project.slug) ?? { ga4PropertyId: null, gscSiteUrl: null },
  }
}

/** "Refresh now" for one project: the daily job's work, immediately. */
export async function refreshProjectNow(slug: string): Promise<RefreshResult | null> {
  const actor = await requireAbluoAdmin()
  if (!actor) return null
  const project = await projectBy(createAdminClient(), { slug })
  if (!project) return null
  const ids = await loadAnalyticsIds([project.slug])
  const cfg = ids.get(project.slug) ?? { ga4PropertyId: null, gscSiteUrl: null }
  return refreshProjectAnalytics({ projectId: project.id, slug: project.slug, ...cfg })
}
