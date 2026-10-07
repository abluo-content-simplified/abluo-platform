/**
 * Dashboard provider — Forms / contact requests. One read through the existing
 * enforced `getDashboardSubmissions` (assertModuleAction forms.submission.read
 * → RLS-backed session client). Home calls it only when the requests tile or
 * the requests attention rule is visible.
 */
import { getDashboardSubmissions, type DashboardSubmission } from '@/lib/api/client-dashboard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { settle } from '@/lib/api/dashboard/settle'
import { newRequestsRule, type AttentionItem } from '@/lib/client/attention'
import { requestCounts, requestTrend } from '@/lib/client/home-cards'

/** Newest requests read for Home (enough for two weeks on every current site; the delta hides itself when not). */
export const REQUESTS_READ_LIMIT = 200

export type RequestsGlance = { week: number; previousWeek: number | null; open: number }

export type FormsDashboard = { glance: RequestsGlance | null; attention: AttentionItem[] }

/** Pure: the tile and the attention item from the rows read. */
export function summarizeRequests(
  rows: readonly Pick<DashboardSubmission, 'status' | 'createdAt'>[],
  opts: { limit: number; attentionHref: string | null; now?: number },
): FormsDashboard {
  const now = opts.now ?? Date.now()
  const trend = requestTrend(rows, opts.limit, now)
  const { open } = requestCounts(rows, now)
  const item = opts.attentionHref ? newRequestsRule(rows, opts.attentionHref, now) : null
  return { glance: { week: trend.week, previousWeek: trend.previous, open }, attention: item ? [item] : [] }
}

export async function getFormsDashboard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { attentionHref: string | null },
): Promise<FormsDashboard | null> {
  const rows = await settle('forms.requests', () => getDashboardSubmissions(ctx, projectId, { limit: REQUESTS_READ_LIMIT }))
  if (!rows) return null
  return summarizeRequests(rows, { limit: REQUESTS_READ_LIMIT, attentionHref: opts.attentionHref })
}
