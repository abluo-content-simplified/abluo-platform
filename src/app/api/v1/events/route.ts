// GET /api/v1/events — ADR-031 V1 step 5. Partner apps read the events a
// website owner shared with them. All checks live in handleEventsRequest.
import { handleEventsRequest } from '@/lib/connections/api/events-endpoint'
import { createSanityEventsSource } from '@/lib/connections/api/events-source'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
  const r = await handleEventsRequest(
    { method: 'GET', url: req.url, headers },
    { store: createSupabaseConnectionsStore(), source: createSanityEventsSource() },
  )
  return new Response(r.body, { status: r.status, headers: r.headers })
}
