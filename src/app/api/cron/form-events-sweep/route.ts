/**
 * GET /api/cron/form-events-sweep — ADR-019 recovery sweep.
 *
 * Re-drives production form_events left in pending/failed (webhook missed or
 * errored), so a webhook delivery failure can never lose a notification. Runs
 * on the production deployment via a Vercel Cron Job (see vercel.json). Only
 * production events are considered (the consumer's environment gate + the
 * sweep query both filter to environment='production').
 *
 * Auth: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` for
 * scheduled Cron Jobs (same pattern as /api/cron/keep-alive). Reject anything
 * else so this can't be triggered publicly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sweepFormEvents } from '@/lib/notifications/consumer'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepFormEvents()
    return NextResponse.json({ ok: true, ...result, sweptAt: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/form-events-sweep] error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
