/**
 * GET /api/cron/support-tickets-sweep — ADR-039: re-drives pending/failed
 * ticket emails and deletes expired screenshots. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { sweepTicketOutbox } from '@/lib/support-tickets/notifications'
import { purgeExpiredAttachments } from '@/lib/support-tickets/retention'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result: Record<string, unknown> = { ok: true, sweptAt: new Date().toISOString() }
  try {
    result.notifications = await sweepTicketOutbox()
  } catch (err) {
    console.error('[cron/support-tickets-sweep] notifications error:', err)
    result.ok = false
    result.notifications = { error: 'failed' }
  }
  try {
    result.retention = await purgeExpiredAttachments()
  } catch (err) {
    console.error('[cron/support-tickets-sweep] retention error:', err)
    result.ok = false
    result.retention = { error: 'failed' }
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
