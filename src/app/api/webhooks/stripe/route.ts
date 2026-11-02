/**
 * POST /api/webhooks/stripe — inbound Stripe events (ADR-041 D11).
 *
 *   verify the signature on the RAW body → claim (duplicate → 200) → process
 *   (re-fetching from Stripe, see lib/billing/stripe/sync.ts) → finish.
 *
 * 400  missing / invalid signature or unreadable body
 * 503  billing is not configured in this environment (Stripe retries)
 * 500  a transient failure; the event is recorded `failed` and Stripe retries
 * 200  processed, ignored, a duplicate, or an event of the other mode
 *
 * The live endpoint is registered on https://www.abluo.app/… (the apex
 * redirects and Stripe does not follow redirects). `src/proxy.ts` leaves /api
 * alone.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveAccessEnvironment } from '@/lib/access/environment'
import { getStripe, stripeWebhookSecret } from '@/lib/billing/stripe/client'
import { createSupabaseStore, stripeApi } from '@/lib/billing/stripe/store'
import { ingestEvent, type StripeEventObj } from '@/lib/billing/stripe/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const secret = stripeWebhookSecret()
  if (!stripe || !secret) return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 })

  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let body: string
  try {
    body = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 })
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const livemode = resolveAccessEnvironment() === 'production'
  if (event.livemode !== livemode) return NextResponse.json({ ok: true, ignored: 'mode' })

  try {
    const result = await ingestEvent(
      { store: createSupabaseStore(), stripe: stripeApi(stripe), livemode },
      event as unknown as StripeEventObj,
    )
    if (result === 'failed') return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    console.error(`[billing] webhook ${event.id}: ${e instanceof Error ? e.message : 'error'}`)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
