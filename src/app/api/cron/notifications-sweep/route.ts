/**
 * GET /api/cron/notifications-sweep — ADR-050: the message email digest (D11)
 * and message-file retention (D7). Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}`; anything else is rejected.
 */
import { NextRequest, NextResponse } from 'next/server'
import { bearerMatches } from '@/lib/api/shared-secret'
import { sweepNotificationDigest } from '@/lib/notification-center/digest'
import { sweepMessageFiles } from '@/lib/messages/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result: Record<string, unknown> = { ok: true, sweptAt: new Date().toISOString() }
  try {
    result.digest = await sweepNotificationDigest()
  } catch (err) {
    console.error('[cron/notifications-sweep] digest error:', err)
    result.ok = false
    result.digest = { error: 'failed' }
  }
  try {
    result.retention = { deleted: await sweepMessageFiles() }
  } catch (err) {
    console.error('[cron/notifications-sweep] retention error:', err)
    result.ok = false
    result.retention = { error: 'failed' }
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
