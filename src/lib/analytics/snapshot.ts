// Server-only: writes snapshots with the service role and calls Google.
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { readAllRowsOrThrow } from '@/lib/supabase/read-all'
import { loadAnalyticsIds } from './config'
import { fetchGa4Metrics } from './ga4'
import { AnalyticsConfigError, getGoogleAccessToken } from './google-auth'
import { fetchGscMetrics } from './gsc'
import { isoDay, snapshotWindows } from './periods'
import type { AnalyticsProjectConfig, AnalyticsSource, SnapshotRow, SnapshotWindows } from './types'

/**
 * The daily snapshot (ADR-029 §3.4): for one project, read GA4 and Search
 * Console once and upsert one `analytics_snapshots` row per source for the
 * window ending yesterday. Never throws for a Google-side problem — the
 * failure becomes an `error` row with the message, so the admin sees it.
 *
 *   not_connected  no property ID / site URL configured in Studio
 *   error          configured, but the call failed (message in `error`)
 *   ok             metrics written
 */

export type RefreshDeps = {
  fetch?: typeof fetch
  now?: () => Date
  getToken?: () => Promise<string>
  write?: (rows: SnapshotRow[]) => Promise<void>
}

export type RefreshResult = { projectId: string; slug: string; ga4: SnapshotRow['status']; gsc: SnapshotRow['status']; errors: string[] }

/** Errors are stored and shown to admins: keep them one line and short. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Unknown error'
}

export async function writeSnapshots(rows: SnapshotRow[]): Promise<void> {
  if (!rows.length) return
  await runAsTrustedSystemOperation('analytics cron: upsert daily GA4/Search Console snapshot rows (migration 036)', async (db) => {
    const { error } = await db.from('analytics_snapshots').upsert(rows, { onConflict: 'project_id,source,period_end' })
    if (error) throw new Error(`analytics_snapshots upsert failed: ${error.message}`)
  })
}

function row(
  project: AnalyticsProjectConfig,
  source: AnalyticsSource,
  w: SnapshotWindows,
  fetchedAt: string,
  part: Pick<SnapshotRow, 'status' | 'metrics' | 'error'>,
): SnapshotRow {
  return { project_id: project.projectId, source, period_start: w.current.start, period_end: w.current.end, fetched_at: fetchedAt, ...part }
}

export async function refreshProjectAnalytics(project: AnalyticsProjectConfig, deps: RefreshDeps = {}): Promise<RefreshResult> {
  const now = (deps.now ?? (() => new Date()))()
  const w = snapshotWindows(now)
  const fetchedAt = now.toISOString()
  const f = deps.fetch ?? fetch

  // One token for both sources, asked for only when something is configured.
  let tokenPromise: Promise<string> | null = null
  const token = () => (tokenPromise ??= (deps.getToken ?? (() => getGoogleAccessToken({ fetch: f })))())

  const one = async (
    source: AnalyticsSource,
    id: string | null,
    load: (id: string, token: string) => Promise<SnapshotRow['metrics']>,
  ): Promise<SnapshotRow> => {
    if (!id) return row(project, source, w, fetchedAt, { status: 'not_connected', metrics: {}, error: null })
    try {
      return row(project, source, w, fetchedAt, { status: 'ok', metrics: await load(id, await token()), error: null })
    } catch (e) {
      if (!(e instanceof AnalyticsConfigError)) console.warn(`[analytics] ${project.slug} ${source}: ${errorText(e)}`)
      return row(project, source, w, fetchedAt, { status: 'error', metrics: {}, error: errorText(e) })
    }
  }

  const rows = await Promise.all([
    one('ga4', project.ga4PropertyId, (id, t) => fetchGa4Metrics(id, w, t, f)),
    one('gsc', project.gscSiteUrl, (id, t) => fetchGscMetrics(id, w, t, f)),
  ])
  await (deps.write ?? writeSnapshots)(rows)
  return {
    projectId: project.projectId,
    slug: project.slug,
    ga4: rows[0].status,
    gsc: rows[1].status,
    errors: rows.filter((r) => r.error).map((r) => `${r.source}: ${r.error}`),
  }
}

/** Run `fn` over `items` with at most `limit` in flight. Order of results = order of items. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Projects the daily job covers: live and preview sites. */
export const SNAPSHOT_PROJECT_STATUSES = ['active', 'preview'] as const
export const SNAPSHOT_CONCURRENCY = 3

type ProjectRow = { id: string; slug: string }

/** Every active + preview project with its reporting IDs. */
export async function listSnapshotProjects(
  deps: { projects?: () => Promise<ProjectRow[]>; ids?: typeof loadAnalyticsIds } = {},
): Promise<AnalyticsProjectConfig[]> {
  const projects =
    (await deps.projects?.()) ??
    (await runAsTrustedSystemOperation('analytics cron: list active/preview projects to snapshot', async (db) => {
      // Paged: PostgREST returns at most 1000 rows per request.
      return readAllRowsOrThrow<ProjectRow>('projects read failed', (from, to) =>
        db.from('projects').select('id, slug').in('status', [...SNAPSHOT_PROJECT_STATUSES]).order('id').range(from, to),
      )
    }))
  const ids = await (deps.ids ?? loadAnalyticsIds)(projects.map((p) => p.slug))
  return projects.map((p) => ({
    projectId: p.id,
    slug: p.slug,
    ga4PropertyId: ids.get(p.slug)?.ga4PropertyId ?? null,
    gscSiteUrl: ids.get(p.slug)?.gscSiteUrl ?? null,
  }))
}

/** The whole daily run. Per-project failures are isolated (a failed write is reported, never thrown). */
export async function refreshAllProjects(deps: RefreshDeps & { list?: () => Promise<AnalyticsProjectConfig[]> } = {}) {
  const projects = await (deps.list ?? listSnapshotProjects)()
  const results = await mapLimited(projects, SNAPSHOT_CONCURRENCY, async (p) => {
    try {
      return await refreshProjectAnalytics(p, deps)
    } catch (e) {
      return { projectId: p.projectId, slug: p.slug, ga4: 'error', gsc: 'error', errors: [`write: ${errorText(e)}`] } as RefreshResult
    }
  })
  return {
    day: isoDay((deps.now ?? (() => new Date()))()),
    projects: results.length,
    withData: results.filter((r) => r.ga4 === 'ok' || r.gsc === 'ok').length,
    notConnected: results.filter((r) => r.ga4 === 'not_connected' && r.gsc === 'not_connected').length,
    errors: results.filter((r) => r.errors.length).map((r) => ({ slug: r.slug, errors: r.errors })),
  }
}
