/**
 * GET /api/cron/media-sweep — ADR-035 slice 2: daily clean-up of background
 * uploads (stuck → failed; old, unreferenced failed placeholders deleted).
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` (same as the other
 * cron routes). Idempotent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { sweepMediaUploads } from '@/lib/media/sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await sweepMediaUploads(sanityWriteClient)
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() })
  } catch (err) {
    console.error('[media] sweep failed:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
