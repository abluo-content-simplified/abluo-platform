// ── Connections — adapt Next.js Request ↔ endpoint core ───────────────────────

import { createRateLimiter } from './rate-limit'
import type { OAuthHttpRequest, OAuthHttpResponse } from './token-endpoint'

const limiter = createRateLimiter()
const MAX_BODY_BYTES = 8 * 1024

function clientIdHint(req: Request, rawBody: string): string | null {
  const auth = req.headers.get('authorization')
  const m = auth && /^Basic ([A-Za-z0-9+/=]+)$/.exec(auth.trim())
  if (m) return Buffer.from(m[1], 'base64').toString('utf8').split(':')[0] || null
  return new URLSearchParams(rawBody).get('client_id')
}

export async function runOAuthEndpoint(
  req: Request,
  handler: (r: OAuthHttpRequest) => Promise<OAuthHttpResponse>,
): Promise<Response> {
  const json = (r: OAuthHttpResponse) =>
    new Response(Object.keys(r.body).length ? JSON.stringify(r.body) : null, { status: r.status, headers: r.headers })

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return json({ status: 413, headers: { 'content-type': 'application/json' }, body: { error: 'invalid_request' } })
  const rawBody = req.method === 'POST' ? await req.text() : ''
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return json({ status: 413, headers: { 'content-type': 'application/json' }, body: { error: 'invalid_request' } })

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const clientId = clientIdHint(req, rawBody)
  if (limiter.hit(`ip:${ip}`) || (clientId && limiter.hit(`client:${clientId.slice(0, 80)}`))) {
    return json({ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60', 'cache-control': 'no-store' }, body: { error: 'slow_down' } })
  }

  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
  return json(await handler({ method: req.method, headers, rawBody }))
}
