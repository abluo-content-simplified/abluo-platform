// POST /api/webhooks/sanity-removals — ADR-031 D4. Sanity tells us a published
// event was deleted or unpublished; we record a tombstone for partner sync.
// Authenticated by the webhook signature (SANITY_REMOVALS_WEBHOOK_SECRET).
import { recordRemoval, verifyWebhookSignature } from '@/lib/connections/api/removals'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secret = process.env.SANITY_REMOVALS_WEBHOOK_SECRET
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
  const r = await recordRemoval(payload, { store: createSupabaseConnectionsStore() })
  return new Response(null, { status: r.ok ? 204 : 400 })
}
