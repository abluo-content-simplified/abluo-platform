// POST /api/oauth/revoke — RFC 7009. A partner app ends one of its own tokens.
import { runOAuthEndpoint } from '@/lib/connections/http'
import { handleRevokeRequest } from '@/lib/connections/revoke-endpoint'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return runOAuthEndpoint(req, (r) => handleRevokeRequest(r, { store: createSupabaseConnectionsStore() }))
}
