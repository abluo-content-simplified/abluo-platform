/**
 * GET /api/cron/analytics — the daily website analytics snapshot (ADR-029 §3.4).
 *
 * For every active and preview project: read GA4 (Data API) and Search Console
 * once with the Abluo service account and upsert one `analytics_snapshots` row
 * per source for the 28 days ending yesterday (migration 036). The dashboards
 * read those rows; nothing calls Google on page load.
 *
 * Runs on the production deployment via a Vercel Cron Job (vercel.json, once a
 * day, early morning UTC). Auth: Vercel sends `Authorization: Bearer
 * ${CRON_SECRET}` (same pattern as the other cron routes); anything else → 401.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { refreshAllProjects } from '@/lib/analytics/snapshot'

export const dynamic = 'force-dynamic'
/** Many sites × a few Google calls each, three at a time. */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await refreshAllProjects()
    if (result.errors.length) console.warn('[cron/analytics] errors:', JSON.stringify(result.errors))
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/analytics] error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
