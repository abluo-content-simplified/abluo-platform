/**
 * GET /api/cron/billing-sync — ADR-041 D11: nightly reconcile with Stripe.
 * Re-syncs every non-terminal subscription of this environment's mode (and its
 * latest invoice) and retries webhook events stuck in received/failed. Sends no
 * emails (D5). Idempotent.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, like the other cron routes.
 * Billing not configured here → 200 with `skipped` (nothing to reconcile).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveAccessEnvironment } from '@/lib/access/environment'
import { bearerMatches } from '@/lib/api/shared-secret'
import { getStripe } from '@/lib/billing/stripe/client'
import { createSupabaseStore, stripeApi } from '@/lib/billing/stripe/store'
import { reconcileBilling } from '@/lib/billing/stripe/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ ok: true, skipped: 'billing not configured', ranAt: new Date().toISOString() })
  try {
    const livemode = resolveAccessEnvironment() === 'production'
    const result = await reconcileBilling({ store: createSupabaseStore(), stripe: stripeApi(stripe), livemode })
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() })
  } catch (e) {
    console.error('[billing] reconcile failed:', e instanceof Error ? e.message : 'error')
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
