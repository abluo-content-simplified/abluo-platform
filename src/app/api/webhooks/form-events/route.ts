/**
 * POST /api/webhooks/form-events — ADR-019 near-instant trigger.
 *
 * Target of the Supabase Database Webhook on INSERT into public.form_events.
 * Because dev/preview/prod share one Supabase project, this webhook is
 * configured ONCE, pointing at production; the consumer's environment gate
 * ensures only production events actually send (dev/preview events are marked
 * 'skipped'). The production cron sweep (/api/cron/form-events-sweep) re-drives
 * anything this webhook fails to deliver, so a webhook failure never loses a
 * notification.
 *
 * Auth: the Supabase webhook is configured with a custom header
 *   x-webhook-secret: <FORM_EVENTS_WEBHOOK_SECRET>
 * Anything without the matching secret is rejected — this endpoint is public.
 */
import { NextResponse } from 'next/server'
import { deliverEvent } from '@/lib/notifications/consumer'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = process.env.FORM_EVENTS_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-webhook-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { record?: { event_id?: string }; type?: string } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  const eventId = body?.record?.event_id
  if (!eventId) {
    // Not a form_events INSERT payload we handle — acknowledge without work.
    return NextResponse.json({ ok: true, skipped: 'no event_id in payload' })
  }

  try {
    const result = await deliverEvent(eventId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // Return 200 so Supabase does not hammer retries — the cron sweep is the
    // durable recovery path. Log for visibility.
    console.error('[webhooks/form-events] delivery error:', err)
    return NextResponse.json({ ok: false, error: 'delivery error (will be retried by sweep)' })
  }
}
