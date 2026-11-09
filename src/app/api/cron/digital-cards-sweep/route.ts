/**
 * GET /api/cron/digital-cards-sweep — ADR-049 D11: daily 13-month retention of
 * the Digital Cards statistics (digital_card_daily, migration 068).
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` (same as the other
 * cron routes). Idempotent. Migration 068 not applied → 200 with `skipped`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { sweep } from '@/lib/api/digital-card-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const deleted = await sweep()
    if (deleted === null) {
      return NextResponse.json({ ok: true, skipped: 'digital card statistics not installed', ranAt: new Date().toISOString() })
    }
    return NextResponse.json({ ok: true, deleted, ranAt: new Date().toISOString() })
  } catch (e) {
    console.error('[cron/digital-cards-sweep] failed:', e instanceof Error ? e.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
