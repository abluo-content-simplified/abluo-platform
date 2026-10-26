/**
 * GET /api/cron/site-access-sweep — ADR-040 B2.4: daily removal of abandoned
 * uploads and replaced files from the private Access bucket. Never touches an
 * active document (see src/lib/access/sweep.ts).
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` (same as the other
 * cron routes). Idempotent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { withSiteAccessStore } from '@/lib/access/server'
import { sweepSiteAccessFiles } from '@/lib/access/sweep'
import { AccessError } from '@/lib/access/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await withSiteAccessStore('daily sweep: remove abandoned uploads and replaced protected files', (store, files) =>
      sweepSiteAccessFiles(store, files)
    )
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() })
  } catch (err) {
    // Deployed before migration 052 is applied: nothing to sweep yet — not an error.
    if (err instanceof AccessError && err.code === 'unavailable' && /not installed/.test(err.message)) {
      return NextResponse.json({ ok: true, skipped: 'site access tables not installed', ranAt: new Date().toISOString() })
    }
    console.error('[site-access] sweep failed:', err instanceof Error ? err.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
