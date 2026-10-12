// GET /api/v1/openapi.json — the public description of the partner API.
import { OPENAPI_V1 } from '@/lib/connections/api/openapi'

export const dynamic = 'force-static'

export function GET() {
  return Response.json(OPENAPI_V1, { headers: { 'cache-control': 'public, max-age=3600' } })
}
