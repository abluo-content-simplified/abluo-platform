// POST /api/webhooks/sanity-content-activity — ADR-032 D9 (slice 3b). Sanity
// tells us a published post / news item / event / gallery changed its
// publication state; a change made by a person in Studio becomes one Activity
// row ("the Abluo team"). Authenticated by the webhook signature
// (SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET). 5xx asks Sanity to retry; the
// daily /api/cron/content-activity job repairs whatever retries could not.
import { verifyWebhookSignature } from '@/lib/connections/api/removals'
import { recordStudioChange } from '@/lib/lifecycle/studio-activity'
import { createSupabaseActivityStore } from '@/lib/lifecycle/activity-store'
import { dashboardSanityIdentity, transactionOf } from '@/lib/sanity/history'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET
  if (!secret) return new Response(null, { status: 503 })
  const body = await req.text()
  if (body.length > 10_000) return new Response(null, { status: 413 })
  if (!verifyWebhookSignature(req.headers.get('sanity-webhook-signature'), body, secret, Date.now())) {
    return new Response(null, { status: 401 })
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response(null, { status: 400 })
  }
  const r = await recordStudioChange(
    { body: payload, transactionId: req.headers.get('sanity-transaction-id'), transactionTime: req.headers.get('sanity-transaction-time') },
    {
      store: createSupabaseActivityStore(),
      authorOf: async (documentId, transactionId) => (await transactionOf(documentId, transactionId))?.author ?? null,
      dashboardIdentity: () => dashboardSanityIdentity(),
    }
  )
  if (r.status === 503) console.error(`[content-audit] webhook retry requested: txn=${req.headers.get('sanity-transaction-id') ?? '-'}`)
  return new Response(null, { status: r.status })
}
