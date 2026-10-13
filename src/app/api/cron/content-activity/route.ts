/**
 * GET /api/cron/content-activity — ADR-032 D9 amendment A4/A5 (slice 3b).
 *
 * Daily: (1) reconciliation — every publication change in Sanity's history
 * (last 26 h, settled for 1 h) without an Activity row is recorded late:
 * a person's Studio change as "the Abluo team", anything written with the
 * dashboard's token that the dashboard did not record as unattributed (never
 * a person) — and both surface on the admin Home under "Needs your
 * attention"; (2) retention — deletes rows past the PROVISIONAL periods.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` (same as the other
 * cron routes). Runs wherever the cron is scheduled; idempotent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { reconcileActivity, retentionCutoffs } from '@/lib/lifecycle/studio-activity'
import { createSupabaseActivityStore } from '@/lib/lifecycle/activity-store'
import { dashboardSanityIdentity, documentAt, transactionsBetween } from '@/lib/sanity/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const store = createSupabaseActivityStore()
  try {
    const reconciled = await reconcileActivity({
      store,
      dashboardIdentity: () => dashboardSanityIdentity(),
      transactionsBetween: (from, to, limit) => transactionsBetween(from, to, limit),
      documentAt: (id, at) => documentAt(id, at),
    })
    const purged = await store.purge(retentionCutoffs(new Date()))
    if (reconciled.repairedStudio || reconciled.repairedUnattributed || reconciled.failed || reconciled.capped) {
      console.error(`[content-audit] reconciliation: ${JSON.stringify(reconciled)}`)
    }
    return NextResponse.json({ ok: true, reconciled, purged, ranAt: new Date().toISOString() })
  } catch (err) {
    console.error('[content-audit] reconciliation failed:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
