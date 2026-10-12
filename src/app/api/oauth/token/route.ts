// POST /api/oauth/token — ADR-031 Amendment B. Partner apps exchange an
// authorization code (PKCE) or rotate a refresh token. Server-to-server only.
import { runOAuthEndpoint } from '@/lib/connections/http'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'
import { handleTokenRequest } from '@/lib/connections/token-endpoint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return runOAuthEndpoint(req, (r) => handleTokenRequest(r, { store: createSupabaseConnectionsStore() }))
}
